import { VoiceOpcodes } from "discord-api-types/voice/v4";
import { createSocket, type Socket } from "node:dgram";
import WebSocket, { type MessageEvent } from "ws";
import {TypedEmitter} from "tiny-typed-emitter";
import { isIPv4 } from "node:net";

/**
 * @description Интервал в миллисекундах, с которым отправляются дейтаграммы keep alive
 */
const KEEP_ALIVE_INTERVAL = 5e3;
/**
 * @description Максимальное значение счетчика keep alive
 */
const MAX_COUNTER_VALUE = 2 ** 32 - 1;


/**
 * @description Расширение класса WebSocket для обеспечения вспомогательной функциональности при взаимодействии с голосовым шлюзом Discord
 */
export class VoiceWebSocket extends TypedEmitter<VoiceWebSocketEvents> {
    /**
     * @description Текущий интервал, если таковой имеется.
     */
    private heartbeatInterval?: NodeJS.Timeout;

    /**
     * @description Время (миллисекунды с эпохи UNIX), в течение которого был получен последний пакет подтверждения сердцебиения.
     * @description Это значение равно 0, если пакет подтверждения еще не был получен.
     */
    private lastHeartbeatAck: number = 0;

    /**
     * @description Время (миллисекунды с эпохи UNIX), в течение которого был отправлен последний импульс. Это значение равно 0, если импульс еще не был отправлен
     */
    private lastHeartbeatSend: number = 0;

    /**
     * @description Количество последовательно пропущенных сердечных сокращений
     */
    private missedHeartbeats = 0;

    /**
     * @description Последний записанный пинг
     */
    public ping?: number;

    /**
     * @description Базовый веб-сокет этой оболочки
     */
    private readonly ws: WebSocket;

    /**
     * @description Создает новый голосовой веб-сокет.
     * @param address - Адрес, к которому нужно подключиться
     */
    public constructor(address: string) {
        super();
        this.ws = new WebSocket(address);
        this.ws.onmessage = (err) => this.onMessage(err);
        this.ws.onopen = (err) => this.emit('open', err);
        this.ws.onerror = (err: Error | WebSocket.ErrorEvent) => this.emit('error', err instanceof Error ? err : err.error);
        this.ws.onclose = (err) => this.emit('close', err);
    };

    /**
     * @description Уничтожает голосовой веб-сокет. Интервал очищается, и соединение закрывается
     */
    public destroy(code = 1e3) {
        try {
            this.setHeartbeatInterval(-1);
            this.ws.close(code);
        } catch (error) {
            this.emit('error', error as Error);
        }
    };

    /**
     * @description Обрабатывает события сообщений в WebSocket. Пытается проанализировать сообщения в формате JSON и отправить их в виде пакетов
     * @param event - Событие сообщения
     */
    public onMessage(event: MessageEvent) {
        if (typeof event.data !== 'string') return;

        try {
            const packet = JSON.parse(event.data);

            if (packet.op === VoiceOpcodes.HeartbeatAck) {
                this.lastHeartbeatAck = Date.now();
                this.missedHeartbeats = 0;
                this.ping = this.lastHeartbeatAck - this.lastHeartbeatSend;
            }

            this.emit("packet", packet);
        } catch (error) {
            this.emit('error', error as Error);
        }
    };

    /**
     * @description Отправляет пакет с возможностью преобразования в JSON-строку через WebSocket.
     * @param packet - Пакет для отправки
     */
    public sendPacket(packet: any) {
        try {
            this.ws.send(JSON.stringify(packet));
        } catch (error) {
            this.emit('error', error as Error);
        }
    };

    /**
     * @description Посылает сердцебиение по веб-сокету.
     */
    private sendHeartbeat() {
        this.lastHeartbeatSend = Date.now();
        this.missedHeartbeats++;

        this.sendPacket({ op: VoiceOpcodes.Heartbeat, d: this.lastHeartbeatSend });
    };

    /**
     * @description Устанавливает/очищает интервал для отправки сердечных сокращений по веб-сокету.
     * @param ms - Интервал в миллисекундах. Если значение отрицательное, интервал будет сброшен
     */
    public setHeartbeatInterval(ms: number) {
        if (this.heartbeatInterval !== undefined) clearInterval(this.heartbeatInterval);

        if (ms > 0) this.heartbeatInterval = setInterval(() => {
            if (this.lastHeartbeatSend !== 0 && this.missedHeartbeats >= 3) this.destroy(0);
            this.sendHeartbeat();
        }, ms);
    };
}
/**
 * @description Ивенты для VoiceWebSocket
 * @class VoiceWebSocket
 */
