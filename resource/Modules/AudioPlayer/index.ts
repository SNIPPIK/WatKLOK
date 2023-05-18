import { DurationUtils } from "@Utils/Durations";
import { ClientMessage } from "@Client/Message";
import { msgUtil } from "@db/Message";
import { VoiceState } from "discord.js";
import { Voice } from "@Utils/Voice";
import {env} from "@env";

//AudioPlayer
import { Filter } from "./Audio/AudioFilters";
import { CollectionQueue } from "./Queue/Collection";
import { Platform } from "@APIs";
import { MessagePlayer } from "./Message";
import { Queue } from "./Queue/Queue";
import { Song } from "./Queue/Song";


const Voting: string[] = JSON.parse(env.get("voting"));
const Info = env.get("music.info");
const Warning = env.get("APIs.warning");

/**
 * @description Храним все очереди здесь
 */
const _queue = new CollectionQueue();
//====================== ====================== ====================== ======================
/**
 * @description Все доступные взаимодействия с плеером через client.player
 */
export class Player {
    /**
     * @description Получение всех очередей
     */
    public get queue() { return _queue; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные из базы по данным
     * @param message {ClientMessage} Сообщение с сервера
     * @param argument {string} Что требует пользователь
     */
    public readonly play = (message: ClientMessage, argument: string): void => {
        const VoiceChannel = message.member?.voice?.channel;

        //Платформа с которой будем взаимодействовать
        const platform = Platform.name(argument);

        //Если нет такой платформы 
        if (!platform) return msgUtil.createMessage({ text: `⚠️ Warning\n\nУ меня нет поддержки этой платформы!`, codeBlock: "css", color: "Yellow", message });

        //Если нельзя получить данные с определенной платформы
        if (Platform.isFailed(platform)) return msgUtil.createMessage({ text: `⚠️ Warning | [${platform}]\n\nНет данных для авторизации, запрос не может быть выполнен!`, codeBlock: "css", color: "Yellow", message });

        //Тип запроса
        const type = Platform.type(argument, platform);

        //Ищем функцию, которая вернет данные или ошибку
        const callback = Platform.callback(platform, type);

        //Если нет функции запроса
        if (!callback) return msgUtil.createMessage({ text: `⚠️ Warning | [${platform}]\n\nУ меня нет поддержки этого запроса!`, codeBlock: "css", color: "Yellow", message });

        //Если включено показывать запросы
        if (Info) {
            //Отправляем сообщение о текущем запросе
            msgUtil.createMessage({ text: `${message.author}, производится запрос в **${platform.toLowerCase()}.${type}**`, color: "Grey", message });

            //Если у этой платформы нельзя получить исходный файл музыки, то сообщаем
            if (Platform.isAudio(platform) && Warning) {
                const workPlatform = Platform.isFailed("YANDEX") ? "youtube.track" : "yandex.track";

                msgUtil.createMessage({ text: `⚠️ Warning | [${platform}]\n\nЯ не могу получать исходные файлы музыки у этой платформы.\nЗапрос будет произведен в ${workPlatform}`, color: "Yellow", codeBlock: "css", message });
            }
        }

        //Вызываем функцию для получения данных
        callback(Platform.filterArg(argument)).then((info) => {
            if (info instanceof Error) return;

            //Если данных нет
            if (!info) return msgUtil.createMessage({ text: `⚠️ Warning | [${platform}.${type}]\n\nДанные не были получены!`, codeBlock: "css", color: "DarkRed", message });

            //Если пользователь ищет трек и кол-во треков больше одного
            if (info instanceof Array && info.length > 1) return MessagePlayer.toSearch(info, platform, message);

            //Загружаем трек или плейлист в Queue<GuildID>
            this.queue.create = { message, VoiceChannel, info: info instanceof Array ? info[0] : info };
        }).catch((e: any) => {
            if (e.length > 2e3) msgUtil.createMessage({ text: `⛔️ Error | [${platform}.${type}]\n\nПроизошла ошибка при получении данных!\n${e.message}`, color: "DarkRed", codeBlock: "css", message });
            else msgUtil.createMessage({ text: `⛔️ Error | [${platform}.${type}]\n\nПроизошла ошибка при получении данных!\n${e}`, color: "DarkRed", codeBlock: "css", message });
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Завершает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     */
    public readonly stop = (message: ClientMessage): void => {
        const { guild } = message;
        const { player }: Queue = this.queue.get(guild.id);

        if (player.hasSkipped) player.stop;
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Пропускает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {number} Сколько треков пропускаем
     */
    public readonly skip = (message: ClientMessage, args: number = 1): void => {
        const { client, guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
        const { player, songs, options } = queue;
        const { title, url }: Song = songs[args - 1];

        setImmediate(() => {
            //Если музыку нельзя пропустить из-за плеера
            if (!player.hasSkipped) return msgUtil.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

            //Если пользователь укажет больше чем есть в очереди
            if (args > songs.length) return msgUtil.createMessage({ text: `${author}, В очереди ${songs.length}!`, message, color: "Yellow" });

            //Голосование за пропуск
            Vote(message, queue, (win): void => {
                if (win) {
                    if (args > 1) {
                        if (options.loop === "songs") for (let i = 0; i < args - 2; i++) songs.push(songs.shift());
                        else queue.songs = songs.slice(args - 2);

                        msgUtil.createMessage({ text: `⏭️ | Skip to song [${args}] | ${title}`, message, codeBlock: "css", color: "Green" });
                    } else msgUtil.createMessage({ text: `⏭️ | Skip song | ${title}`, message, codeBlock: "css", color: "Green" });

                    return client.player.stop(message);
                } else {
                    //Если пользователю нельзя пропустить трек сделать
                    return msgUtil.createMessage({ text: `${author}, пропустить этот трек [${title}](${url}) не вышло!`, message, color: "Yellow" });
                }
            }, "пропуск трека", args);
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Приостанавливает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    public readonly pause = (message: ClientMessage): void => {
        const { guild } = message;
        const { player, song }: Queue = this.queue.get(guild.id);
        const { title }: Song = song;

        //Приостанавливаем музыку если она играет
        player.pause;
        return msgUtil.createMessage({ text: `⏸ | Pause song | ${title}`, message, codeBlock: "css", color: "Green" });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Продолжает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    public readonly resume = (message: ClientMessage): void => {
        const { guild } = message;
        const { player, song }: Queue = this.queue.get(guild.id);
        const { title }: Song = song;

        //Продолжаем воспроизведение музыки если она на паузе
        player.resume;
        return msgUtil.createMessage({ text: `▶️ | Resume song | ${title}`, message, codeBlock: "css", color: "Green" });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Убираем музыку из очереди
     * @param message {ClientMessage} Сообщение с сервера
     * @param arg {string} Аргументы Пример: команда аргумент1 аргумент2
     */
    public readonly remove = (message: ClientMessage, arg: number = 1): void => {
        const { guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
        const { player, songs } = queue;
        const { title, url }: Song = songs[arg - 1];

        setImmediate(() => {
            //Если музыку нельзя пропустить из-за плеера
            if (!player.hasSkipped) return msgUtil.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

            //Запускаем голосование
            Vote(message, queue, (win) => {
                if (win) {
                    //Убираем трек из очереди на выбор пользователя
                    queue.songs.splice(arg - 1, 1);

                    //Если пользователь указал первый трек, то пропускаем го
                    if (arg === 1) this.stop(message);

                    //Сообщаем какой трек был убран
                    return msgUtil.createMessage({ text: `⏭️ | Remove song | ${title}`, message, codeBlock: "css", color: "Green" });
                } else {
                    //Если пользователю нельзя это сделать
                    return msgUtil.createMessage({ text: `${author}, убрать этот трек [${title}](${url}) не вышло!`, message, color: "Yellow" });
                }
            }, "удаление из очереди", arg);
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Завершает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     * @param seek {number} музыка будет играть с нужной секунды (не работает без ffmpeg)
     */
    public readonly seek = (message: ClientMessage, seek: number): void => {
        const { guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
        const { song, player } = queue;
        const { title }: Song = song;

        //Если музыку нельзя пропустить из-за плеера
        if (!player.hasSkipped) return msgUtil.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

        //Запускаем голосование
        Vote(message, queue, (win) => {
            if (win) {
                //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                queue.play = seek;

                //Отправляем сообщение о пропуске времени
                return msgUtil.createMessage({ text: `⏭️ | Seeking to [${DurationUtils.toString(seek)}] song | ${title}`, message, codeBlock: "css", color: "Green" });
            } else return msgUtil.createMessage({ text: `${author}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
        }, "пропуск времени в треке", 1);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Повтор текущей музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    public readonly replay = (message: ClientMessage): void => {
        const { guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
        const { song } = queue;
        const { title }: Song = song;

        //Запускаем голосование
        Vote(message, queue, (win) => {
            if (win) {
                queue.play = 0;

                //Сообщаем о том что музыка начата с начала
                return msgUtil.createMessage({ text: `🔂 | Replay | ${title}`, message, color: "Green", codeBlock: "css" });
            } else return msgUtil.createMessage({ text: `${author}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
        }, "повторное проигрывание трека", 1);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Применяем фильтры для плеера
     * @param message {ClientMessage} Сообщение с сервера
     * @param filter {Filter} Сам фильтр
     * @param arg {number} Если надо изменить аргумент фильтра
     */
    public readonly filter = (message: ClientMessage, filter: Filter, arg: number): Promise<void> | void => {
        const { guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
        const { player }: Queue = queue;
        const seek: number = player.duration;

        const isFilter = !!queue.filters.find((Filter) => typeof Filter === "number" ? null : filter.names.includes(Filter));
        const name = filter.names[0];

        //Если фильтр есть в очереди
        if (isFilter) {
            const index = queue.filters.indexOf(name);

            //Если пользователь указал аргумент, значит его надо заменить
            if (arg && filter.args) {
                const isOkArgs = arg >= (filter.args as number[])[0] && arg <= (filter.args as number[])[1];

                //Если аргументы не подходят
                if (!isOkArgs) return msgUtil.createMessage({ text: `${author.username} | Filter: ${name} не изменен из-за несоответствия аргументов!`, message, color: "Yellow", codeBlock: "css" });

                //Запускаем голосование
                Vote(message, queue, (win) => {
                    //Изменяем аргумент фильтра
                    if (win) {
                        queue.filters[index + 1] = arg;

                        queue.play = seek;

                        return msgUtil.createMessage({ text: `${author.username} | Filter: ${name} был изменен аргумент на ${arg}!`, message, codeBlock: "css", color: "Green" });
                    } else return msgUtil.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "изменение фильтра");
                //Если пользователь не указал аргумент, значит его надо удалить
            } else {
                //Запускаем голосование
                Vote(message, queue, (win) => {
                    //Изменяем аргумент фильтра
                    if (win) {
                        if (filter.args) queue.filters.splice(index, 2); //Удаляем фильтр и аргумент
                        else queue.filters.splice(index, 1); //Удаляем только фильтр

                        queue.play = seek;

                        return msgUtil.createMessage({ text: `${author.username} | Filter: ${name} отключен!`, color: "Green", message, codeBlock: "css" });
                    } else return msgUtil.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "отключение фильтра");
            }
            //Если фильтра нет в очереди, значит его надо добавить
        } else {
            //Если пользователь указал аргумент, значит его надо добавить с аргументом
            if (arg && filter.args) {
                //Запускаем голосование
                Vote(message, queue, (win) => {
                    if (win) {
                        queue.filters.push(name);
                        queue.filters.push(arg as any);

                        queue.play = seek;

                        return msgUtil.createMessage({ text: `${author.username} | Filter: ${name}:${arg} включен!`, color: "Green", message, codeBlock: "css" });
                    } else return msgUtil.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "добавление фильтра");
                //Если нет аргумента
            } else {
                //Запускаем голосование
                Vote(message, queue, (win) => {
                    if (win) {
                        queue.filters.push(name);

                        queue.play = seek;

                        return msgUtil.createMessage({ text: `${author.username} | Filter: ${name} включен!`, color: "Green", message, codeBlock: "css" });
                    } else return msgUtil.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "добавление фильтра");
            }
        }
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Голосование за пропуск трека
 * @param message {ClientMessage} Сообщение
 * @param queue {Queue} Музыкальная очередь
 * @param callback {Function} Выполнение функции по завершению
 * @param str {string} Голосование за что?
 * @param arg {number} Какой трек надо будет убрать
 */
function Vote(message: ClientMessage, queue: Queue, callback: (win: boolean) => void, str: string = "пропуск трека", arg?: number): void {
    const { member, author, guild } = message;

    setImmediate(() => {
        const voiceConnection: VoiceState[] = Voice.Members(guild) as VoiceState[];
        const song = queue && arg ? queue?.songs[arg - 1] : null;

        //Если пользователь сидит один или он является владельцем сервера или пользователь включил этот трек, то пропускаем голосование
        if (voiceConnection.length === 1 || member.permissions.has("Administrator") || song.requester.id === message.author.id) return callback(true);
        if (!queue || !queue?.song) return msgUtil.createMessage({ text: `${author.username}, музыка уже не играет!`, message, codeBlock: "css", color: "Yellow" });

        //Пользователи, которые проголосовали за, против
        let Yes: number = 0, No: number = 0;
        const choice = `Голосование за ${str}! | ${member.user.username}\n${song ? `Трек: ${song.title} | ${song.duration.full}` : ""}\n\nГолосование длится всего 5 секунд!`;

        //Отправляем сообщение
        message.channel.send({ content: `\`\`\`css\n${choice}\n\`\`\`` }).then(msg => {
            msgUtil.createReaction(msg, Voting[0],
                (reaction, user) => reaction.emoji.name === Voting[0] && user.id !== message.client.user.id,
                (reaction) => Yes = reaction.count - 1, 5e3
            );
            msgUtil.createReaction(msg, Voting[1],
                (reaction, user) => reaction.emoji.name === Voting[1] && user.id !== message.client.user.id,
                (reaction) => No = reaction.count - 1, 5e3
            );

            //Что делаем по истечению времени (5 сек)
            setTimeout(() => callback(Yes >= No), 5e3);
        });
    });
}