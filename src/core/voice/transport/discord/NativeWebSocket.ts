import { DefaultListener, ListenerSignature } from "#structures";
import { VoiceCloseCodes } from "discord-api-types/voice/v8";
import { type WebSocketOpcodes } from "#core/voice/index.js";
import { VoiceWebSocket } from "#native";

/**
 * @author SNIPPIK
 * @description Класс для реализации TS слоя совместимости
 * @class NativeWebSocket
 * @extends VoiceWebSocket
 * @public
 */
export class NativeWebSocket<L extends ClientWebSocketEvents = ClientWebSocketEvents> extends VoiceWebSocket {
    public on<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    //@ts-ignore
    public on<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
}

/**
 * @author SNIPPIK
 * @description События выдаваемые голосовым подключением
 * @interface ClientWebSocketEvents
 */
interface ClientWebSocketEvents {
    /**
     * @description Если произошла ошибка
     * @param err - Сама ошибка
     */
    "error": (err: Error[]) => void;

    /**
     * @description Обычное логирование действий
     * @param text - Лог
     */
    "info": (text: string[]) => void;

    /**
     * @description Если получен код выключения от discord
     * @param code - Код отключения
     * @param reason - Причина отключения
     */
    "close": (a: (VoiceCloseCodes | string)[]) => void;

    /**
     * @description Если получен код голоса от discord, нужен для receiver
     */
    "speaking": (a: WebSocketOpcodes.speaking_get[]) => void;

    /**
     * @description Если добавлен новый пользователь или удален старый
     * @constructor
     */
    "Users": (a: (WebSocketOpcodes.connect | WebSocketOpcodes.disconnect)[]) => void;

    /**
     * @description Если клиент был отключен из-за отключения бота от голосового канала
     * @param code - Код отключения
     * @param reason - Причина отключения
     */
    "disconnect": (a: { code: number, reason: string}[]) => void;

    /**
     * @description Событие для opcodes, приходят не все
     * @param opcodes - Не полный список получаемых opcodes
     */
    "ready": (a: WebSocketOpcodes.ready[]) => void;

    /**
     * @description Событие для opcodes, приходят не все
     * @param opcodes - Не полный список получаемых opcodes
     */
    "sessionDescription": (a: WebSocketOpcodes.session[]) => void;

    /**
     * @description Все события для работы с dave сессией
     * @param opcodes - Полный список всех протоколов Dave
     */
    "daveSession": (a: WebSocketOpcodes.dave_opcodes[]) => void;

    /**
     * @description Все события для работы с dave сессией
     * @param opcodes - Полный список всех протоколов Dave
     */
    "binary": (a: {op: WebSocketOpcodes.dave_opcodes["op"], payload: Buffer}[]) => void;

    /**
     * @description Успешное подключение WebSocket
     * @usage
     * ```
     * op: VoiceOpcodes.Identify,
     *     d: {
     *          server_id: this.configuration.guild_id,
     *          session_id: this.voiceState.session_id,
     *          user_id: this.voiceState.user_id,
     *          token: this.serverState.token
     * }
     * ```
     */
    "open": () => void;

    /**
     * @description Требуется для переподключения WebSocket
     * @usage
     * ```
     * op: VoiceOpcodes.Resume,
     *    d: {
     *          server_id: this.configuration.guild_id,
     *          session_id: this.voiceState.session_id,
     *          token: this.serverState.token,
     *          seq_ack: this.websocket.lastAsk
     * }
     * ```
     */
    "resumed": () => void;
}