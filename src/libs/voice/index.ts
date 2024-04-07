import { DiscordGatewayAdapterCreator, VoiceConfig, VoiceConnection, VoiceConnectionStatus } from "@lib/voice/VoiceConnection";
import {GatewayOpcodes} from "discord-api-types/v10";
import {Constructor} from "@handler";

/**
 * @author SNIPPIK
 * @description База с голосовыми подключениями
 */
export const Voice = new class Voice extends Constructor.Collection<VoiceConnection> {
    /**
     * @description Подключение к голосовому каналу
     * @param config - Данные для подключения
     * @param adapterCreator - Для отправки пакетов
     * @public
     */
    public join = (config: VoiceConfig, adapterCreator: DiscordGatewayAdapterCreator): VoiceConnection => {
        let connection = this.get(config.guildId);

        //Если нет голосового подключения, то создаем и сохраняем в базу
        if (!connection) {
            connection = new VoiceConnection(config as any, {adapterCreator});
            this.set(config.guildId, connection);
        }

        //Если есть голосовое подключение, то подключаемся заново
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            if (connection.state.status === VoiceConnectionStatus.Disconnected) connection.rejoin(config as any);
            else if (!connection.state.adapter.sendPayload(this.payload(config))) connection.state = { ...connection.state, status: "disconnected" as any, reason: 1 };
        }

        return connection;
    };

    /**
     * @description Отправка данных на Discord
     * @param config - Данные для подключения
     */
    public payload = (config: VoiceConfig) => {
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