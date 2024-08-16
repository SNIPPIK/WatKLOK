import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {WebSocket, WebSocketEvent} from "@lib/request"
import {TypedEmitter} from "tiny-typed-emitter";

/**
 * @author SNIPPIK
 * @description WebSocket для отправки голосовых пакетов на сервера discord
 * @class VoiceWebSocket
 */
export class VoiceWebSocket extends TypedEmitter<WebSocketEvents> {
    private readonly ws: WebSocket;
    private readonly life = {
        interval: null as NodeJS.Timeout,
        ack: 0, send: 0, misses: 0
    };

    /**
     * @description Устанавливает/очищает интервал для отправки сердечных сокращений по веб-сокету.
     * @param ms - Интервал в миллисекундах. Если значение отрицательное, интервал будет сброшен
     * @public
     */
    public set liveInterval(ms: number) {
        if (this.life.interval !== undefined) clearInterval(this.life.interval);

        if (ms > 0) this.life.interval = setInterval(() => {
            if (this.life.send !== 0 && this.life.misses >= 3) this.destroy(0);

            this.life.send = Date.now();
            this.life.misses++;
            this.packet = {
                op: VoiceOpcodes.Heartbeat,
                d: this.life.send
            };
        }, ms);
    };


    /**
     * @description Отправляет пакет с возможностью преобразования в JSON-строку через WebSocket.
     * @param packet - Пакет для отправки
     * @public
     */
    public set packet(packet: string | object) {
        try {
            this.ws.send(JSON.stringify(packet));
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * @description Создаем WebSocket для передачи голосовых пакетов
     * @param address - Адрес сервера для соединения
     * @public
     */
    public constructor(address: string) {
        super();
        const ws = new WebSocket(address);

        //Подключаем события
        for (const event of ["message", "open", "close", "error"]) {
            if (this[`on${event}`]) ws[`on${event}`] = (arg: WebSocketEvent) => this[`on${event}`](arg);
            else ws[`on${event}`] = (arg: WebSocketEvent) => this.emit(event as any, arg);
        }

        this.ws = ws;
    };

    private readonly onmessage = (event: WebSocketEvent) => {
        if (typeof event.data !== "string") return;

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

    /**
     * @description Уничтожает голосовой веб-сокет. Интервал очищается, и соединение закрывается
     * @public
     */
    public destroy = (code: number = 1_000): void => {
        try {
            this.liveInterval = -1;
            this.ws.close(code);
        } catch (error) {
            this.emit("error", error as Error);
        }
    };
}

/**
 * @description Ивенты для VoiceWebSocket
 * @interface WebSocketEvents
 * @class VoiceWebSocket
 */
interface WebSocketEvents {
    "message": (message: WebSocketEvent) => void;
    "error": (error: Error) => void;
    "open": (event: Event) => void;
    "close": (event: CloseEvent) => void;
    "packet": (packet: any) => void;
}