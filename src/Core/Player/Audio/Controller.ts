import {Queue} from "../Structures/Queue/Queue";
import {Song} from "../Structures/Queue/Song";
import {VoiceState} from "discord.js";
import {StatusPlayerHasSkipped} from "./AudioPlayer";
import {ClientMessage} from "../../Client";
import {DurationUtils} from "../Manager/DurationUtils";

const ParsingTimeToString = DurationUtils.ParsingTimeToString;

/**
 * Здесь все функции для взаимодействия с плеером
 */
export namespace PlayerController {
    /**
     * @description Продолжает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function PlayerResume (message: ClientMessage): void {
        const {client, guild, author} = message;
        const {player, songs}: Queue = client.queue.get(guild.id);
        const {title, color}: Song = songs[0];

        if (player.state.status === "paused") {
            player.resume();
            return client.Send({text: `▶️ | Resume song | ${title}`, message, type: "css", color});
        }
        return client.Send({text: `${author}, Текущий статус плеера [${player.state.status}]`, message, color: "RED"});
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Приостанавливает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function PlayerPause(message: ClientMessage): void {
        const {client, guild, author} = message;
        const {player, songs}: Queue = client.queue.get(guild.id);
        const {title, color}: Song = songs[0];

        if (player.state.status === "playing") {
            player.pause();
            return client.Send({text: `⏸ | Pause song | ${title}`, message, type: "css", color});
        }
        return client.Send({text: `${author}, Текущий статус плеера [${player.state.status}]`, message, color: "RED"});
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Убираем музыку из очереди
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {string} Аргументы Пример: команда аргумент1 аргумент2
     * @requires {PlayerEnd}
     */
    export function PlayerRemove(message: ClientMessage, args: number): void {
        const {client, guild, member, author} = message;
        const {player, songs}: Queue = client.queue.get(guild.id);
        const {title, color, requester, url}: Song = songs[args - 1];

        setImmediate(() => {
            const voiceConnection: VoiceState[] = client.connections(guild);
            const UserToVoice: boolean = !!voiceConnection.find((v: VoiceState) => v.id === songs[0].requester.id);

            //Если музыка не играет
            if (!StatusPlayerHasSkipped.has(player.state.status)) return client.Send({
                text: `${author}, ⚠ Музыка еще не играет!`,
                message,
                color: "RED"
            });

            //Если всего один трек
            if (songs.length <= 1) return PlayerEnd(message);

            //Если пользователю позволено убрать из очереди этот трек
            if (member.permissions.has("Administrator") || author.id === requester.id || !UserToVoice) {
                songs.splice(args - 1, 1);
                if (args === 1) PlayerEnd(message);
                return client.Send({text: `⏭️ | Remove song | ${title}`, message, type: "css", color});
            }

            //Если пользователю нельзя это сделать
            return client.Send({text: `${author}, Ты не включал эту музыку [${title}](${url})`, message, color: "RED"});
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Завершает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     * @param seek {number} музыка будет играть с нужной секунды (не работает без ffmpeg)
     * @requires {ParsingTimeToString}
     */
    export function PlayerSeek(message: ClientMessage, seek: number): void {
        const {client, guild, author} = message;
        const {player, songs}: Queue = client.queue.get(guild.id);
        const {title, color}: Song = songs[0];

        try {
            client.Send({text: `⏭️ | Seeking to [${ParsingTimeToString(seek)}] song | ${title}`, message, type: "css", color});
            return player.seek(message, seek);
        } catch {
            return client.Send({text: `${author}, Произошла ошибка... Попробуй еще раз!`, message, color: "RED"});
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Пропускает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {number} Сколько треков пропускаем
     * @requires {PlayerSkipTo, PlayerEnd}
     */
    export function PlayerSkip(message: ClientMessage, args: number): void {
        if (args) return PlayerSkipTo(message, args);

        const {client, guild, member, author} = message;
        const {songs, player}: Queue = client.queue.get(guild.id);
        const {title, color, requester, url}: Song = songs[0];

        setImmediate(() => {
            const voiceConnection: VoiceState[] = client.connections(guild);
            const UserToVoice: boolean = !!voiceConnection.find((v: VoiceState) => v.id === requester.id);

            //Если музыка не играет
            if (!StatusPlayerHasSkipped.has(player.state.status)) return client.Send({
                text: `${author}, ⚠ Музыка еще не играет!`,
                message,
                color: "RED"
            });

            //Если пользователю позволено пропустить музыку
            if (member.permissions.has("Administrator") || author.id === requester.id || !UserToVoice) {
                if (StatusPlayerHasSkipped.has(player.state.status)) {
                    client.Send({text: `⏭️ | Skip song | ${title}`, message, type: "css", color});
                    return PlayerEnd(message);
                }
            }

            //Если пользователю нельзя это сделать
            return client.Send({text: `${author}, Ты не включал эту музыку [${title}](${url})`, message, color: "RED"});
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Повтор текущей музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function PlayerReplay(message: ClientMessage): void {
        const {client, guild, author} = message;
        const {player, songs}: Queue = client.queue.get(guild.id);
        const {title, color}: Song = songs[0];

        try {
            client.Send({text: `🔂 | Replay | ${title}`, message, color, type: "css"});
            return player.seek(message);
        } catch {
            return client.Send({text: `${author}, Произошла ошибка... Попробуй еще раз!`, message, color: "RED"});
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Применяем фильтры для плеера
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function PlayerFilter(message: ClientMessage): void {
        const {client, guild, author} = message;
        const {player}: Queue = client.queue.get(guild.id);
        const seek: number = player.playbackDuration;

        try {
            return player.seek(message, seek);
        } catch {
            return client.Send({text: `${author}, Произошла ошибка... Попробуй еще раз!`, message, color: "RED"});
        }
    }
}
//====================== ====================== ====================== ======================
/**
 * @description Пропускает музыку под номером
 * @param message {ClientMessage} Сообщение с сервера
 * @param args {string} Аргументы Пример: команда аргумент1 аргумент2
 * @requires {PlayerEnd}
 */
function PlayerSkipTo(message: ClientMessage, args: number): void {
    const {client, guild, member, author} = message;
    const queue: Queue = client.queue.get(guild.id);
    const {title, color, requester, url}: Song = queue.songs[args - 1];

    setImmediate(() => {
        const voiceConnection: VoiceState[] = client.connections(guild);
        const UserToVoice: boolean = !!voiceConnection.find((v: VoiceState) => v.id === queue.songs[0].requester.id);

        //Если музыка не играет
        if (!StatusPlayerHasSkipped.has(queue.player.state.status)) return client.Send({
            text: `${author}, ⚠ Музыка еще не играет!`,
            message,
            color: "RED"
        });

        //Если пользователь укажет больше чем есть в очереди
        if (args > queue.songs.length) return client.Send({
            text: `${author}, В очереди ${queue.songs.length}!`,
            message,
            color: "RED"
        });

        //Если пользователю позволено пропустить музыку
        if (member.permissions.has("Administrator") || author.id === requester.id || !UserToVoice) {
            if (queue.options.loop === "songs") for (let i = 0; i < args - 2; i++) queue.songs.push(queue.songs.shift());
            else queue.songs = queue.songs.slice(args - 2);

            client.Send({text: `⏭️ | Skip to song [${args}] | ${title}`, message, type: "css", color});
            return PlayerEnd(message);
        }

        //Если пользователю нельзя это сделать
        return client.Send({text: `${author}, Ты не включал эту музыку [${title}](${url})`, message, color: "RED"});
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Завершает текущую музыку
 * @param message {ClientMessage} Сообщение с сервера
 */
function PlayerEnd(message: ClientMessage): void {
    const {client, guild} = message;
    const {player}: Queue = client.queue.get(guild.id);

    if (StatusPlayerHasSkipped.has(player.state.status)) setTimeout(player.stop, 300);
}