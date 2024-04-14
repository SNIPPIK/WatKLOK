import {chooseEncryptionMode, randomNBit} from "@lib/voice/utils/Encryption";
import {SodiumEncryption} from "@lib/voice/utils/Sodium";
import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {VoiceWebSocket} from "@lib/voice/Socket/Web";
import {VoiceUDPSocket} from "@lib/voice/Socket/UDP";
import {TypedEmitter} from "tiny-typed-emitter";
import {Buffer} from "node:buffer";

const sodium = SodiumEncryption.getMethods(),
    CHANNELS = 2,
    TIMESTAMP_INC = (48_000 / 100) * CHANNELS,
    MAX_NONCE_SIZE = 2 ** 32 - 1;


/**
 * @author SNIPPIK
 * @description Интерфейс для подключения WS с UDP для передачи пакетов на сервера discord
 */
export class VoiceSocket extends TypedEmitter<VoiceSocketEvents> {
    private _state: VoiceSocketState;
    /**
     * @description Текущее состояние сетевого экземпляра
     * @public
     */
    public get state() { return this._state; }

    /**
     * @description Устанавливает новое состояние для сетевого экземпляра, выполняя операции очистки там, где это необходимо
     * @public
     */
    public set state(newState) {
        const oldWs = Reflect.get(this._state, 'ws') as VoiceWebSocket;
        const newWs = Reflect.get(newState, 'ws')    as VoiceWebSocket;
        const oldUDP = Reflect.get(this._state, 'udp')  as VoiceUDPSocket;
        const newUDP = Reflect.get(newState, 'udp')     as VoiceUDPSocket;

        if (oldWs && oldWs !== newWs) {
            oldWs.off("error", this.onError).off("open", this.onWsOpen).off("packet", this.onWsPacket).off("close", this.onWsClose)
            oldWs.destroy();
        }

        if (oldUDP && oldUDP !== newUDP) {
            oldUDP.off("error", this.onError).off("close", this.onUdpClose);
            oldUDP.destroy();
        }

        this.emit("stateChange", this._state, newState);
        this._state = newState;
    };

