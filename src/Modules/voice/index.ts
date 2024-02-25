import type { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData } from 'discord-api-types/v10';
import {VoiceConnection, VoiceConnectionStatus} from "@watklok/voice/VoiceConnection";
import {GatewayOpcodes} from "discord-api-types/v10";

/**
 * @author SNIPPIK
 * @description База с голосовыми подключениями
 */
export class Voice {
    private static readonly voices = new Map<string, VoiceConnection>;
    /**
     * @description Получение голосового подключения
     * @param voice {VoiceConnection | string} Голосовое подключение или ID сервера
     * @public
     */
    public static get = (voice: VoiceConnection | string): VoiceConnection => {
        if (typeof voice === "string") return this.voices.get(voice);
        return this.voices.get(voice.config.guildId);
    };

    /**
     * @description Сохранение голосового подключения
     * @param voice {VoiceConnection} Голосовое подключение
     * @public
     */
    public static set = (voice: VoiceConnection): void => {
        this.voices.set(voice.config.guildId, voice);
    };

    /**
     * @description Сохранение голосового подключения
     * @param voice {VoiceConnection | string} Голосовое подключение или ID сервера
     * @public
     */
    public static remove = (voice: VoiceConnection | string): void => {
        const key = typeof voice === "string" ? voice : voice.config.guildId;
        const connection = this.voices.get(key);

        if (connection) {
            connection.disconnect();
            connection.destroy();
            this.voices.delete(key);
        }
    };

    /**
     * @description Подключение к голосовому каналу
     * @param config {} Данные для подключения
     * @param adapterCreator {DiscordGatewayAdapterCreator}
     * @public
     */
    public static join = (config: VoiceConfig, adapterCreator: DiscordGatewayAdapterCreator): VoiceConnection => {
        let connection = this.get(config.guildId);

        //Если нет голосового подключения, то создаем и сохраняем в базу
        if (!connection) {
            connection = new VoiceConnection(config as any, {adapterCreator});
            this.set(connection);
        }

        //Если есть голосовое подключение, то подключаемся заново
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            if (connection.state.status === VoiceConnectionStatus.Disconnected) connection.rejoin(config as any);
            else if (!connection.state.adapter.sendPayload(Voice.payload(config))) connection.state = { ...connection.state, status: "disconnected" as any, reason: 1 };
        }

        return connection;
    };

    /**
     * @description
     * @param config {} Данные для подключения
     */
    public static payload = (config: VoiceConfig) => {
        return {
            op: GatewayOpcodes.VoiceStateUpdate,
            d: {
                guild_id: config.guildId,
                channel_id: config.channelId,
                self_deaf: config.selfDeaf,
                self_mute: config.selfMute
            }
        }
    };
}

/**
 * @description Конфиг для подключения к голосовому каналу
 */
export interface VoiceConfig {
    channelId: string | null;
    guildId: string;
    selfDeaf: boolean;
    selfMute: boolean;
}

/**
 * @description Параметры, которые могут быть заданы при создании голосового соединения.
 */
export interface CreateVoiceConnectionOptions {
    adapterCreator: DiscordGatewayAdapterCreator;

    /**
     * If true, debug messages will be enabled for the voice connection and its
     * related components. Defaults to false.
     */
    debug?: boolean | undefined;
}

/**
 * @description Шлюз Discord Адаптер, шлюза Discord.
 */
export interface DiscordGatewayAdapterLibraryMethods {
    /**
     * Call this when the adapter can no longer be used (e.g. due to a disconnect from the main gateway)
     */
    destroy(): void;
    /**
     * Call this when you receive a VOICE_SERVER_UPDATE payload that is relevant to the adapter.
     *
     * @param data - The inner data of the VOICE_SERVER_UPDATE payload
     */
    onVoiceServerUpdate(data: GatewayVoiceServerUpdateDispatchData): void;
    /**
     * Call this when you receive a VOICE_STATE_UPDATE payload that is relevant to the adapter.
     *
     * @param data - The inner data of the VOICE_STATE_UPDATE payload
     */
    onVoiceStateUpdate(data: GatewayVoiceStateUpdateDispatchData): void;
}

/**
 * @description Методы, предоставляемые разработчиком адаптера Discord Gateway для DiscordGatewayAdapter.
 */
export interface DiscordGatewayAdapterImplementerMethods {
    /**
     * @description Это будет вызвано voice, когда адаптер можно будет безопасно уничтожить, поскольку он больше не будет использоваться.
     */
    destroy(): void;
    /**
     * @description Реализуйте этот метод таким образом, чтобы данная полезная нагрузка отправлялась на основное соединение Discord gateway.
     *
     * @param payload - Полезная нагрузка для отправки на основное соединение Discord gateway
     * @returns `false`, если полезная нагрузка определенно не была отправлена - в этом случае голосовое соединение отключается
     */
    sendPayload(payload: any): boolean;
}

/**
 * Функция, используемая для создания адаптеров. Она принимает параметр methods, содержащий функции, которые
 * могут быть вызваны разработчиком при получении новых данных по его шлюзовому соединению. В свою очередь,
 * разработчик вернет некоторые методы, которые может вызывать библиотека - например, для отправки сообщений на
 * шлюз или для подачи сигнала о том, что адаптер может быть удален.
 */
export type DiscordGatewayAdapterCreator = (
    methods: DiscordGatewayAdapterLibraryMethods,
) => DiscordGatewayAdapterImplementerMethods;