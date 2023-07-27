import { Queue } from "@AudioPlayer/Queue/Queue";
import {Events, VoiceState} from "discord.js";
import { Voice } from "@Util/Voice";
import { WatKLOK } from "@Client";
import { Logger } from "@Logger";
import { Action } from "@Action";
import {env} from "@env";

const debug = env.get("debug.client");

export default class extends Action {
    public readonly name = Events.VoiceStateUpdate;

    public readonly run = (oldState: VoiceState, newState: VoiceState, client: WatKLOK): void => {
        const queue: Queue = client.queue.get(newState.guild.id); //Очередь сервера
        const ChannelID = oldState?.channel?.id || newState?.channel?.id;
        const Guild = oldState.guild;

        setTimeout(() => {
            const voice = Voice.getVoice(Guild.id);
            const usersSize = (newState.channel?.members ?? oldState.channel?.members)?.filter((member) => !member.user.bot && member.voice?.channel?.id === ChannelID)?.size;

            //Если есть голосовое подключение и пользователей меньше одного и каналы соответствуют и выключен радио режим, то отключаемся от голосового канала
            if (voice && usersSize < 1 && voice?.joinConfig?.channelId === oldState?.channelId && !queue?.options?.radioMode) Voice.disconnect(Guild);

            //Если есть очередь и нет радио режима
            if (queue && !queue?.options?.radioMode) {
                const isBotVoice = !!(newState.channel?.members ?? oldState.channel?.members)?.find((member) => member.user.id === client.user.id);

                if (usersSize < 1 && !isBotVoice) queue.state = "start"; //Если есть очередь сервера, удаляем!
                else if (usersSize > 0) queue.state = "cancel"; //Если есть очередь сервера, отмена удаления!

                if (debug) Logger.debug(`voiceStateUpdate: [ID: ${ChannelID} | Voice: ${!!voice} | inVoice: ${isBotVoice} | Users: ${usersSize} | Queue: ${!!queue}]`);
            }
        }, 500);
    };
}