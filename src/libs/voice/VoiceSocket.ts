import {chooseEncryptionMode, randomNBit} from "./utils/Encryption";
import {createSocket, type Socket as TSocket} from "node:dgram";
import {VoiceOpcodes} from "discord-api-types/voice/v4";
import { CloseEvent, WebSocket, Event } from "ws";
import {TypedEmitter} from "tiny-typed-emitter";
import {SodiumEncryption} from "./utils/Sodium";
import { Buffer } from "node:buffer";
import {isIPv4} from "node:net";

const sodium = SodiumEncryption.getMethods(), CHANNELS = 2, TIMESTAMP_INC = (48_000 / 100) * CHANNELS, MAX_NONCE_SIZE = 2 ** 32 - 1;

/**
 * @author SNIPPIK
 * @description Пространство с VoiceSocket
 * @namespace VoiceSocket
 */
export namespace VoiceSocket {
    /**
     * @description Расширение класса WebSocket для обеспечения вспомогательной функциональности при взаимодействии с голосовым шлюзом Discord
     * @class VoiceWeb
     */
    export class Web extends TypedEmitter<WebSocketEvents> {
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

            ws.onopen = (err) => this.emit('open', err);
            ws.onerror = (err) => this.emit('error', err instanceof Error ? err : err.error);
            ws.onclose = (err) => this.emit('close', err);
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
                    this.emit('error', error as Error);
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
     * @description Управляет сетью UDP для голосового соединения
     * @class VoiceUDP
     */
    export class UDP extends TypedEmitter<UDPSocketEvents> {
        private readonly data = {
            remote: null as SocketConfig,
            socket: null as TSocket
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
                const discoveryBuffer = Buffer.alloc(74);
                discoveryBuffer.writeUInt16BE(1, 0);
                discoveryBuffer.writeUInt16BE(70, 2);
                discoveryBuffer.writeUInt32BE(ssrc, 4);
                this.send = discoveryBuffer;

                this.data.socket
                    .on("close", () => {
                        return reject(new Error('Cannot perform IP discovery - socket closed'));
                    })
                    .on("message", (message) => {
                        if (message.readUInt16BE(0) !== 2) return;

                        try {
                            const packet = Buffer.from(message);
                            const ip = packet.subarray(8, packet.indexOf(0, 8)).toString('utf8');

                            if (!isIPv4(ip)) return reject(new Error('Malformed IP address'));
                            this.data.socket.removeListener("message", () => {});

                            return resolve({ ip, port: packet.readUInt16BE(packet.length - 2) });
                        } catch {
                            return resolve(null);
                        }
                    });
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

    /**
     * @description Ивенты для VoiceUDPSocket
     * @class VoiceWebSocket
     */
    interface UDPSocketEvents {
        'message': (message: Buffer) => void;
        'error': (error: Error) => void;
        'close': () => void;
    }

    /**
     * @description Хранит IP-адрес и порт. Используется для хранения сведений о сокете для локального клиента, а также для Discord
     */
    interface SocketConfig {
        ip: string;
        port: number;
    }
}

/**
 * @author SNIPPIK
 * @description Класс связывающий VoiceSocket.WEB и VoiceSocket.UDP
 * @class Networking
 */
export class Networking extends TypedEmitter<NetworkingEvents> {
    private _state: Networking.State;
    /**
     * @description Текущее состояние сетевого экземпляра
     * @public
     */
    public get state(): Networking.State { return this._state; }

    /**
     * @description Отправляет пакет голосовому шлюзу, указывающий на то, что клиент начал/прекратил отправку аудио.
     * @param speaking - Следует ли показывать клиента говорящим или нет
     * @public
     */
    public set speaking(speaking: boolean) {
        const state = this.state;

        if (state.code !== Networking.StatusCode.Ready) return;
        else if (state.connectionData.speaking === speaking) return;

        state.connectionData.speaking = speaking;
        state.ws.sendPacket({
            op: VoiceOpcodes.Speaking,
            d: {
                speaking: speaking ? 1 : 0,
                delay: 0,
                ssrc: state.connectionData.ssrc,
            },
        });
    };

    /**
     * @description Устанавливает новое состояние для сетевого экземпляра, выполняя операции очистки там, где это необходимо
     * @public
     */
    public set state(newState: Networking.State) {
        const oldWs = Reflect.get(this._state, 'ws') as VoiceSocket.Web;
        const newWs = Reflect.get(newState, 'ws')    as VoiceSocket.Web;

        if (oldWs && oldWs !== newWs) {
            oldWs.off('error', this.onChildError).off('open', this.onWsOpen).off('packet', this.onWsPacket).off('close', this.onWsClose)
            oldWs.destroy();
        }

        const oldUDP = Reflect.get(this._state, 'udp')as VoiceSocket.UDP;
        const newUDP = Reflect.get(newState, 'udp')   as VoiceSocket.UDP;

        if (oldUDP && oldUDP !== newUDP) {
            oldUDP.off('error', this.onChildError).off('close', this.onUdpClose);
            oldUDP.destroy();
        }

        this.emit('stateChange', this._state, newState);
        this._state = newState;
    };

