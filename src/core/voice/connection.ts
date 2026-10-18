import type { DiscordGatewayAdapterCreator, DiscordGatewayAdapterImplementerMethods } from "./transport/adapter.js";
import { VoiceConnection as NativeVoiceConnection, VoiceConnectionConfig } from "#native";
import { TypedEmitter, Logger } from "#structures";
import { db } from "#db";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах.
 *
 * Вся логика (Transport, UDP, DAVE/MLS, heartbeat, speaker) живёт в Rust
 * (`#native` → `VoiceConnection`). Здесь остаётся только то, что завязано на
 * клиент Discord и приложение: gateway-адаптер, `Logger`, `db.voice`, событие `info`.
 *
 * # Роль класса
 *
 * Это тонкая JS-обёртка над нативным объектом. Все «настоящие» действия
 * (открытие WebSocket, discovery UDP, шифрование DAVE, heartbeat) выполняет
 * Rust. JS-сторона:
 *
 * 1. Создаёт нативный объект с конфигурацией.
 * 2. Регистрирует обработчик событий Rust → JS (одна функция, JSON-строки).
 * 3. Создаёт gateway-адаптер через `adapterCreator` и передаёт ему
 *    callback'и на `VOICE_SERVER_UPDATE` / `VOICE_STATE_UPDATE`.
 * 4. Прокидывает пакеты аудио в нативный объект.
 * 5. Разбирает события от Rust и передаёт их дальше: логи — в `Logger`
 *    или в событие `info`, пакеты для gateway — в адаптер, `destroyed` —
 *    в `db.voice`.
 *
 * Такое разделение даёт два преимущества:
 * - горячий путь (аудио, RTP, DAVE) полностью в Rust, без JS-накладных;
 * - JS-сторона остаётся простой и не занимается низкоуровневыми деталями.
 *
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
    /** Нативное подключение (Rust) */
    private readonly native: InstanceType<typeof NativeVoiceConnection>;

    /**
     * Gateway-адаптер клиента Discord. `null` после уничтожения.
     *
     * `null` — это важный инвариант: если адаптер уже освобождён,
     * все методы, которые попытались бы его использовать (например,
     * `disconnect` или `setChannel`), тихо выходят. Так мы не падаем
     * на обращении к освобождённому объекту.
     */
    private _adapter: DiscordGatewayAdapterImplementerMethods | null = null;

    /**
     * Флаг полного уничтожения подключения.
     *
     * Выставляется в `true` в `onNative` при событии `adapter_destroy` —
     * это последнее событие, которое приходит из Rust. После него
     * нативный объект уже ничего не делает, и все публичные методы
     * должны быть no-op.
     */
    private _destroyed = false;

    /**
     * Фасады старых полей `ws`, `udp`, `transport`.
     *
     * Раньше это были полноценные объекты с методами; теперь они читают
     * данные из нативного объекта через геттеры. Сохранены для обратной
     * совместимости: внешний код (плагины, UI) продолжает работать
     * без изменений.
     */
    private readonly _ws: { readonly ready: boolean; readonly sequence: number };
    private readonly _udp: { readonly ready: boolean; readonly status: string; readonly packets: number; readonly lost: number };
    private readonly _transport: { readonly ready: boolean; readonly ssrc: number | null; readonly _ws: any; readonly _udp: any };

    /**
     * @description Получаем текущий статус голосового подключения
     * @public
     */
    public get status(): ConnectionStatus {
        // `as ConnectionStatus` — потому что из Rust приходит `string`,
        // а здесь мы знаем, что это одно из четырёх значений enum'а.
        // Runtime-проверка не нужна: Rust — единственный источник
        // этих строк, и он гарантирует их корректность.
        return this.native.status as ConnectionStatus;
    };

    /**
     * @description Записываем текущий статус подключения
     * @public
     */
    public set status(status: ConnectionStatus) {
        // Уничтоженное подключение не принимает новых статусов:
        // это состояние гонки, лучше тихо выйти, чем отправлять
        // команды в мёртвый нативный объект.
        if (this._destroyed) return;
        this.native.setStatus(status);
    };

    /**
     * @description Подключение к Discord по Websocket
     * @public
     */
    public get ws() {
        // Возвращаем `null` для уничтоженного подключения, чтобы
        // вызывающий не пытался читать поля с мёртвого объекта.
        return this._destroyed ? null : this._ws;
    };

    /**
     * @description Подключение к Discord по UDP
     * @public
     */
    public get udp() {
        return this._destroyed ? null : this._udp;
    };

    /**
     * @description Транспортный слой (фасад над Rust)
     * @public
     */
    public get transport() {
        return this._destroyed ? null : this._transport;
    };

    /**
     * @description Данные адаптера (нужен только channel_id для Voices.join)
     * @public
     */
    public get adapter() {
        // Возвращаем минимальный фасад: `Voices.join` нужен только
        // `packet.state.channel_id`, и незачем отдавать весь адаптер.
        // `null`, если подключение уничтожено или адаптер ещё
        // не создан.
        if (this._destroyed || !this._adapter) return null;
        return { packet: { state: { channel_id: this.native.stateChannelId } } };
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get ready(): boolean {
        // `!this._destroyed` — быстрая проверка на JS-стороне,
        // `this.native.ready` — проверка в Rust (WS + UDP + RTP + DAVE).
        // Обе нужны: первая отсекает уничтоженный объект без вызова
        // в Rust, вторая — проверяет реальное состояние протокола.
        return !this._destroyed && this.native.ready;
    };

    /**
     * @description Отключаемся от голосового канала
     * @public
     */
    public disconnect = (): void => {
        if (this._destroyed || !this._adapter) return;

        // Локально сбрасываем channel_id, чтобы `configuration` отражала
        // реальное состояние. Нативная сторона сделает то же самое,
        // но JS-код может читать `configuration` независимо.
        this.configuration.channel_id = null;
        this.native.disconnect();
    };

    /**
     * @description Смена голосового канала
     * @param ID - уникальный код канала
     * @public
     */
    public set channel(ID: string) {
        if (this._destroyed || !this._adapter) return;

        // То же, что в `disconnect`: сначала обновляем JS-сторону,
        // потом просим Rust переключиться. Порядок важен для
        // консистентности, если сразу после вызова кто-то прочитает
        // `configuration.channel_id`.
        this.configuration.channel_id = ID;
        this.native.setChannel(ID);
    };

    /**
     * @description Создаем голосовое подключение
     * @param configuration - Данные для подключения
     * @param adapterCreator - Параметры для сервера
     * @constructor
     * @public
     */
    public constructor(public configuration: VoiceConnectionConfig, adapterCreator: DiscordGatewayAdapterCreator) {
        super();

        // Создаём нативный объект с копией конфигурации. Дальше
        // JS-объект `configuration` живёт отдельно от нативного —
        // изменения через `channel` / `disconnect` меняют оба,
        // но случайная мутация JS-объекта не затронет нативный.
        const native = this.native = new NativeVoiceConnection({
            guild_id: configuration.guild_id,
            channel_id: configuration.channel_id,
            self_deaf: configuration.self_deaf,
            self_mute: configuration.self_mute,
            self_speaker: configuration.self_speaker
        });

        // Фасады старых полей. Каждое свойство — это геттер над нативным
        // объектом: значение читается в момент обращения, а не кэшируется.
        // Это важно: `ready` меняется со временем, и кэш был бы
        // некорректным.
        const ws = this._ws = {
            get ready() { return native.wsReady; },
            get sequence() { return native.wsSequence; }
        };
        const udp = this._udp = {
            get ready() { return native.udpReady; },
            get status() { return native.udpStatus; },
            get packets() { return native.udpPackets; },
            get lost() { return native.udpDrops; }
        };
        this._transport = {
            get ready() { return native.transportReady; },
            get ssrc() { return native.ssrc; },
            get _ws() { return ws; },
            get _udp() { return udp; }
        };

        // Регистрируем единственный обработчик событий Rust → JS.
        // Все события идут через одну функцию в виде JSON-строк —
        // это дешевле, чем создавать отдельную threadsafe-функцию
        // на каждый тип события.
        native.onEvent(this.onNative);

        // Создаём gateway-адаптер. `adapterCreator` — это функция,
        // которую предоставляет клиент Discord (обычно — стандартный
        // `createDefaultAdapter`). Она возвращает объект с методами
        // `send`, `destroy` и callback'ами, через которые адаптер
        // сообщает о событиях от gateway.
        this._adapter = adapterCreator({
            /**
             * @description Регистрирует пакет VOICE_SERVER_UPDATE
             */
            onVoiceServerUpdate: (packet) => {
                // Пакет приходит от gateway-клиента (обычно — Discord.js)
                // и содержит token, guild_id и endpoint. Передаём в Rust.
                // `?? null` — потому что Rust ждёт `Option<String>`,
                // а не `undefined`.
                native.onVoiceServerUpdate(packet.token, packet.guild_id, packet.endpoint ?? null);
            },

            /**
             * @description Регистрирует пакет VOICE_STATE_UPDATE
             */
            onVoiceStateUpdate: (packet) => {
                // Пакет содержит session_id, user_id, channel_id, guild_id.
                // `guild_id` и `channel_id` могут быть `null` или
                // `undefined` — приводим к `null` для Rust.
                native.onVoiceStateUpdate(
                    packet.guild_id ?? null,
                    packet.user_id,
                    packet.session_id,
                    packet.channel_id ?? null
                );
            },

            /**
             * @description Регистрируем удаление данных
             */
            destroy: this.destroy
        });

        // Подключаемся к голосовому каналу (status = connecting).
        // Это запускает всю цепочку: отправка конфигурации в gateway,
        // ожидание VOICE_SERVER_UPDATE и VOICE_STATE_UPDATE,
        // затем — рукопожатие WebSocket и discovery UDP.
        native.start();

        /**
         * @description Слушаем данные VoiceConnection
         *
         * Единственное событие JS-стороны — `info`. Все остальные
         * события (готовность, ошибки, уничтожение) либо пишутся
         * в `Logger`, либо обрабатываются внутри `onNative`.
         */
        this.on("info", (err) => {
            // Префикс `[Voice/<guild_id>]` — чтобы в общем логе было
            // понятно, к какому подключению относится сообщение.
            Logger.log(
                "WARN",
                `[Voice/${this.configuration.guild_id}]: ${err}`
            );
        });
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param frames - Аудио пакет OPUS
     * @public
     */
    public packet = (frames: Buffer[]) => {
        // Горячий путь: вызывается 50 раз в секунду. Здесь только
        // одна проверка и вызов в Rust — никакой лишней работы.
        if (this._destroyed) return;
        this.native.packet(frames);
    };

    /**
     * @description События Rust -> JS
     * @private
     */
    private readonly onNative = (json: string): void => {
        // Rust присылает JSON-строки. Парсим; если парсинг упал —
        // тихо выходим: битый JSON означает, что на стороне Rust
        // баг, и повторная попытка бессмысленна.
        let event: any;
        try { event = JSON.parse(json); } catch { return; }

        // Диспетчеризация по полю `t` (type). Все возможные значения
        // перечислены в doc-комментарии `HostBus` в Rust.
        switch (event.t) {
            // Лог: от самого подключения — через событие `info`,
            // от транспорта — сразу в Logger.
            //
            // Разделение нужно потому, что `info` — событие для
            // слушателей `VoiceConnection` (плагины, UI), а
            // транспортные логи — внутренняя диагностика, которая
            // интересна только в Logger.
            case "log": {
                if (event.src === "voice") this.emit("info", event.text);
                else Logger.log("WARN", `[Voice/${this.configuration.guild_id}]: ${event.text}`);
                break;
            }

            // Пакет VoiceStateUpdate для gateway. Rust сформировал его
            // в ответ на `set_status(Connecting)` или `disconnect`,
            // и теперь нам нужно отправить его через адаптер.
            case "send": {
                // `try/catch` — потому что адаптер может бросить
                // исключение (например, если соединение с gateway
                // уже потеряно). Это не критично: Rust сам получит
                // событие о закрытии.
                try { this._adapter?.send(event.payload); } catch {}
                break;
            }

            // Удаляем соединение из глобальной БД. Это делает
            // `VoiceConnection` — единственное место, где есть
            // доступ к `db.voice`. Rust не знает о существовании
            // базы, поэтому просит нас через событие.
            case "destroyed": {
                if (event.guild_id) db.voice.remove(event.guild_id);
                break;
            }

            // Последнее событие уничтожения: освобождаем адаптер
            // и слушателей. После этого JS-объект полностью
            // неработоспособен.
            case "adapter_destroy": {
                // Выставляем флаг ДО освобождения адаптера, чтобы
                // реэнтрантные вызовы (например, из `destroy()`
                // внутри `adapter.destroy()`) увидели, что уже
                // уничтожено, и не начали повторную очистку.
                this._destroyed = true;

                // Забираем адаптер локально и сразу обнуляем поле.
                // `adapter?.destroy?.()` — опциональная цепочка:
                // адаптер мог быть `null` (если `adapterCreator`
                // вернул `null`) или не иметь метода `destroy`.
                const adapter = this._adapter;
                this._adapter = null;
                adapter?.destroy?.();

                // Освобождаем слушателей `TypedEmitter`. После
                // этого событие `info` больше не доставляется —
                // что правильно, потому что подключение мертво.
                super.destroy();
                break;
            }
        }
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        // Идемпотентность: повторный вызов ничего не делает.
        // Это важно, потому что `destroy` может вызываться из
        // нескольких мест: явно из JS, из `adapter.destroy`
        // (через callback), из `Drop` нативного объекта.
        if (this._destroyed) return;
        this.native.destroy();
    };
}

/**
 * @author SNIPPIK
 * @description События голосового подключения
 * @interface VoiceConnectionEvents
 * @private
 */
interface VoiceConnectionEvents {
    /**
     * Событие получения лога от голосового канала.
     *
     * Приходит из Rust через `onNative` (событие `log` с `src === "voice"`).
     * Используется для диагностики: плагины и UI могут подписаться
     * и показывать состояние подключения.
     *
     * `string | Error` — потому что источником может быть как
     * обычный лог (строка), так и объект ошибки (из нативного слоя).
     */
    readonly "info": (status: string | Error) => void;
}

/**
 * @author SNIPPIK
 * @description Статусы подключения голосового соединения
 * @enum ConnectionStatus
 * @private
 */
enum ConnectionStatus {
    /** Статус при котором голосовое подключение отключено */
    disconnected = "disconnected",

    /**
     * Статус при котором производится переподключение.
     *
     * Отличается от `connecting` тем, что мы уже были подключены
     * и восстанавливаемся после обрыва. С точки зрения протокола
     * шаги те же, но для UI это разные сценарии.
     */
    reconnecting = "reconnecting",

    /**
     * Статус при котором голосовое соединение начало соединение
     * (WS, UDP, RTP, DAVE и тп).
     */
    connecting = "connecting",

    /**
     * Статус при котором голосовое соединение с каналом установлено
     * (WS, UDP, RTP, DAVE и тп).
     */
    connected = "connected"
}