    /**
     * @description Отправляет пакет голосовому шлюзу, указывающий на то, что клиент начал/прекратил отправку аудио.
     * @param speaking - Следует ли показывать клиента говорящим или нет
     * @public
     */
    public set speaking(speaking: boolean) {
        const state = this.state;

        if (state.code !== VoiceSocketStatusCode.ready || state.connectionData.speaking === speaking) return;

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
     * @description Отправляет аудио пакет, ранее подготовленный с помощью prepare Audio Packet(opus Packet). Аудио пакет израсходован и не может быть отправлен повторно.
     * @public
     */
    public get preparedPacket() {
        const state = this.state;

        if ("preparedPacket" in state && state?.preparedPacket !== undefined) {
            this.playAudioPacket = state.preparedPacket;
            state.preparedPacket = undefined;
            return true;
        }

        return false;
    };

    /**
     * @description Воспроизводит аудио пакет, обновляя временные метаданные, используемые для воспроизведения.
     * @param audioPacket - Аудио пакет для воспроизведения
     */
    private set playAudioPacket(audioPacket: Buffer) {
        const state = this.state;

        if (state.code !== VoiceSocketStatusCode.ready) return;

        const { connectionData } = state;
        connectionData.packetsPlayed++;
        connectionData.sequence++;
        connectionData.timestamp += TIMESTAMP_INC;

        if (connectionData.sequence >= 2 ** 16) connectionData.sequence = 0;
        else if (connectionData.timestamp >= 2 ** 32) connectionData.timestamp = 0;

        this.speaking = true;
        state.udp.sendPacket = audioPacket;
    };

    public constructor(options: ConnectionOptions) {
        super();
        this.onWsOpen = this.onWsOpen.bind(this);
        this.onError = this.onError.bind(this);
        this.onWsPacket = this.onWsPacket.bind(this);
        this.onWsClose = this.onWsClose.bind(this);
        this.onUdpClose = this.onUdpClose.bind(this);

        this._state = {
            code: VoiceSocketStatusCode.upWS,
            ws: this.createWebSocket(options.endpoint),
            connectionOptions: options
        };
    };

    /**
     * @description Создает новый аудио пакет из пакета Opus. Для этого требуется зашифровать пакет,
     * а затем добавить заголовок, содержащий метаданные.
     *
     * @param opusPacket - Пакет Opus для приготовления
     */
    public preparedAudioPacket = (opusPacket: Buffer) => {
        const state = this.state;
        if (state.code !== VoiceSocketStatusCode.ready) return;

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
     * @description Шифрует пакет Opus, используя формат, согласованный экземпляром и Discord.
     *
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     */
    private encryptOpusPacket = (packet: Buffer, connectionData: ConnectionData)=>  {
        const { secretKey, encryptionMode } = connectionData;

        switch (encryptionMode) {
            case "xsalsa20_poly1305_suffix": {
                const random = sodium.random(24, connectionData.nonceBuffer);
                return [sodium.close(packet, random, secretKey), random];
            }
            case "xsalsa20_poly1305_lite": {
                connectionData.nonce++;
                if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
                connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);
                return [ sodium.close(packet, connectionData.nonceBuffer, secretKey), connectionData.nonceBuffer.subarray(0, 4) ];
            }
            default: return [sodium.close(packet, Buffer.alloc(24), secretKey)];
        }
    };

    /**
     * @description Создает новый веб-сокет для голосового шлюза Discord.
     * @param endpoint - Конечная точка, к которой нужно подключиться
     */
    private createWebSocket = (endpoint: string) => {
        return new VoiceWebSocket(`wss://${endpoint}?v=4`)
            .on("error", this.onError)
            .once("open", this.onWsOpen)
            .on("packet", this.onWsPacket)
            .once("close", this.onWsClose);
    };

    /**
     * @description Вызывается при открытии WebSocket. В зависимости от состояния, в котором находится экземпляр,
     * он либо идентифицируется с новым сеансом, либо попытается возобновить существующий сеанс.
     */
    private onWsOpen = () => {
        const state = this.state;
        const isResume = state.code === VoiceSocketStatusCode.resume;
        const isWs = state.code === VoiceSocketStatusCode.upWS;

        if (isResume || isWs) {
            state.ws.sendPacket ({
                op: isResume ? VoiceOpcodes.Resume : VoiceOpcodes.Identify,
                d: {
                    server_id: state.connectionOptions.serverId,
                    session_id: state.connectionOptions.sessionId,
                    user_id: isWs ? state.connectionOptions.userId : null,
                    token: state.connectionOptions.token,
                }
            });

            if (isWs) this.state = { ...this.state, code: VoiceSocketStatusCode.identify } as IdentifyState;
        }
    };

    /**
     * @description Вызывается при закрытии веб-сокета. В зависимости от причины закрытия (заданной параметром code)
     * экземпляр либо попытается возобновить работу, либо перейдет в закрытое состояние и выдаст событие "close"
     * с кодом закрытия, позволяя пользователю решить, хочет ли он повторно подключиться.
     * @param code - Код закрытия
     */
    private readonly onWsClose = ({ code }: {code: number}) => {
        const state = this.state;

        if (code === 4_015 || code < 4_000) {
            if (state.code === VoiceSocketStatusCode.ready) this.state = { ...state,
                ws: this.createWebSocket(state.connectionOptions?.endpoint),
                code: VoiceSocketStatusCode.resume
            };
        }
        else if (state.code !== VoiceSocketStatusCode.close) {
            this.destroy();
            this.emit("close", code);
        }
    };

    /**
     * @description Распространяет ошибки из дочернего голосового веб-сокета и голосового UDP-сокета.
     * @param error - Ошибка, которая была выдана дочерним элементом
     */
    private readonly onError = (error: Error) => { this.emit("error", error); }

    /**
     * @description Вызывается, когда UDP-сокет сам закрылся, если он перестал получать ответы от Discord.
     */
    private readonly onUdpClose = () => {
        if (this.state.code === VoiceSocketStatusCode.ready) this.state = { ...this.state,
            ws: this.createWebSocket(this.state.connectionOptions.endpoint),
            code: VoiceSocketStatusCode.resume
        };
    };

    /**
     * @description Вызывается при получении пакета на WebSocket соединения.
     * @param packet - Полученный пакет
     */
    private onWsPacket = (packet: {d: any, op: VoiceOpcodes}) => {
        const state = this.state;

        switch (packet.op) {
            //Время ожидания между отправкой сердечных сокращений в миллисекундах
            case VoiceOpcodes.Hello: {
                if (state.code !== VoiceSocketStatusCode.close) state.ws.HeartbeatInterval = packet.d.heartbeat_interval;
                return;
            }

            //Завершите обмен данными с websocket
            case VoiceOpcodes.Ready: {
                if (state.code === VoiceSocketStatusCode.identify) {
                    const {ip, port, ssrc, modes} = packet.d;

                    const udp = new VoiceUDPSocket({ip, port});
                    udp.on('error', this.onError);
                    udp.once('close', this.onUdpClose);
                    udp.IPDiscovery(ssrc).then((localConfig) => {
                        if (this.state.code !== VoiceSocketStatusCode.upUDP) return;
                        state.ws.sendPacket({
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
                        this.state = {...this.state, code: VoiceSocketStatusCode.protocol};
                    }).catch((error: Error) => this.emit('error', error));

                    this.state = {...state, udp, code: VoiceSocketStatusCode.upUDP, connectionData: {ssrc}};
                }
                return;
            }

            //Опишите сеанс
            case VoiceOpcodes.SessionDescription: {
                if (state.code === VoiceSocketStatusCode.protocol) {
                    const { mode: encryptionMode, secret_key: secretKey } = packet.d;
                    this.state = { ...state, code: VoiceSocketStatusCode.ready,
                        connectionData: {
                            ...state.connectionData,
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
                return;
            }

            //Подтвердите успешное возобновление сеанса
            case VoiceOpcodes.Resumed: {
                if (state.code === VoiceSocketStatusCode.resume) {
                    this.state = { ...state, code: VoiceSocketStatusCode.ready };
                    this.state.connectionData.speaking = false;
                }
            }
        }
    };

    /**
     * @description Уничтожает сетевой экземпляр, переводя его в закрытое состояние.
     * @public
     */
    public destroy() { this.state = {code: VoiceSocketStatusCode.close}; };
}

/**
 * @description Ивенты для VoiceSocket
 * @interface VoiceSocketEvents
 */
interface VoiceSocketEvents {
    "stateChange": (oldState: VoiceSocketState, newState: VoiceSocketState) => void;
    "error": (error: Error) => void;
    "close": (code: number) => void;
}

/**
 * @description Различные статусы, которые может иметь сетевой экземпляр. Порядок
 * состояний между открытиями и готовностью является хронологическим (сначала
 * экземпляр переходит к открытиям, затем к идентификации и т.д.)
 */
export enum VoiceSocketStatusCode {
    upWS,
    identify,
    upUDP,
    protocol,
    ready,
    resume,
    close,
}

/**
 * @status VoiceSocketStatusCode.upWS
 * @description Статус запуска VoiceWebSocket
 */
interface WebSocketState {
    code: VoiceSocketStatusCode.upWS;
    ws: VoiceWebSocket;
    connectionOptions: ConnectionOptions;
}

/**
 * @status VoiceSocketStatusCode.identify
 * @description Статус индификации
 */
interface IdentifyState {
    code: VoiceSocketStatusCode.identify;
    ws: VoiceWebSocket;
    connectionOptions: ConnectionOptions;
}

/**
 * @status VoiceSocketStatusCode.upUDP
 * @description Статус запуска VoiceUDPSocket
 */
interface UDPSocketState {
    code: VoiceSocketStatusCode.upUDP;
    ws: VoiceWebSocket;
    udp: VoiceUDPSocket;
    connectionData: Pick<ConnectionData, 'ssrc'>;
    connectionOptions: ConnectionOptions;
}

/**
 * @status VoiceSocketStatusCode.protocol
 * @description Статус определения протокола
 */
interface ProtocolState {
    code: VoiceSocketStatusCode.protocol;
    ws: VoiceWebSocket;
    udp: VoiceUDPSocket;
    connectionData: Pick<ConnectionData, 'ssrc'>;
    connectionOptions: ConnectionOptions;
}

/**
 * @status VoiceSocketStatusCode.ready
 * @description Статус о готовности голосового подключения
 */
interface ReadyState {
    code: VoiceSocketStatusCode.ready;
    preparedPacket?: Buffer | undefined;
    ws: VoiceWebSocket;
    udp: VoiceUDPSocket;
    connectionData: ConnectionData;
    connectionOptions: ConnectionOptions;
}

/**
 * @status VoiceSocketStatusCode.resume
 * @description Статус о возобновлении подключения
 */
interface ResumeState {
    code: VoiceSocketStatusCode.resume;
    preparedPacket?: Buffer | undefined;
    ws: VoiceWebSocket;
    udp: VoiceUDPSocket;
    connectionData: ConnectionData;
    connectionOptions: ConnectionOptions;
}

/**
 * @status VoiceSocketStatusCode.close
 * @description Статус о закрытии подключения
 */
interface CloseState {
    code: VoiceSocketStatusCode.close;
}

/**
 * @description Все статусы
 * @class VoiceSocket
 */
export type VoiceSocketState = WebSocketState | IdentifyState | UDPSocketState | ProtocolState | ReadyState | ResumeState | CloseState;

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