interface VoiceWebSocketEvents {
    "error": (error: Error) => void;
    "open": (event: WebSocket.Event) => void;
    "close": (event: WebSocket.CloseEvent) => void;
    "packet": (packet: any) => void;
}


/**
 * @description Управляет сетью UDP для голосового соединения
 */
export class VoiceUDPSocket extends TypedEmitter<VoiceUDPSocketEvents> {
    /**
     * @description Базовый сетевой сокет для голосового UDP-сокета.
     */
    private readonly socket: Socket;

    /**
     * @description Сведения о сокете для Discord (удаленный)
     */
    private readonly remote: SocketConfig;

    /**
     * @description Счетчик, используемый в механизме поддержания активности.
     */
    private keepAliveCounter = 0;

    /**
     * @description Буфер, используемый для записи в него счетчика keep alive.
     */
    private readonly keepAliveBuffer: Buffer = Buffer.alloc(8);

    /**
     * @description Интервал Node.js для механизма поддержания работоспособности.
     */
    private readonly keepAliveInterval: NodeJS.Timeout = setInterval(() => this.keepAlive(), KEEP_ALIVE_INTERVAL);

    /**
     * @description Создает новый голосовой UDP-сокет.
     * @param remote - Сведения об удаленном разъеме
     */
    public constructor(remote: SocketConfig) {
        super();
        this.socket = createSocket('udp4');
        this.socket.on('error', (error: Error) => this.emit('error', error));
        this.socket.on('message', (buffer: Buffer) => this.onMessage(buffer));
        this.socket.on('close', () => this.emit('close'));
        this.remote = remote;
        setImmediate(() => this.keepAlive());
    };

    /**
     * @description Вызывается при получении сообщения в сокете UDP.
     * @param buffer - Полученный буфер
     */
    private onMessage(buffer: Buffer): void { this.emit('message', buffer); }

    /**
     * @description Проверяем через регулярные промежутки времени, чтобы проверить, можем ли мы по-прежнему отправлять дейтаграммы в Discord.
     */
    private keepAlive() {
        this.keepAliveBuffer.writeUInt32LE(this.keepAliveCounter, 0);
        this.send(this.keepAliveBuffer);
        this.keepAliveCounter++;

        if (this.keepAliveCounter > MAX_COUNTER_VALUE) this.keepAliveCounter = 0;
    };

    /**
     * @description Отправляет буфер в Discord.
     * @param buffer - Буфер для отправки
     */
    public send(buffer: Buffer) {
        this.socket.send(buffer, this.remote.port, this.remote.ip);
    };

    /**
     * @description Закрывает сокет, экземпляр не сможет быть повторно использован.
     */
    public destroy() {
        try {
            this.socket.close();
        } catch {}

        clearInterval(this.keepAliveInterval);
    };

    /**
     * @description Выполняет обнаружение IP-адреса для определения локального адреса и порта, которые будут использоваться для голосового соединения.
     * @param ssrc - SSRC, полученный от Discord
     */
    public performIPDiscovery(ssrc: number): Promise<SocketConfig> {
        return new Promise((resolve, reject) => {
            const listener = (message: Buffer) => {
                try {
                    if (message.readUInt16BE(0) !== 2) return;
                    const packet = parseLocalPacket(message);
                    this.socket.off('message', listener);
                    resolve(packet);
                } catch {}
            };

            this.socket.on('message', listener);
            this.socket.once('close', () => reject(new Error('Cannot perform IP discovery - socket closed')));

            const discoveryBuffer = Buffer.alloc(74);

            discoveryBuffer.writeUInt16BE(1, 0);
            discoveryBuffer.writeUInt16BE(70, 2);
            discoveryBuffer.writeUInt32BE(ssrc, 4);
            this.send(discoveryBuffer);
        });
    };
}
/**
 * @description Ивенты для VoiceUDPSocket
 * @class VoiceWebSocket
 */
interface VoiceUDPSocketEvents {
    'message': (message: Buffer) => void;
    'error': (error: Error) => void;
    'close': () => void;
}


/**
 * @description Хранит IP-адрес и порт. Используется для хранения сведений о сокете для локального клиента, а также для Discord
 */
export interface SocketConfig {
    ip: string;
    port: number;
}

/**
 * @description Анализирует ответ от Discord, чтобы помочь с обнаружением локального IP-адреса
 * @param message - Полученное сообщение
 */
export function parseLocalPacket(message: Buffer): SocketConfig {
    const packet = Buffer.from(message);
    const ip = packet.subarray(8, packet.indexOf(0, 8)).toString('utf8');

    if (!isIPv4(ip)) throw new Error('Malformed IP address');

    return { ip,
        port: packet.readUInt16BE(packet.length - 2)
    };
}