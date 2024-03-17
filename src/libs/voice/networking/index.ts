import {chooseEncryptionMode, randomNBit, TIMESTAMP_INC, MAX_NONCE_SIZE} from "@lib/voice/utils/Encryption";
import { VoiceWebSocket, VoiceUDPSocket } from "./WebSocket";
import { VoiceOpcodes } from "discord-api-types/voice/v4";
import {TypedEmitter} from "tiny-typed-emitter";
import {Sodium} from "../utils/Sodium";
import { Buffer } from "node:buffer";
import { CloseEvent } from "ws";

/**
 * @description Управляет сетью, необходимой для поддержания голосового соединения и отправки аудио пакетов
 */
export class Networking extends TypedEmitter<NetworkingEvents> {
    private _state: NetworkingState;
    public constructor(options: ConnectionOptions) {
        super();

        this.onWsOpen = this.onWsOpen.bind(this);
        this.onChildError = this.onChildError.bind(this);
        this.onWsPacket = this.onWsPacket.bind(this);
        this.onWsClose = this.onWsClose.bind(this);
        this.onUdpClose = this.onUdpClose.bind(this);

        this._state = {
            code: NetworkingStatusCode.OpeningWs,
            ws: this.createWebSocket(options.endpoint),
            connectionOptions: options,
        };
    }

    /**
     * @description Уничтожает сетевой экземпляр, переводя его в закрытое состояние.
     * @public
     */
    public destroy() { this.state = { code: NetworkingStatusCode.Closed }; }

    /**
     * @description Текущее состояние сетевого экземпляра
     * @public
     */
    public get state(): NetworkingState { return this._state; }

