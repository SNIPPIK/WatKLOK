import { Queue } from "@AudioPlayer/Queue/Queue";
import { VoiceState } from "discord.js";
import { Voice } from "@Utils/Voice";
import { Logger } from "@Logger";
import {env} from "@env";

//Client imports
import { WatKLOK } from "@Client";
import { Event } from "@Client/Event"

const debug = env.get("debug.client");

export class voiceStateUpdate extends Event<VoiceState, VoiceState> {
    public readonly name: string = "voiceStateUpdate";
    public readonly isEnable: boolean = true;

    public readonly run = (oldState: VoiceState, newState: VoiceState, client: WatKLOK): void => {
        const queue: Queue = client?.player.queue.get(newState.guild.id); //Очередь сервера
        const ChannelID = oldState?.channel?.id || newState?.channel?.id;
        const Guild = oldState.guild;

        setImmediate(() => {
            const voice = Voice.getVoice(Guild.id);
            const usersSize = (newState.channel?.members ?? oldState.channel?.members)?.filter((member) => !member.user.bot && member.voice?.channel?.id === ChannelID)?.size;

            //Если есть голосовое подключение и пользователей меньше одного и каналы соответствуют и выключен радио режим, то отключаемся от голосового канала
            if (voice && usersSize < 1 && voice?.joinConfig?.channelId === oldState?.channelId && !queue?.options?.radioMode) Voice.Disconnect(Guild);

            //Если есть очередь и нет радио режима
            if (queue && !queue?.options?.radioMode) {
                const isBotVoice = !!(newState.channel?.members ?? oldState.channel?.members)?.find((member) => member.user.id === client.user.id);

                if (usersSize < 1 && !isBotVoice) queue.timer = "start"; //Если есть очередь сервера, удаляем!
                else if (usersSize > 0) queue.timer = "cancel"; //Если есть очередь сервера, отмена удаления!

                if (debug) Logger.debug(`[Event]: [voiceStateUpdate]: [ID: ${ChannelID} | Voice: ${!!voice} | inVoice: ${isBotVoice} | Users: ${usersSize} | Queue: ${!!queue}]`);
            }
        });
    };
}