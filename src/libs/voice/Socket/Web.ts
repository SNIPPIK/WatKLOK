import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {TypedEmitter} from "tiny-typed-emitter";
import {WebSocket, Event, CloseEvent} from "ws";

/**
 * @author SNIPPIK
 * @description WebSocket для отправки голосовых пакетов на сервера discord
 * @class VoiceWebSocket
 */
export class VoiceWebSocket extends TypedEmitter<WebSocketEvents> {
    private _ws: WebSocket;
    private readonly life = {
        interval: null as NodeJS.Timeout,
        ack: 0, send: 0, misses: 0
    };
    /**
     * @description Создает новый голосовой веб-сокет.
     * @param address - Адрес, к которому нужно подключиться
     * @private
     */
    private set createWS(address: string) {
        const ws = new WebSocket(address);

        ws.onopen = (err) => this.emit("open", err);
        ws.onerror = (err) => this.emit("error", err instanceof Error ? err : err.error);
        ws.onclose = (err) => this.emit("close", err);
        ws.onmessage = (event) => {
            if (typeof event.data !== 'string') return;

            try {
                const packet = JSON.parse(event.data);

                if (packet.op === VoiceOpcodes.HeartbeatAck) {
                    this.life.ack = Date.now();
                    this.life.misses = 0;
                }

                this.emit("packet", packet);
            } catch (error) {
                this.emit("error", error as Error);
            }
        };
        this._ws = ws;
    };

    /**
     * @description Получаем голосовой веб-сокет
     * @public
     */
    public get ws() { return this._ws; };

    public constructor(address: string) {
        super();
        this.createWS = address;
    };

    /**
     * @description Посылает сердцебиение по веб-сокету.
     * @private
     */
    private sendHeartbeat() {
        this.life.send = Date.now();
        this.life.misses++;

        this.sendPacket({ op: VoiceOpcodes.Heartbeat, d: this.life.send });
    };

    /**
     * @description Уничтожает голосовой веб-сокет. Интервал очищается, и соединение закрывается
     * @public
     */
    public destroy = (code: number = 1e3): void => {
        try {
            this.setHeartbeatInterval(-1);
            this.ws.close(code);
        } catch (error) {
            this.emit('error', error as Error);
        }
    };

    /**
     * @description Отправляет пакет с возможностью преобразования в JSON-строку через WebSocket.
     * @param packet - Пакет для отправки
     * @public
     */
    public sendPacket(packet: any) {
        try {
            this.ws.send(JSON.stringify(packet));
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * @description Устанавливает/очищает интервал для отправки сердечных сокращений по веб-сокету.
     * @param ms - Интервал в миллисекундах. Если значение отрицательное, интервал будет сброшен
     * @public
     */
    public setHeartbeatInterval(ms: number) {
        if (this.life.interval !== undefined) clearInterval(this.life.interval);

        if (ms > 0) this.life.interval = setInterval(() => {
            if (this.life.send !== 0 && this.life.misses >= 3) this.destroy(0);
            this.sendHeartbeat();
        }, ms);
    };
}

/**
 * @description Ивенты для VoiceWebSocket
 * @interface WebSocketEvents
 * @class VoiceWebSocket
 */
interface WebSocketEvents {
    "error": (error: Error) => void;
    "open": (event: Event) => void;
    "close": (event: CloseEvent) => void;
    "packet": (packet: any) => void;
}