    /**
     * @description Отправляет аудио пакет, ранее подготовленный с помощью prepare Audio Packet(opus Packet). Аудио пакет израсходован и не может быть отправлен повторно.
     * @public
     */
    public get dispatchAudio() {
        const state = this.state;

        if ("preparedPacket" in state && state?.preparedPacket !== undefined) {
            this.playAudioPacket(state.preparedPacket);
            state.preparedPacket = undefined;
            return true;
        }

        return false;
    };

    public constructor(options: ConnectionOptions) {
        super();

        this.onWsOpen = this.onWsOpen.bind(this);
        this.onChildError = this.onChildError.bind(this);
        this.onWsPacket = this.onWsPacket.bind(this);
        this.onWsClose = this.onWsClose.bind(this);
        this.onUdpClose = this.onUdpClose.bind(this);

        this._state = {
            code: Networking.StatusCode.OpeningWs,
            ws: this.createWebSocket(options.endpoint),
            connectionOptions: options,
        };
    }

    /**
     * @description Создает новый аудио пакет из пакета Opus. Для этого требуется зашифровать пакет,
     * а затем добавить заголовок, содержащий метаданные.
     *
     * @param opusPacket - Пакет Opus для приготовления
     */
    public prepareAudioPacket(opusPacket: Buffer) {
        const state = this.state;
        if (state.code !== Networking.StatusCode.Ready) return;

        const { sequence, timestamp, ssrc } = state.connectionData;
        const packetBuffer = Buffer.alloc(12); packetBuffer[0] = 0x80; packetBuffer[1] = 0x78;

        packetBuffer.writeUIntBE(sequence, 2, 2);
        packetBuffer.writeUIntBE(timestamp, 4, 4);
        packetBuffer.writeUIntBE(ssrc, 8, 4);
        packetBuffer.copy(Buffer.alloc(24), 0, 0, 12);

        state.preparedPacket = Buffer.concat([packetBuffer, ...this.encryptOpusPacket(opusPacket, state.connectionData)]);
        return state.preparedPacket;
    };

    /**
     * @description Создает новый веб-сокет для голосового шлюза Discord.
     * @param endpoint - Конечная точка, к которой нужно подключиться
     */
    private createWebSocket(endpoint: string) {
        return new VoiceSocket.Web(`wss://${endpoint}?v=4`)
            .on('error', this.onChildError)
            .once('open', this.onWsOpen)
            .on('packet', this.onWsPacket)
            .once('close', this.onWsClose);
    };

    /**
     * @description Вызывается при открытии WebSocket. В зависимости от состояния, в котором находится экземпляр,
     * он либо идентифицируется с новым сеансом, либо попытается возобновить существующий сеанс.
     */
    private onWsOpen() {
        if (this.state.code === Networking.StatusCode.Resuming) this.state.ws.sendPacket({
            op: VoiceOpcodes.Resume,
            d: {
                server_id: this.state.connectionOptions.serverId,
                session_id: this.state.connectionOptions.sessionId,
                token: this.state.connectionOptions.token,
            }
        });

        else if (this.state.code === Networking.StatusCode.OpeningWs) {
            this.state.ws.sendPacket({
                op: VoiceOpcodes.Identify,
                d: {
                    server_id: this.state.connectionOptions.serverId,
                    user_id: this.state.connectionOptions.userId,
                    session_id: this.state.connectionOptions.sessionId,
                    token: this.state.connectionOptions.token,
                }});
            this.state = { ...this.state, code: Networking.StatusCode.Identifying };
        }
    };

    /**
     * @description Вызывается при закрытии веб-сокета. В зависимости от причины закрытия (заданной параметром code)
     * экземпляр либо попытается возобновить работу, либо перейдет в закрытое состояние и выдаст событие "close"
     * с кодом закрытия, позволяя пользователю решить, хочет ли он повторно подключиться.
     * @param code - Код закрытия
     */
    private onWsClose({ code }: CloseEvent) {
        if ((code === 4_015 || code < 4_000) && this.state.code === Networking.StatusCode.Ready) this.state = { ...this.state,
            ws: this.createWebSocket(this.state.connectionOptions.endpoint),
            code: Networking.StatusCode.Resuming
        };

        else if (this.state.code !== Networking.StatusCode.Closed) {
            this.destroy();
            this.emit('close', code);
        }
    };

