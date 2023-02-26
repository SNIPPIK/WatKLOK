import {ClientMessage, UtilsMsg} from "@Client/interactionCreate";
import {DurationUtils} from "@Structures/Durations";
import {Voting} from "@db/Config.json";
import {VoiceState} from "discord.js";
import {toQueue} from "@Queue/Queue";
import {Voice} from "@VoiceManager";
import {Queue} from "@Queue/Queue";
import {Song} from "@Queue/Song";
import {Filter} from "@FFspace";


//Здесь все функции для взаимодействия с плеером
export namespace Player {
    export const handleContent = toQueue;
    /**
     * @description Продолжает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function resume(message: ClientMessage): void {
        const {client, guild} = message;
        const {player, song}: Queue = client.queue.get(guild.id);
        const {title}: Song = song;

        //Продолжаем воспроизведение музыки если она на паузе
        player.resume();
        return UtilsMsg.createMessage({text: `▶️ | Resume song | ${title}`, message, codeBlock: "css", color: "Green"});
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Приостанавливает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    export function pause(message: ClientMessage): void {
        const {client, guild} = message;
        const {player, song}: Queue = client.queue.get(guild.id);
        const {title}: Song = song;

        //Приостанавливаем музыку если она играет
        player.pause();
        return UtilsMsg.createMessage({text: `⏸ | Pause song | ${title}`, message, codeBlock: "css", color: "Green"});
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Убираем музыку из очереди
     * @param message {ClientMessage} Сообщение с сервера
     * @param arg {string} Аргументы Пример: команда аргумент1 аргумент2
     * @requires {toStop}
     */
    export function remove(message: ClientMessage, arg: number = 1): void {
        const {client, guild, author} = message;
        const queue: Queue = client.queue.get(guild.id);
        const {player, songs} = queue;
        const {title, url}: Song = songs[arg - 1];

        setImmediate(() => {
            //Если музыку нельзя пропустить из-за плеера
            if (!player.hasSkipped) return UtilsMsg.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

            //Запускаем голосование
            Vote(message, queue, (win) => {
                if (win) {
                    //Убираем трек из очереди на выбор пользователя
                    queue.songs.splice(arg - 1, 1);

                    //Если пользователь указал первый трек, то пропускаем го
                    if (arg === 1) toStop(message);

                    //Сообщаем какой трек был убран
                    return UtilsMsg.createMessage({text: `⏭️ | Remove song | ${title}`, message, codeBlock: "css", color: "Green"});
                } else {
                    //Если пользователю нельзя это сделать
                    return UtilsMsg.createMessage({ text: `${author}, убрать этот трек [${title}](${url}) не вышло!`, message, color: "Yellow" });
                }
            }, "удаление из очереди", arg);
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
        const queue: Queue = client.queue.get(guild.id);
        const {song, play, player} = queue;
        const {title}: Song = song;

        //Если музыку нельзя пропустить из-за плеера
        if (!player.hasSkipped) return UtilsMsg.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

        //Запускаем голосование
        Vote(message, queue, (win) => {
            if (win) {
                play(seek); //Начинаем проигрывание трека с <пользователем указанного тайм кода>

                //Отправляем сообщение о пропуске времени
                return UtilsMsg.createMessage({ text: `⏭️ | Seeking to [${DurationUtils.ParsingTimeToString(seek)}] song | ${title}`, message, codeBlock: "css", color: "Green" });
            } else return UtilsMsg.createMessage({ text: `${author}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
        }, "пропуск времени в треке", 1);
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
        const {client, guild, author} = message;
        const queue: Queue = client.queue.get(guild.id);
        const {song, play} = queue;
        const {title}: Song = song;

        //Запускаем голосование
        Vote(message, queue, (win) => {
            if (win) {
                play();

                //Сообщаем о том что музыка начата с начала
                return UtilsMsg.createMessage({text: `🔂 | Replay | ${title}`, message, color: "Green", codeBlock: "css"});
            } else return UtilsMsg.createMessage({ text: `${author}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
        }, "повторное проигрывание трека", 1);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Применяем фильтры для плеера
     * @param message {ClientMessage} Сообщение с сервера
     * @param filter {typeof FFspace.getFilter} Сам фильтр
     * @param arg
     */
    export function filter(message: ClientMessage, filter: Filter, arg: number): Promise<void> | void {
        const {client, guild, author} = message;
        const queue: Queue = client.queue.get(guild.id);
        const {player, play}: Queue = queue;
        const seek: number = player.streamDuration;

        const isFilter = !!queue.filters.find((Filter) => typeof Filter === "number" ? null : filter.names.includes(Filter));
        const name = filter.names[0];

        //Если фильтр есть в очереди
        if (isFilter) {
            const index = queue.filters.indexOf(name);

            //Если пользователь указал аргумент, значит его надо заменить
            if (arg && filter.args) {
                const isOkArgs = arg >= (filter.args as number[])[0] && arg <= (filter.args as number[])[1];

                //Если аргументы не подходят
                if (!isOkArgs) return UtilsMsg.createMessage({text: `${author.username} | Filter: ${name} не изменен из-за несоответствия аргументов!`, message, color: "Yellow", codeBlock: "css" });

                //Запускаем голосование
                Vote(message, queue, (win) => {
                    //Изменяем аргумент фильтра
                    if (win) {
                        queue.filters[index + 1] = arg;

                        play(seek);

                        return UtilsMsg.createMessage({ text: `${author.username} | Filter: ${name} был изменен аргумент на ${arg}!`, message, codeBlock: "css", color: "Green" });
                    } else return UtilsMsg.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "изменение фильтра");
                //Если пользователь не указал аргумент, значит его надо удалить
            } else {
                //Запускаем голосование
                Vote(message, queue, (win) => {
                    //Изменяем аргумент фильтра
                    if (win) {
                        if (filter.args) queue.filters.splice(index, 2); //Удаляем фильтр и аргумент
                        else queue.filters.splice(index, 1); //Удаляем только фильтр

                        play(seek);

                        return UtilsMsg.createMessage({text: `${author.username} | Filter: ${name} отключен!`, color: "Green", message, codeBlock: "css"});
                    } else return UtilsMsg.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "отключение фильтра");
            }
            //Если фильтра нет в очереди, значит его надо добавить
        } else {
            //Если пользователь указал аргумент, значит его надо заменить
            if (arg && filter.args) {
                //Запускаем голосование
                Vote(message, queue, (win) => {
                    if (win) {
                        queue.filters.push(name);
                        queue.filters.push(arg as any);

                        play(seek);

                        return UtilsMsg.createMessage({text: `${author.username} | Filter: ${name}:${arg} включен!`, color: "Green", message, codeBlock: "css"});
                    } else return UtilsMsg.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "добавление фильтра");
            //Если нет аргумента
            } else {
                //Запускаем голосование
                Vote(message, queue, (win) => {
                    if (win) {
                        queue.filters.push(name);

                        play(seek);

                        return UtilsMsg.createMessage({text: `${author.username} | Filter: ${name} включен!`, color: "Green", message, codeBlock: "css"});
                    } else return UtilsMsg.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "добавление фильтра");
            }
        }
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
function skipSong(message: ClientMessage, args: number = 1): void {
    const {client, guild, author} = message;
    const queue: Queue = client.queue.get(guild.id);
    const {player, songs, options} = queue;
    const {title, color, url}: Song = songs[args - 1];

    setImmediate(() => {
        //Если музыку нельзя пропустить из-за плеера
        if (!player.hasSkipped) return UtilsMsg.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

        //Если пользователь укажет больше чем есть в очереди
        if (args > songs.length) return UtilsMsg.createMessage({ text: `${author}, В очереди ${songs.length}!`, message, color: "Yellow" });

        //Голосование за пропуск
        Vote(message, queue, (win): void => {
            if (win) {
                if (args > 1) {
                    if (options.loop === "songs") for (let i = 0; i < args - 2; i++) songs.push(songs.shift());
                    else queue.songs = songs.slice(args - 2);

                    UtilsMsg.createMessage({ text: `⏭️ | Skip to song [${args}] | ${title}`, message, codeBlock: "css", color: "Green" });
                } else UtilsMsg.createMessage({text: `⏭️ | Skip song | ${title}`, message, codeBlock: "css", color: "Green"});

                return Player.toStop(message);
            } else {
                //Если пользователю нельзя пропустить трек сделать
                return UtilsMsg.createMessage({ text: `${author}, пропустить этот трек [${title}](${url}) не вышло!`, message, color: "Yellow" });
            }
        }, "пропуск трека", args);
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Голосование за пропуск трека
 * @param message {ClientMessage} Сообщение
 * @param queue {Queue} Музыкальная очередь
 * @param callback {Function} Выполнение функции по завершению
 * @param str {string} Голосование за что?
 * @param arg {number} Какой трек надо будет убрать
 * @constructor
 */
function Vote(message: ClientMessage, queue: Queue, callback: (win: boolean) => void, str: string = "пропуск трека", arg?: number ): void {
    const { member, author, guild} = message;

    setImmediate(() => {
        const voiceConnection: VoiceState[] = Voice.Members(guild) as VoiceState[];
        const song = queue && arg ? queue?.songs[arg - 1] : null;

        //Если пользователь сидит один или он является владельцем сервера или пользователь включил этот трек, то пропускаем голосование
        if (voiceConnection.length === 1 || member.permissions.has("Administrator") || song.requester.id === message.author.id) return callback(true);
        if (!queue || !queue?.song) return UtilsMsg.createMessage({ text: `${author.username}, музыка уже не играет!`, message, codeBlock: "css", color: "Yellow" });

        //Пользователи, которые проголосовали за, против
        let Yes: number = 0, No: number = 0;
        const choice = `Голосование за ${str}! | ${member.user.username}\n${song ? `Трек: ${song.title} | ${song.duration.full}` : ""}\n\nГолосование длится всего 5 секунд!`;

        //Отправляем сообщение
        message.channel.send({content: `\`\`\`css\n${choice}\n\`\`\``}).then(msg => {
            UtilsMsg.createReaction(msg, Voting[0],
                (reaction, user) => reaction.emoji.name === Voting[0] && user.id !== message.client.user.id,
                (reaction) => Yes = reaction.count - 1, 5e3
            );
            UtilsMsg.createReaction(msg, Voting[1],
                (reaction, user) => reaction.emoji.name === Voting[1] && user.id !== message.client.user.id,
                (reaction) => No = reaction.count - 1, 5e3
            );

            //Что делаем по истечению времени (5 сек)
            setTimeout(() => callback(Yes >= No), 5e3);
        });
    });
}