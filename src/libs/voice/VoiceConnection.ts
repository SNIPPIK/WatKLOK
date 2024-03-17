import type { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData } from "discord-api-types/v10";
import type { CreateVoiceConnectionOptions, DiscordGatewayAdapterImplementerMethods } from "@lib/voice";
import { Networking, NetworkingStatusCode, type NetworkingState } from "./networking";
import {Voice, VoiceConfig} from "@lib/voice";
import {TypedEmitter} from "tiny-typed-emitter";

/**
 * @class VoiceConnection
 * @description Подключение к голосовому серверу Гильдии может использоваться для воспроизведения аудио в голосовых каналах.
 */
export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents & VoiceConnectionEventsSignals> {
    private readonly _local = {
        state: null as VoiceConnectionState,

        joinConfig: null as VoiceConfig,
        rejoin: 0,
        packets: {
            server: undefined as GatewayVoiceServerUpdateDispatchData,
            state: undefined  as GatewayVoiceStateUpdateDispatchData
        }
    };
    public constructor(config: VoiceConfig, options: CreateVoiceConnectionOptions) {
        super();

        this.onNetworkingClose = this.onNetworkingClose.bind(this);
        this.onNetworkingStateChange = this.onNetworkingStateChange.bind(this);
        this.onNetworkingError = this.onNetworkingError.bind(this);

        const adapter = options.adapterCreator({
            onVoiceServerUpdate: (data) => this.addServerPacket(data),
            onVoiceStateUpdate: (data) => this.addStatePacket(data),
            destroy: () => this.destroy(false)
        });

        this._local.state = { status: VoiceConnectionStatus.Signalling, adapter };
        this._local.joinConfig = config;
    };

    /**
     * @description Текущий VoiceConfig
     * @public
     */
    public get config() { return this._local.joinConfig; }

    /**
     * @description Текущее состояние голосового соединения.
     * @public
     */
    public get state() { return this._local.state; }

    /**
     * @description Обновляет состояние голосового соединения, выполняя операции очистки там, где это необходимо.
     * @public
     */
    public set state(newState: VoiceConnectionState) {
        const oldState = this._local.state;
        const oldNetworking = Reflect.get(oldState, 'networking') as Networking;
        const newNetworking = Reflect.get(newState, 'networking') as Networking;

        if (oldNetworking !== newNetworking) {
            if (oldNetworking) {
                oldNetworking.on('error', () => {});
                oldNetworking.off('error', this.onNetworkingError);
                oldNetworking.off('close', this.onNetworkingClose);
                oldNetworking.off('stateChange', this.onNetworkingStateChange);
                oldNetworking.destroy();
            }
        }

        if (newState.status === VoiceConnectionStatus.Ready) this._local.rejoin = 0;

        //В случае уничтожения адаптер также может быть уничтожен, чтобы пользователь мог его очистить
        if (oldState.status !== VoiceConnectionStatus.Destroyed && newState.status === VoiceConnectionStatus.Destroyed) oldState.adapter.destroy();

        this._local.state = newState;

        this.emit('stateChange', oldState, newState);
        if (oldState.status !== newState.status) this.emit(newState.status as any, oldState, newState);
    };

    /**
     * @description Пытается настроить сетевой экземпляр для этого голосового соединения, используя полученные пакеты.
     * Требуются оба пакета, и любой существующий сетевой экземпляр будет уничтожен.
     *
     * @remarks
     * Это вызывается при изменении голосового сервера подключения, например, если бот перемещен на
     * другой канал в той же гильдии, но имеет другой голосовой сервер. В этом случае
     * необходимо повторно установить соединение с новым голосовым сервером.
     *
     * Соединение перейдет в состояние подключения, когда это будет вызвано.
     * @public
     */
    public configureNetworking() {
        const { server, state } = this._local.packets;
        if (!server || !state || this.state.status === VoiceConnectionStatus.Destroyed || !server.endpoint) return;

        const networking = new Networking(
            {
                endpoint: server.endpoint,
                serverId: server.guild_id,
                token: server.token,
                sessionId: state.session_id,
                userId: state.user_id,
            }
        );

        networking.once('close', this.onNetworkingClose);
        networking.on('stateChange', this.onNetworkingStateChange);
        networking.on('error', this.onNetworkingError);

        this.state = { ...this.state, networking,
            status: VoiceConnectionStatus.Connecting
        };
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param buffer - Пакет Opus для воспроизведения
     * @public
     */
    public playOpusPacket(buffer: Buffer) {
        const state = this.state;
        if (state.status !== VoiceConnectionStatus.Ready) return;
        state.networking.prepareAudioPacket(buffer);
        return state.networking.dispatchAudio();
    };

    /**
     * Разрушает голосовое соединение, предотвращая повторное подключение к голосовой связи.
     * Этот метод следует вызывать, когда голосовое соединение вам больше не требуется, чтобы
     * предотвратить утечку памяти
     * @param adapterAvailable - Можно ли использовать адаптер
     * @public
     */
    public destroy(adapterAvailable = false) {
        if (this.state.status === VoiceConnectionStatus.Destroyed) throw new Error('Cannot destroy VoiceConnection - it has already been destroyed');
        if (adapterAvailable) this.state.adapter.sendPayload(Voice.payload(this.config));

        this.state = { status: VoiceConnectionStatus.Destroyed };
    };

    /**
     * @description Отключает голосовое соединение, предоставляя возможность повторного подключения позже.
     * @returns ``true`, если соединение было успешно отключено
     * @public
     */
    public disconnect() {
        if (this.state.status === VoiceConnectionStatus.Destroyed || this.state.status === VoiceConnectionStatus.Signalling) return false;

        this._local.joinConfig.channelId = null;

        if (!this.state.adapter.sendPayload(Voice.payload(this.config))) {
            this.state = { adapter: this.state.adapter, status: VoiceConnectionStatus.Disconnected, reason: VoiceConnectionDisconnectReason.AdapterUnavailable };
            return false;
        }

        this.state = { adapter: this.state.adapter, reason: VoiceConnectionDisconnectReason.Manual, status: VoiceConnectionStatus.Disconnected };
        return true;
    };

    /**
     * @description Переподключение к текущему каналу или новому голосовому каналу
     *
     * @remarks
     * Успешный вызов этого метода автоматически увеличит счетчик попыток повторного подключения,
     * который вы можете использовать, чтобы сообщить, хотите ли вы продолжать попытки повторного подключения
     * к голосовому соединению.
     *
     * При вызове этого параметра будет наблюдаться переход состояния из отключенного в сигнализирующее.

     * @param joinConfig - Данные канала для переподключения
     * @returns ``true`, если соединение было успешно установлено
     * @public
     */
    public rejoin(joinConfig?: VoiceConfig) {
        if (this.state.status === VoiceConnectionStatus.Destroyed) return false;

        const notReady = this.state.status !== VoiceConnectionStatus.Ready;
        if (notReady) this._local.rejoin++;

        Object.assign(this._local.joinConfig, joinConfig);

        if (this.state.adapter.sendPayload(Voice.payload(this.config))) {
            if (notReady) this.state = { ...this.state, status: VoiceConnectionStatus.Signalling };
            return true;
        }

        this.state = { adapter: this.state.adapter, status: VoiceConnectionStatus.Disconnected, reason: VoiceConnectionDisconnectReason.AdapterUnavailable };
        return false;
    };

    /**
     * @description Обновляет статус голосового соединения. Используется, когда аудио плееры завершили воспроизведение звука
     * и необходимо подать сигнал о том, что соединение больше не воспроизводит звук.
     * @param enabled - Показывать или не показывать, как говорящий
     * @public
     */
    public setSpeaking(enabled: boolean) {
        if (this.state.status !== VoiceConnectionStatus.Ready) return false;
        return this.state.networking.setSpeaking(enabled);
    };

    /**
     * @description Последний пинг (в миллисекундах) для подключения WebSocket и воспроизведения звука для этого голосового
     * соединения, если эти данные доступны.
     *
     * @remarks
     * Чтобы эти данные были доступны, голосовое соединение должно находиться в состоянии готовности, а лежащее в его основе соединение
     * WebSocket и UDP-сокет должны иметь по крайней мере один обмен данными по протоколу ping-pong.
     * @public
     */
    public get ping() {
        return {
            ws: this.state["networking"]["state"]["ws"]["ping"] ?? undefined,
            udp: this.state["networking"]["state"]["udp"]["ping"] ?? undefined
        }
    };

    /**
     * @description Вызывается, когда сетевой экземпляр для этого соединения закрывается. Если код закрытия равен 4014 (не подключаться повторно),
     * голосовое соединение перейдет в отключенное состояние, в котором будет сохранен код закрытия. Вы можете
     * решить, следует ли повторно подключаться, когда это произойдет, прослушав изменение состояния и вызвав функцию reconnect().
     *
     * @remarks
     * Если код закрытия был иным, чем 4014, вполне вероятно, что закрытие не было запланировано, и поэтому
     * голосовое соединение подаст Discord сигнал о том, что оно хотело бы вернуться к каналу. При этом автоматически будет предпринята попытка
     * восстановить соединение. Это можно было бы рассматривать как переход из состояния готовности в состояние сигнализации.
     * @param code - Код закрытия
     * @private
     */
    private onNetworkingClose(code: number) {
        if (this.state.status === VoiceConnectionStatus.Destroyed) return;

        //Если подключение к сети завершится, попробуйте снова подключиться к голосовому каналу.
        if (code === 4_014) {
            //Отключен - сеть здесь уже разрушена
            this.state = { ...this.state, closeCode: code,
                status: VoiceConnectionStatus.Disconnected,
                reason: VoiceConnectionDisconnectReason.WebSocketClose
            };
        } else {
            this.state = { ...this.state, status: VoiceConnectionStatus.Signalling };
            this._local.rejoin++;

            if (!this.state.adapter.sendPayload(Voice.payload(this.config))) {
                this.state = { ...this.state, status: VoiceConnectionStatus.Disconnected,
                    reason: VoiceConnectionDisconnectReason.AdapterUnavailable
                };
            }
        }
    };

    /**
     * @description Вызывается при изменении состояния сетевого экземпляра. Используется для определения состояния голосового соединения.
     * @param oldState - Предыдущее состояние
     * @param newState - Новое состояние
     * @private
     */
    private onNetworkingStateChange(oldState: NetworkingState, newState: NetworkingState) {
        if (oldState.code === newState.code) return;
        if (this.state.status !== VoiceConnectionStatus.Connecting && this.state.status !== VoiceConnectionStatus.Ready)
            return;

        if (newState.code === NetworkingStatusCode.Ready) this.state = { ...this.state, status: VoiceConnectionStatus.Ready };
        else if (newState.code !== NetworkingStatusCode.Closed) this.state = { ...this.state, status: VoiceConnectionStatus.Connecting };
    };

    /**
     * @description Распространяет ошибки из базового сетевого экземпляра.
     * @param error - Распространяемая ошибка
     * @private
     */
    private onNetworkingError(error: Error) { this.emit('error', error); }

    /**
     * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
     * новых данных, предоставленных в пакете.
     * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
     * @private
     */
    private addServerPacket(packet: GatewayVoiceServerUpdateDispatchData) {
        this._local.packets.server = packet;

        if (packet.endpoint) this.configureNetworking();
        else if (this.state.status !== VoiceConnectionStatus.Destroyed) {
            this.state = { ...this.state, status: VoiceConnectionStatus.Disconnected, reason: VoiceConnectionDisconnectReason.EndpointRemoved };
        }
    };

    /**
     * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
     * канала, к которому подключен клиент.
     * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
     * @private
     */
    private addStatePacket(packet: GatewayVoiceStateUpdateDispatchData) {
        this._local.packets.state = packet;

        if (packet.self_deaf !== undefined) this._local.joinConfig.selfDeaf = packet.self_deaf;
        if (packet.self_mute !== undefined) this._local.joinConfig.selfMute = packet.self_mute;
        if (packet.channel_id) this._local.joinConfig.channelId = packet.channel_id;
    };
}

/**
 * @class VoiceConnection
 * @description Ивенты для VoiceConnection
 */
export interface VoiceConnectionEvents {
    "error": (error: Error) => this;
    "debug": (message: string) => this;
    "stateChange": (oldState: VoiceConnectionState, newState: VoiceConnectionState) => this;
}
/**
 * @class VoiceConnection
 * @description Ивенты для VoiceConnection
 */
export interface VoiceConnectionEventsSignals {
    "connecting": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this;
    "destroyed": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this;
    "disconnected": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this;
    "ready": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this;
    "signalling": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this;
}


/**
 * @description Различные коды состояния, которые может содержать голосовое соединение в любой момент времени.
 */
export enum VoiceConnectionStatus {
    /**
     * @description Пакеты `VOICE_SERVER_UPDATE` и `VOICE_STATE_UPDATE` были получены, теперь предпринимается попытка установить голосовое соединение.
     */
    Connecting = 'connecting',

    /**
     * @description Голосовое соединение было разрушено и не отслеживалось, его нельзя использовать повторно.
     */
    Destroyed = 'destroyed',

    /**
     * @description Голосовое соединение либо разорвано, либо не установлено.
     */
    Disconnected = 'disconnected',

    /**
     * @description Голосовое соединение установлено и готово к использованию.
     */
    Ready = 'ready',

    /**
     * @description Отправляем пакет на главный шлюз Discord, чтобы указать, что мы хотим изменить наше голосовое состояние.
     */
    Signalling = 'signalling',
}

/**
 * Состояние, в котором будет находиться голосовое соединение, когда оно ожидает получения пакетов VOICE_SERVER_UPDATE и
 * VOICE_STATE_UPDATE от Discord, предоставляемых адаптером.
 */
export interface VoiceConnectionSignallingState {
    adapter: DiscordGatewayAdapterImplementerMethods;
    status: VoiceConnectionStatus.Signalling;
}

/**
 * @description Причины, по которым голосовое соединение может находиться в отключенном состоянии.
 */
export enum VoiceConnectionDisconnectReason {
    /**
     * @description Когда соединение с WebSocket было закрыто.
     */
    WebSocketClose,

    /**
     * @description Когда адаптеру не удалось отправить сообщение, запрошенное голосовым соединением.
     */
    AdapterUnavailable,

    /**
     * @description Когда получен пакет VOICE_SERVER_UPDATE с нулевой конечной точкой, что приводит к разрыву соединения.
     */
    EndpointRemoved,

    /**
     * @description Когда было запрошено ручное отключение.
     */
    Manual,
}

/**
 * @description Различные состояния, в которых может находиться голосовое соединение.
 */
export type VoiceConnectionState = | VoiceStateConnecting | VoiceStateDestroyed | VoiceConnectionDisconnectedState | VoiceStateReady | VoiceConnectionSignallingState;


/**
 * @description Состояние, в котором будет находиться голосовое соединение, когда оно не подключено к голосовому серверу Discord и не
 * пытается подключиться. Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
 */
export interface VoiceConnectionDisconnectedBaseState {
    adapter: DiscordGatewayAdapterImplementerMethods;
    status: VoiceConnectionStatus.Disconnected;
}

/**
 * @description Состояние, в котором будет находиться голосовое соединение, когда оно не подключено к голосовому серверу Discord и не
 * пытается подключиться. Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
 */
export interface VoiceConnectionDisconnectedOtherState extends VoiceConnectionDisconnectedBaseState {
    reason: Exclude<VoiceConnectionDisconnectReason, VoiceConnectionDisconnectReason.WebSocketClose>;
}

/**
 * @description Состояние, в котором будет находиться голосовое соединение, когда его подключение к WebSocket было закрыто.
 * Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
 */
export interface VoiceConnectionDisconnectedWebSocketState extends VoiceConnectionDisconnectedBaseState {
    closeCode: number;
    reason: VoiceConnectionDisconnectReason.WebSocketClose;
}

/**
 * @description Состояния, в которых может находиться голосовое соединение, когда оно не подключено к голосовому серверу Discord и не
 * пытается подключиться. Вы можете вручную попытаться подключиться, используя голосовое соединение#переподключение.
 */
export type VoiceConnectionDisconnectedState = | VoiceConnectionDisconnectedOtherState | VoiceConnectionDisconnectedWebSocketState;

/**
 * @description The state that a VoiceConnection will be in when it is establishing a connection to a Discord
 * voice server.
 */
export interface VoiceStateConnecting {
    adapter: DiscordGatewayAdapterImplementerMethods;
    networking: Networking;
    status: VoiceConnectionStatus.Connecting;
}

/**
 * @description Состояние, в котором будет находиться голосовое соединение при активном подключении к
 * голосовому серверу Discord.
 */
export interface VoiceStateReady {
    adapter: DiscordGatewayAdapterImplementerMethods;
    networking: Networking;
    status: VoiceConnectionStatus.Ready;
}

/**
 * @description Состояние, в котором будет находиться голосовое соединение, если оно было безвозвратно уничтожено
 * пользователем и не отслежено библиотекой. Его невозможно повторно подключить, вместо
 * этого необходимо установить новое голосовое соединение.
 */
export interface VoiceStateDestroyed {
    status: VoiceConnectionStatus.Destroyed;
}