    /**
     * @description Распространяет ошибки из дочернего голосового веб-сокета и голосового UDP-сокета.
     * @param error - Ошибка, которая была выдана дочерним элементом
     */
    private onChildError(error: Error) { this.emit("error", error); }

    /**
     * @description Вызывается, когда UDP-сокет сам закрылся, если он перестал получать ответы от Discord.
     */
    private onUdpClose() {
        if (this.state.code === Networking.StatusCode.Ready) this.state = { ...this.state,
            ws: this.createWebSocket(this.state.connectionOptions.endpoint),
            code: Networking.StatusCode.Resuming
        };
    };

    /**
     * @description Вызывается при получении пакета на WebSocket соединения.
     * @param packet - Полученный пакет
     */
    private onWsPacket(packet: {d: any, op: VoiceOpcodes}) {
        if (packet.op === VoiceOpcodes.Hello) {
            if (this.state.code !== Networking.StatusCode.Closed) this.state.ws.setHeartbeatInterval(packet.d.heartbeat_interval);
        } else if (packet.op === VoiceOpcodes.Ready) {
            if (this.state.code === Networking.StatusCode.Identifying) {
                const {ip, port, ssrc, modes} = packet.d;

                const udp = new VoiceSocket.UDP({ip, port});
                udp.on('error', this.onChildError);
                udp.once('close', this.onUdpClose);
                udp.performIPDiscovery(ssrc).then((localConfig) => {
                    if (this.state.code !== Networking.StatusCode.UdpHandshaking) return;
                    this.state.ws.sendPacket({
                        op: VoiceOpcodes.SelectProtocol,
                        d: {
                            protocol: 'udp',
                            data: {
                                address: localConfig.ip,
                                port: localConfig.port,
                                mode: chooseEncryptionMode(modes),
                            },
                        }
                    });
                    this.state = {...this.state, code: Networking.StatusCode.SelectingProtocol};
                }).catch((error: Error) => this.emit('error', error));

                this.state = {...this.state, udp, code: Networking.StatusCode.UdpHandshaking, connectionData: {ssrc}};
            }
        } else if (packet.op === VoiceOpcodes.SessionDescription) {
            if (this.state.code === Networking.StatusCode.SelectingProtocol) {
                const { mode: encryptionMode, secret_key: secretKey } = packet.d;
                this.state = { ...this.state, code: Networking.StatusCode.Ready,
                    connectionData: {
                        ...this.state.connectionData,
                        encryptionMode,
                        secretKey: new Uint8Array(secretKey),
                        sequence: randomNBit(16),
                        timestamp: randomNBit(32),
                        nonce: 0,
                        nonceBuffer: Buffer.alloc(24),
                        speaking: false,
                        packetsPlayed: 0,
                    }
                };
            }
        } else if (packet.op === VoiceOpcodes.Resumed) {
            if (this.state.code === Networking.StatusCode.Resuming) {
                this.state = { ...this.state, code: Networking.StatusCode.Ready };
                this.state.connectionData.speaking = false;
            }
        }
    };

    /**
     * @description Воспроизводит аудио пакет, обновляя временные метаданные, используемые для воспроизведения.
     * @param audioPacket - Аудио пакет для воспроизведения
     */
    private playAudioPacket(audioPacket: Buffer) {
        const state = this.state;

        if (state.code !== Networking.StatusCode.Ready) return;

        const { connectionData } = state;
        connectionData.packetsPlayed++;
        connectionData.sequence++;
        connectionData.timestamp += TIMESTAMP_INC;

        if (connectionData.sequence >= 2 ** 16) connectionData.sequence = 0;
        else if (connectionData.timestamp >= 2 ** 32) connectionData.timestamp = 0;

        this.speaking = true;
        state.udp.send = audioPacket;
    };

    /**
     * @description Шифрует пакет Opus, используя формат, согласованный экземпляром и Discord.
     *
     * @param opusPacket - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     */
    private encryptOpusPacket(opusPacket: Buffer, connectionData: ConnectionData) {
        const { secretKey, encryptionMode } = connectionData;

        switch (encryptionMode) {
            case "xsalsa20_poly1305_suffix": {
                const random = sodium.random(24, connectionData.nonceBuffer);
                return [sodium.close(opusPacket, random, secretKey), random];
            }

            case "xsalsa20_poly1305_lite": {
                connectionData.nonce++;
                if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
                connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);
                return [ sodium.close(opusPacket, connectionData.nonceBuffer, secretKey), connectionData.nonceBuffer.subarray(0, 4) ];
            }

            default: return [sodium.close(opusPacket, Buffer.alloc(24), secretKey)];
        }
    };

