import {ClientMessage, UtilsMsg} from "@Client/interactionCreate";
import {DurationUtils} from "@Managers/DurationUtils";
import {toQueue} from "@Managers/QueueManager";
import {VoiceState} from "discord.js";
import {Voice} from "@VoiceManager";
import {Queue} from "@Queue/Queue";
import {Song} from "@Queue/Song";

//Здесь все функции для взаимодействия с плеером
export namespace Player {
    export const play = toQueue;
    /**
     * @description Продолжает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function resume(message: ClientMessage): void {
        const {client, guild} = message;
        const {player, song}: Queue = client.queue.get(guild.id);
        const {title, color}: Song = song;

        //Продолжаем воспроизведение музыки если она на паузе
        player.resume();
        return UtilsMsg.createMessage({text: `▶️ | Resume song | ${title}`, message, codeBlock: "css", color});
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Приостанавливает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function pause(message: ClientMessage): void {
        const {client, guild} = message;
        const {player, song}: Queue = client.queue.get(guild.id);
        const {title, color}: Song = song;

        //Приостанавливаем музыку если она играет
        player.pause();
        return UtilsMsg.createMessage({text: `⏸ | Pause song | ${title}`, message, codeBlock: "css", color});
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Убираем музыку из очереди
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {string} Аргументы Пример: команда аргумент1 аргумент2
     * @requires {toStop}
     */
    export function remove(message: ClientMessage, args: number): void {
        const {client, guild, member, author} = message;
        const queue: Queue = client.queue.get(guild.id);
        const {player, songs, song} = queue;
        const {title, color, requester, url}: Song = songs[args - 1];

        setImmediate(() => {
            const voiceConnection: VoiceState[] = Voice.Members(guild) as VoiceState[];
            const UserToVoice: boolean = !!voiceConnection.find((v: VoiceState) => v.id === song.requester.id);

            //Если музыку нельзя пропустить из-за плеера
            if (!player.hasSkipped) return UtilsMsg.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "DarkRed" });

            //Если пользователю позволено убрать из очереди этот трек
            if (member.permissions.has("Administrator") || author.id === requester.id || !UserToVoice) {
                if (args === 1) toStop(message);
                queue.songs.splice(args - 1, 1);

                return UtilsMsg.createMessage({text: `⏭️ | Remove song | ${title}`, message, codeBlock: "css", color});
            }

            //Если пользователю нельзя это сделать
            return UtilsMsg.createMessage({ text: `${author}, Ты не включал эту музыку [${title}](${url})`, message, color: "DarkRed" });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Завершает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     * @param seek {number} музыка будет играть с нужной секунды (не работает без ffmpeg)
     * @requires {ParsingTimeToString}
     */
    export function seek(message: ClientMessage, seek: number): void {
        const {client, guild, author} = message;
        const {song, play, player}: Queue = client.queue.get(guild.id);
        const {title, color}: Song = song;

        //Если музыку нельзя пропустить из-за плеера
        if (!player.hasSkipped) return UtilsMsg.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "DarkRed" });

        play(seek);
        //Отправляем сообщение о пропуске времени
        return UtilsMsg.createMessage({ text: `⏭️ | Seeking to [${DurationUtils.ParsingTimeToString(seek)}] song | ${title}`, message, codeBlock: "css", color });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Пропускает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {number} Сколько треков пропускаем
     */
    export function skip(message: ClientMessage, args: number): void {
        if (args) return skipSong(message, args);
        return skipSong(message);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Повтор текущей музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function replay(message: ClientMessage): void {
        const {client, guild} = message;
        const {song, play}: Queue = client.queue.get(guild.id);
        const {title, color}: Song = song;

        play();
        //Сообщаем о том что музыка начата с начала
        return UtilsMsg.createMessage({text: `🔂 | Replay | ${title}`, message, color, codeBlock: "css"});
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Применяем фильтры для плеера
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function filter(message: ClientMessage): Promise<void> | void {
        const {client, guild} = message;
        const {player, play}: Queue = client.queue.get(guild.id);
        const seek: number = player.streamDuration;

        return play(seek);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Завершает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function toStop(message: ClientMessage): void {
        const {client, guild} = message;
        const {player}: Queue = client.queue.get(guild.id);

        if (player.hasSkipped) player.stop();
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Пропускает музыку под номером
 * @param message {ClientMessage} Сообщение с сервера
 * @param args {string} Аргументы Пример: команда аргумент1 аргумент2
 */
function skipSong(message: ClientMessage, args: number = 1) {
    const {client, guild, member, author} = message;
    const queue: Queue = client.queue.get(guild.id);
    const {song, player, songs, options} = queue;
    const {title, color, requester, url}: Song = songs[args - 1];

    setImmediate(() => {
        const voiceConnection: VoiceState[] = Voice.Members(guild) as VoiceState[];
        const UserToVoice: boolean = !!voiceConnection.find((v: VoiceState) => v.id === song.requester.id);

        //Если музыку нельзя пропустить из-за плеера
        if (!player.hasSkipped) return UtilsMsg.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "DarkRed" });

        //Если пользователь укажет больше чем есть в очереди
        if (args > songs.length) return UtilsMsg.createMessage({ text: `${author}, В очереди ${songs.length}!`, message, color: "DarkRed" });

        //Если пользователю позволено пропустить музыку
        if (member.permissions.has("Administrator") || author.id === requester.id || !UserToVoice) {
            if (args > 1) {
                if (options.loop === "songs") for (let i = 0; i < args - 2; i++) songs.push(songs.shift());
                else queue.songs = songs.slice(args - 2);

                UtilsMsg.createMessage({text: `⏭️ | Skip to song [${args}] | ${title}`, message, codeBlock: "css", color});
            } else {
                UtilsMsg.createMessage({text: `⏭️ | Skip song | ${title}`, message, codeBlock: "css", color});
            }

            return Player.toStop(message);
        }

        //Если пользователю нельзя это сделать
        return UtilsMsg.createMessage({ text: `${author}, Ты не включал эту музыку [${title}](${url})`, message, color: "DarkRed" });
    });
}