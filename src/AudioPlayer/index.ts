import { ClientMessage, UtilsMsg } from "@Client/interactionCreate";
import { Platform, platform } from "@Structures/Platform";
import { DurationUtils } from "@Structures/Durations";
import { Voting, APIs, Music } from "@db/Config.json";
import { MessagePlayer } from "@Structures/Messages";
import { Balancer } from "@Structures/Balancer";
import { Filter } from "@Media/AudioFilters";
import { Song, ISong } from "@Queue/Song";
import { VoiceState } from "discord.js";
import { Voice } from "@VoiceManager";
import { Queue } from "@Queue/Queue";

/**
 * @description Все доступные взаимодействия с плеером через client.player
 */
export class Player {
    /**
     * @description Получаем данные из базы по данным
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {string} Что требует пользователь
     */
    public play = (message: ClientMessage, args: string): void => {
        const { author, client } = message;
        const VoiceChannel = message.member.voice.channel;

        Balancer.push(() => {
            const type = Platform.type(args); //Тип запроса
            const platform = Platform.name(args); //Платформа с которой будем взаимодействовать
            const argument = Platform.filterArg(args);

            //Если нельзя получить данные с определенной платформы
            if (Platform.isFailed(platform)) return UtilsMsg.createMessage({ text: `${author}, я не могу взять данные с этой платформы **${platform}**\n Причина: [**Authorization data not found**]`, color: "Yellow", message });

            const callback = Platform.callback(platform, type); //Ищем в списке платформу

            if (callback === "!platform") return UtilsMsg.createMessage({ text: `${author}, у меня нет поддержки такой платформы!\nПлатформа **${platform}**!`, color: "Yellow", message });
            else if (callback === "!callback") return UtilsMsg.createMessage({ text: `${author}, у меня нет поддержки этого типа запроса!\nТип запроса **${type}**!\nПлатформа: **${platform}**`, color: "Yellow", message });

            //Если включено показывать запросы
            if (Music.showGettingData) {
                //Отправляем сообщение о текущем запросе
                UtilsMsg.createMessage({ text: `${message.author}, производится запрос в **${platform.toLowerCase()}.${type}**`, color: "Grey", message });

                //Если у этой платформы нельзя получить исходный файл музыки, то сообщаем
                if (Platform.noAudio(platform) && APIs.showWarningAudio) {
                    const workPlatform = Platform.isFailed("YANDEX") ? "youtube.track" : "yandex.track";

                    UtilsMsg.createMessage({ text: `⚠️ Warning | [${platform}]\n\nЯ не могу получать исходные файлы музыки у этой платформы.\nЗапрос будет произведен в ${workPlatform}`, color: "Yellow", codeBlock: "css", message });
                }
            }

            callback(argument).then((data: ISong.SupportRequest) => {
                if (!data) return UtilsMsg.createMessage({ text: `${author}, данные не были найдены!`, color: "DarkRed", message });

                //Если пользователь ищет трек, но найден всего один
                if (data instanceof Array && data.length === 1) return client.queue.create(message, VoiceChannel, data[0]);

                //Если пользователь ищет трек
                else if (data instanceof Array) return MessagePlayer.toSearch(data, platform, message);

                //Загружаем трек или плейлист в GuildQueue
                return client.queue.create(message, VoiceChannel, data);
            }).catch((e) => {
                if (e.length > 2e3) UtilsMsg.createMessage({ text: `${author.username}, данные не были найдены!\nПричина: ${e.message}`, color: "DarkRed", codeBlock: "css", message });
                else UtilsMsg.createMessage({ text: `${author.username}, данные не были найдены!\nПричина: ${e}`, color: "DarkRed", codeBlock: "css", message });
            });
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Завершает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     */
    public stop = (message: ClientMessage): void => {
        const { client, guild } = message;
        const { player }: Queue = client.queue.get(guild.id);

        if (player.hasSkipped) player.stop();
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Пропускает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {number} Сколько треков пропускаем
     */
    public skip = (message: ClientMessage, args: number = 1): void => {
        const { client, guild, author } = message;
        const queue: Queue = client.queue.get(guild.id);
        const { player, songs, options } = queue;
        const { title, url }: Song = songs[args - 1];

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
                    } else UtilsMsg.createMessage({ text: `⏭️ | Skip song | ${title}`, message, codeBlock: "css", color: "Green" });

                    return client.player.stop(message);
                } else {
                    //Если пользователю нельзя пропустить трек сделать
                    return UtilsMsg.createMessage({ text: `${author}, пропустить этот трек [${title}](${url}) не вышло!`, message, color: "Yellow" });
                }
            }, "пропуск трека", args);
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Приостанавливает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    public pause = (message: ClientMessage): void => {
        const { client, guild } = message;
        const { player, song }: Queue = client.queue.get(guild.id);
        const { title }: Song = song;

        //Приостанавливаем музыку если она играет
        player.pause();
        return UtilsMsg.createMessage({ text: `⏸ | Pause song | ${title}`, message, codeBlock: "css", color: "Green" });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Продолжает воспроизведение музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    public resume = (message: ClientMessage): void => {
        const { client, guild } = message;
        const { player, song }: Queue = client.queue.get(guild.id);
        const { title }: Song = song;

        //Продолжаем воспроизведение музыки если она на паузе
        player.resume();
        return UtilsMsg.createMessage({ text: `▶️ | Resume song | ${title}`, message, codeBlock: "css", color: "Green" });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Убираем музыку из очереди
     * @param message {ClientMessage} Сообщение с сервера
     * @param arg {string} Аргументы Пример: команда аргумент1 аргумент2
     */
    public remove = (message: ClientMessage, arg: number = 1): void => {
        const { client, guild, author } = message;
        const queue: Queue = client.queue.get(guild.id);
        const { player, songs } = queue;
        const { title, url }: Song = songs[arg - 1];

        setImmediate(() => {
            //Если музыку нельзя пропустить из-за плеера
            if (!player.hasSkipped) return UtilsMsg.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

            //Запускаем голосование
            Vote(message, queue, (win) => {
                if (win) {
                    //Убираем трек из очереди на выбор пользователя
                    queue.songs.splice(arg - 1, 1);

                    //Если пользователь указал первый трек, то пропускаем го
                    if (arg === 1) this.stop(message);

                    //Сообщаем какой трек был убран
                    return UtilsMsg.createMessage({ text: `⏭️ | Remove song | ${title}`, message, codeBlock: "css", color: "Green" });
                } else {
                    //Если пользователю нельзя это сделать
                    return UtilsMsg.createMessage({ text: `${author}, убрать этот трек [${title}](${url}) не вышло!`, message, color: "Yellow" });
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
    public seek = (message: ClientMessage, seek: number): void => {
        const { client, guild, author } = message;
        const queue: Queue = client.queue.get(guild.id);
        const { song, play, player } = queue;
        const { title }: Song = song;

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
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Повтор текущей музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    public replay = (message: ClientMessage): void => {
        const { client, guild, author } = message;
        const queue: Queue = client.queue.get(guild.id);
        const { song, play } = queue;
        const { title }: Song = song;

        //Запускаем голосование
        Vote(message, queue, (win) => {
            if (win) {
                play();

                //Сообщаем о том что музыка начата с начала
                return UtilsMsg.createMessage({ text: `🔂 | Replay | ${title}`, message, color: "Green", codeBlock: "css" });
            } else return UtilsMsg.createMessage({ text: `${author}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
        }, "повторное проигрывание трека", 1);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Применяем фильтры для плеера
     * @param message {ClientMessage} Сообщение с сервера
     * @param filter {Filter} Сам фильтр
     * @param arg {number} Если надо изменить аргумент фильтра
     */
    public filter = (message: ClientMessage, filter: Filter, arg: number): Promise<void> | void => {
        const { client, guild, author } = message;
        const queue: Queue = client.queue.get(guild.id);
        const { player, play }: Queue = queue;
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
                if (!isOkArgs) return UtilsMsg.createMessage({ text: `${author.username} | Filter: ${name} не изменен из-за несоответствия аргументов!`, message, color: "Yellow", codeBlock: "css" });

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

                        return UtilsMsg.createMessage({ text: `${author.username} | Filter: ${name} отключен!`, color: "Green", message, codeBlock: "css" });
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

                        return UtilsMsg.createMessage({ text: `${author.username} | Filter: ${name}:${arg} включен!`, color: "Green", message, codeBlock: "css" });
                    } else return UtilsMsg.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "добавление фильтра");
                //Если нет аргумента
            } else {
                //Запускаем голосование
                Vote(message, queue, (win) => {
                    if (win) {
                        queue.filters.push(name);

                        play(seek);

                        return UtilsMsg.createMessage({ text: `${author.username} | Filter: ${name} включен!`, color: "Green", message, codeBlock: "css" });
                    } else return UtilsMsg.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
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
        if (!queue || !queue?.song) return UtilsMsg.createMessage({ text: `${author.username}, музыка уже не играет!`, message, codeBlock: "css", color: "Yellow" });

        //Пользователи, которые проголосовали за, против
        let Yes: number = 0, No: number = 0;
        const choice = `Голосование за ${str}! | ${member.user.username}\n${song ? `Трек: ${song.title} | ${song.duration.full}` : ""}\n\nГолосование длится всего 5 секунд!`;

        //Отправляем сообщение
        message.channel.send({ content: `\`\`\`css\n${choice}\n\`\`\`` }).then(msg => {
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