    /**
     * @description Уничтожает сетевой экземпляр, переводя его в закрытое состояние.
     * @public
     */
    public destroy() { this.state = { code: Networking.StatusCode.Closed }; }
}

/**
 * @author SNIPPIK
 * @description
 * @namespace Networking
 */
export namespace Networking {
    /**
     * @description Различные статусы, которые может иметь сетевой экземпляр. Порядок
     * состояний между открытиями и готовностью является хронологическим (сначала
     * экземпляр переходит к открытиям, затем к идентификации и т.д.)
     */
    export enum StatusCode {
        OpeningWs,
        Identifying,
        UdpHandshaking,
        SelectingProtocol,
        Ready,
        Resuming,
        Closed,
    }

    /**
     * @description Начальное сетевое состояние. Экземпляры будут находиться в этом состоянии при открытии соединения WebSocket с
     * голосовым шлюзом Discord.
     */
    interface OpeningWsState {
        code: StatusCode.OpeningWs;
        connectionOptions: ConnectionOptions;
        ws: VoiceSocket.Web;
    }

    /**
     * @description Состояние, в котором будет находиться сетевой экземпляр, когда он попытается авторизовать себя.
     */
    interface IdentifyingState {
        code: StatusCode.Identifying;
        connectionOptions: ConnectionOptions;
        ws: VoiceSocket.Web;
    }

    /**
     * @description Состояние, в котором будет находиться сетевой экземпляр при открытии UDP-соединения с IP и портом, предоставляемыми
     * Discord, а также при выполнении обнаружения IP.
     */
    interface UdpHandshakingState {
        code: StatusCode.UdpHandshaking;
        connectionData: Pick<ConnectionData, 'ssrc'>;
        connectionOptions: ConnectionOptions;
        udp: VoiceSocket.UDP;
        ws: VoiceSocket.Web;
    }

    /**
     * @description Состояние, в котором будет находиться сетевой экземпляр при выборе протокола шифрования для аудио пакетов.
     */
    interface SelectingProtocolState {
        code: StatusCode.SelectingProtocol;
        connectionData: Pick<ConnectionData, 'ssrc'>;
        connectionOptions: ConnectionOptions;
        udp: VoiceSocket.UDP;
        ws: VoiceSocket.Web;
    }

    /**
     * @description Состояние, в котором будет находиться сетевой экземпляр, когда у него будет полностью установлено подключение к
     * голосовому серверу Discord.
     */
    interface ReadyState {
        code: StatusCode.Ready;
        connectionData: ConnectionData;
        connectionOptions: ConnectionOptions;
        preparedPacket?: Buffer | undefined;
        udp: VoiceSocket.UDP;
        ws: VoiceSocket.Web;
    }

    /**
     * @description Состояние, в котором будет находиться сетевой экземпляр, когда его соединение неожиданно прервано, и он
     * пытается возобновить существующий сеанс.
     */
    interface ResumingState {
        code: StatusCode.Resuming;
        connectionData: ConnectionData;
        connectionOptions: ConnectionOptions;
        preparedPacket?: Buffer | undefined;
        udp: VoiceSocket.UDP;
        ws: VoiceSocket.Web;
    }

    /**
     * @description Состояние, в котором будет находиться сетевой экземпляр, когда он будет уничтожен. Его невозможно восстановить из этого
     * состояния.
     */
    interface ClosedState {
        code: StatusCode.Closed;
    }

    /**
     * @description Различные состояния, в которых может находиться сетевой экземпляр.
     */
    export type State = | ClosedState | IdentifyingState | OpeningWsState | ReadyState
        | ResumingState | SelectingProtocolState | UdpHandshakingState;
}

/**
 * @description Ивенты для Networking
 * @class Networking
 */
interface NetworkingEvents {
    "stateChange": (oldState: Networking.State, newState: Networking.State) => void;
    "error": (error: Error) => void;
    "close": (code: number) => void;
}

/**
 * @description Сведения, необходимые для подключения к голосовому шлюзу Discord. Эти сведения
 * сначала поступают на главный шлюз бота в виде пакетов VOICE_SERVER_UPDATE
 * и VOICE_STATE_UPDATE.
 */
interface ConnectionOptions {
    endpoint: string;
    serverId: string;
    sessionId: string;
    token: string;
    userId: string;
}

/**
 * @description Информация о текущем соединении, например, какой режим шифрования должен использоваться при
 * соединении, информации о времени воспроизведения потоков.
 */
interface ConnectionData {
    encryptionMode: string;
    nonce: number;
    nonceBuffer: Buffer;
    packetsPlayed: number;
    secretKey: Uint8Array;
    sequence: number;
    speaking: boolean;
    ssrc: number;
    timestamp: number;
}