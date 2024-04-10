import {TypedEmitter} from "tiny-typed-emitter";
import {createSocket, Socket} from "node:dgram";
import {Buffer} from "node:buffer";
import {isIPv4} from "node:net";

/**
 * @author SNIPPIK
 * @description Управляет сетью UDP для голосового соединения
 * @class VoiceUDPSocket
 */
export class VoiceUDPSocket extends TypedEmitter<UDPSocketEvents> {
    private readonly data = {
        remote: null as SocketConfig,
        socket: null as Socket
    };
    private readonly _keepAlive = {
        interval: setInterval(() => this.keepAlive = 2 ** 32 - 1, 5e3),
        buffer: Buffer.alloc(8),
        counter: 0
    };
    /**
     * @description Создает новый голосовой UDP-сокет.
     * @param version - Версия User Datagram Protocol (UDP)
     * @private
     */
    private set setSocket(version: 4 | 6) {
        this.data.socket = createSocket("udp" + version as any)
            .on("error", (err) => {
                this.emit('error', err);
            })
            .on("message", (buffer) => {
                this.emit('message', buffer);
            })
            .on("close", () => {
                this.emit("close");
            });
    };

    /**
     * @description Проверяем через регулярные промежутки времени, чтобы проверить, можем ли мы по-прежнему отправлять дейтаграммы в Discord.
     * @private
     */
    private set keepAlive(counter: number) {
        this._keepAlive.buffer.writeUInt32LE(this._keepAlive.counter, 0);
        this.send = this._keepAlive.buffer;
        this._keepAlive.counter++;

        if (this._keepAlive.counter > counter) this._keepAlive.counter = 0;
    };

    /**
     * @description Отправляет буфер в Discord.
     * @param buffer - Буфер для отправки
     * @public
     */
    public set send(buffer: Buffer) {
        this.data.socket.send(buffer, this.data.remote.port, this.data.remote.ip);
    };

    /**
     * @description Создает новый голосовой UDP-сокет.
     * @param remote - Сведения об удаленном разъеме
     */
    public constructor(remote: SocketConfig) {
        super();

        setImmediate(() => this.keepAlive = 2 ** 32 - 1);
        this.data.remote = remote;
        this.setSocket = 4;
    };

    /**
     * @description Выполняет обнаружение IP-адреса для определения локального адреса и порта, которые будут использоваться для голосового соединения.
     * @param ssrc - SSRC, полученный от Discord
     */
    public performIPDiscovery(ssrc: number): Promise<SocketConfig> {
        return new Promise((resolve, reject) => {
            this.data.socket
                .on("close", () => {
                    return reject(new Error("Cannot perform IP discovery - socket closed\n - Check your firewall!"));
                })
                .on("message", (message) => {
                    if (message.readUInt16BE(0) !== 2) return;

                    try {
                        const packet = Buffer.from(message);
                        const ip = packet.subarray(8, packet.indexOf(0, 8)).toString("utf8");

                        if (!isIPv4(ip)) return reject(new Error("Malformed IP address"));
                        this.data.socket.removeListener("message", () => {});

                        return resolve({ ip, port: packet.readUInt16BE(packet.length - 2) });
                    } catch {
                        return resolve(null);
                    }
                });

            const discoveryBuffer = Buffer.alloc(74);
            discoveryBuffer.writeUInt16BE(1, 0);
            discoveryBuffer.writeUInt16BE(70, 2);
            discoveryBuffer.writeUInt32BE(ssrc, 4);
            this.send = discoveryBuffer;
        });
    };

    /**
     * @description Закрывает сокет, экземпляр не сможет быть повторно использован.
     */
    public destroy() {
        try {
            this.data.socket.close();
        } catch {}

        clearInterval(this._keepAlive.interval);
    };
}

/**
 * @description Ивенты для UDP
 * @class VoiceWebSocket
 */
interface UDPSocketEvents {
    "message": (message: Buffer) => void;
    "error": (error: Error) => void;
    "close": () => void;
}

/**
 * @description Хранит IP-адрес и порт. Используется для хранения сведений о сокете для локального клиента, а также для Discord
 */
interface SocketConfig {
    ip: string;
    port: number;
}