    /**
     * @description Устанавливает новое состояние для сетевого экземпляра, выполняя операции очистки там, где это необходимо
     * @public
     */
    public set state(newState: NetworkingState) {
        const oldWs = Reflect.get(this._state, 'ws') as VoiceWebSocket;
        const newWs = Reflect.get(newState, 'ws')    as VoiceWebSocket;

        if (oldWs && oldWs !== newWs) {
            oldWs.off('error', this.onChildError).off('open', this.onWsOpen).off('packet', this.onWsPacket).off('close', this.onWsClose)
            oldWs.destroy();
        }

        const oldUDP = Reflect.get(this._state, 'udp')as VoiceUDPSocket;
        const newUDP = Reflect.get(newState, 'udp')   as VoiceUDPSocket;

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
    public dispatchAudio() {
        const state = this.state;

        if ("preparedPacket" in state && state?.preparedPacket !== undefined) {
            this.playAudioPacket(state.preparedPacket);
            state.preparedPacket = undefined;
            return true;
        }

        return false;
    };

    /**
     * @description Отправляет пакет голосовому шлюзу, указывающий на то, что клиент начал/прекратил отправку аудио.
     * @param speaking - Следует ли показывать клиента говорящим или нет
     * @public
     */
    public setSpeaking(speaking: boolean) {
        const state = this.state;

        if (state.code !== NetworkingStatusCode.Ready) return;
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
     * @description Создает новый аудио пакет из пакета Opus. Для этого требуется зашифровать пакет,
     * а затем добавить заголовок, содержащий метаданные.
     *
     * @param opusPacket - Пакет Opus для приготовления
     */
    public prepareAudioPacket(opusPacket: Buffer) {
        const state = this.state;
        if (state.code !== NetworkingStatusCode.Ready) return;

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
        return new VoiceWebSocket(`wss://${endpoint}?v=4`)
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
        if (this.state.code === NetworkingStatusCode.Resuming) this.state.ws.sendPacket({
            op: VoiceOpcodes.Resume,
            d: {
                server_id: this.state.connectionOptions.serverId,
                session_id: this.state.connectionOptions.sessionId,
                token: this.state.connectionOptions.token,
            }
        });

        else if (this.state.code === NetworkingStatusCode.OpeningWs) {
            this.state.ws.sendPacket({
                op: VoiceOpcodes.Identify,
                d: {
                    server_id: this.state.connectionOptions.serverId,
                    user_id: this.state.connectionOptions.userId,
                    session_id: this.state.connectionOptions.sessionId,
                    token: this.state.connectionOptions.token,
                }});
            this.state = { ...this.state, code: NetworkingStatusCode.Identifying };
        }
    };

    /**
     * @description Вызывается при закрытии веб-сокета. В зависимости от причины закрытия (заданной параметром code)
     * экземпляр либо попытается возобновить работу, либо перейдет в закрытое состояние и выдаст событие "close"
     * с кодом закрытия, позволяя пользователю решить, хочет ли он повторно подключиться.
     * @param code - Код закрытия
     */
    private onWsClose({ code }: CloseEvent) {
        if ((code === 4_015 || code < 4_000) && this.state.code === NetworkingStatusCode.Ready) this.state = { ...this.state,
            ws: this.createWebSocket(this.state.connectionOptions.endpoint),
            code: NetworkingStatusCode.Resuming
        };

        else if (this.state.code !== NetworkingStatusCode.Closed) {
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
        if (this.state.code === NetworkingStatusCode.Ready) this.state = { ...this.state,
            ws: this.createWebSocket(this.state.connectionOptions.endpoint),
            code: NetworkingStatusCode.Resuming
        };
    };

    /**
     * @description Вызывается при получении пакета на WebSocket соединения.
     * @param packet - Полученный пакет
     */
    private onWsPacket(packet: {d: any, op: VoiceOpcodes}) {
        if (packet.op === VoiceOpcodes.Hello) {
            if (this.state.code !== NetworkingStatusCode.Closed) this.state.ws.setHeartbeatInterval(packet.d.heartbeat_interval);
        } else if (packet.op === VoiceOpcodes.Ready) {
            if (this.state.code === NetworkingStatusCode.Identifying) {
                const {ip, port, ssrc, modes} = packet.d;

                const udp = new VoiceUDPSocket({ip, port});
                udp.on('error', this.onChildError);
                udp.once('close', this.onUdpClose);
                udp.performIPDiscovery(ssrc).then((localConfig) => {
                    if (this.state.code !== NetworkingStatusCode.UdpHandshaking) return;
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
                    this.state = {...this.state, code: NetworkingStatusCode.SelectingProtocol};
                }).catch((error: Error) => this.emit('error', error));

                this.state = {...this.state, udp, code: NetworkingStatusCode.UdpHandshaking, connectionData: {ssrc}};
            }
        } else if (packet.op === VoiceOpcodes.SessionDescription) {
            if (this.state.code === NetworkingStatusCode.SelectingProtocol) {
                const { mode: encryptionMode, secret_key: secretKey } = packet.d;
                this.state = { ...this.state, code: NetworkingStatusCode.Ready,
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
            if (this.state.code === NetworkingStatusCode.Resuming) {
                this.state = { ...this.state, code: NetworkingStatusCode.Ready };
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

        if (state.code !== NetworkingStatusCode.Ready) return;

        const { connectionData } = state;
        connectionData.packetsPlayed++;
        connectionData.sequence++;
        connectionData.timestamp += TIMESTAMP_INC;

        if (connectionData.sequence >= 2 ** 16) connectionData.sequence = 0;
        else if (connectionData.timestamp >= 2 ** 32) connectionData.timestamp = 0;

        this.setSpeaking(true);
        state.udp.send(audioPacket);
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
                const random = Sodium.random(24, connectionData.nonceBuffer);
                return [Sodium.close(opusPacket, random, secretKey), random];
            }

            case "xsalsa20_poly1305_lite": {
                connectionData.nonce++;
                if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
                connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);
                return [ Sodium.close(opusPacket, connectionData.nonceBuffer, secretKey), connectionData.nonceBuffer.subarray(0, 4) ];
            }

            default: return [Sodium.close(opusPacket, Buffer.alloc(24), secretKey)];
        }
    };
}
/**
 * @description Ивенты для Networking
 * @class Networking
 */
interface NetworkingEvents {
    "stateChange": (oldState: NetworkingState, newState: NetworkingState) => void;
    "error": (error: Error) => void;
    "close": (code: number) => void;
}


/**
 * @description Различные статусы, которые может иметь сетевой экземпляр. Порядок
 * состояний между открытиями и готовностью является хронологическим (сначала
 * экземпляр переходит к открытиям, затем к идентификации и т.д.)
 */
export enum NetworkingStatusCode {
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
export interface NetworkingOpeningWsState {
    code: NetworkingStatusCode.OpeningWs;
    connectionOptions: ConnectionOptions;
    ws: VoiceWebSocket;
}

/**
 * @description Состояние, в котором будет находиться сетевой экземпляр, когда он попытается авторизовать себя.
 */
export interface NetworkingIdentifyingState {
    code: NetworkingStatusCode.Identifying;
    connectionOptions: ConnectionOptions;
    ws: VoiceWebSocket;
}

/**
 * @description Состояние, в котором будет находиться сетевой экземпляр при открытии UDP-соединения с IP и портом, предоставляемыми
 * Discord, а также при выполнении обнаружения IP.
 */
export interface NetworkingUdpHandshakingState {
    code: NetworkingStatusCode.UdpHandshaking;
    connectionData: Pick<ConnectionData, 'ssrc'>;
    connectionOptions: ConnectionOptions;
    udp: VoiceUDPSocket;
    ws: VoiceWebSocket;
}

/**
 * @description Состояние, в котором будет находиться сетевой экземпляр при выборе протокола шифрования для аудио пакетов.
 */
export interface NetworkingSelectingProtocolState {
    code: NetworkingStatusCode.SelectingProtocol;
    connectionData: Pick<ConnectionData, 'ssrc'>;
    connectionOptions: ConnectionOptions;
    udp: VoiceUDPSocket;
    ws: VoiceWebSocket;
}

/**
 * @description Состояние, в котором будет находиться сетевой экземпляр, когда у него будет полностью установлено подключение к
 * голосовому серверу Discord.
 */
export interface NetworkingReadyState {
    code: NetworkingStatusCode.Ready;
    connectionData: ConnectionData;
    connectionOptions: ConnectionOptions;
    preparedPacket?: Buffer | undefined;
    udp: VoiceUDPSocket;
    ws: VoiceWebSocket;
}

/**
 * @description Состояние, в котором будет находиться сетевой экземпляр, когда его соединение неожиданно прервано, и он
 * пытается возобновить существующий сеанс.
 */
export interface NetworkingResumingState {
    code: NetworkingStatusCode.Resuming;
    connectionData: ConnectionData;
    connectionOptions: ConnectionOptions;
    preparedPacket?: Buffer | undefined;
    udp: VoiceUDPSocket;
    ws: VoiceWebSocket;
}

/**
 * @description Состояние, в котором будет находиться сетевой экземпляр, когда он будет уничтожен. Его невозможно восстановить из этого
 * состояния.
 */
export interface NetworkingClosedState {
    code: NetworkingStatusCode.Closed;
}

/**
 * @description Различные состояния, в которых может находиться сетевой экземпляр.
 */
export type NetworkingState = | NetworkingClosedState | NetworkingIdentifyingState | NetworkingOpeningWsState | NetworkingReadyState
    | NetworkingResumingState | NetworkingSelectingProtocolState | NetworkingUdpHandshakingState;

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
export interface ConnectionData {
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