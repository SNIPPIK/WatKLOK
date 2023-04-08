import { Voting, APIs, Music, Debug } from "@db/Config.json";
import { OpusAudio } from "./Structures/Media/OpusAudio";
import { Filter } from "./Structures/Media/AudioFilters";
import { MessagePlayer } from "./Structures/Messages";
import { DownloadManager } from "./Plugins/Download";
import { Collection, VoiceState } from "discord.js";
import { DurationUtils } from "@Utils/Durations";
import { Song, ISong } from "./Structures/Song";
import { Platform, platform } from "./Platform";
import { ClientMessage } from "@Client/Message";
import { Queue } from "./Structures/Queue";
import { httpsClient } from "@httpsClient";
import { UtilsMsg } from "@Utils/Msg";
import { Voice } from "@Utils/Voice";
import { Logger } from "@Logger";

//====================== ====================== ====================== ======================
/**
 * @description Все доступные взаимодействия с плеером через client.player
 */
class Player {
    /**
     * @description Получение всех очередей
     */
    public get queue() { return _queue; };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные из базы по данным
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {string} Что требует пользователь
     */
    public readonly play = (message: ClientMessage, args: string): void => {
        const VoiceChannel = message.member?.voice?.channel;

        setImmediate((): void => {
            //Платформа с которой будем взаимодействовать
            const platform = Platform.name(args);

            //Если нет такой платформы 
            if (!platform) return UtilsMsg.createMessage({ text: `⚠️ Warning\n\nУ меня нет поддержки этой платформы!`, codeBlock: "css", color: "Yellow", message });

            //Если нельзя получить данные с определенной платформы
            if (Platform.isFailed(platform)) return UtilsMsg.createMessage({ text: `⚠️ Warning | [${platform}]\n\nНет данных для авторизации, запрос не может быть выполнен!`, codeBlock: "css", color: "Yellow", message });

            //Тип запроса
            const type = Platform.type(args, platform);

            //Ищем функцию которая вернет данные или ошибку
            const callback = Platform.callback(platform, type);

            //Если нет функции запроса
            if (!callback) return UtilsMsg.createMessage({ text: `⚠️ Warning | [${platform}]\n\nУ меня нет поддержки этого запроса!`, codeBlock: "css", color: "Yellow", message });

            //Если включено показывать запросы
            if (Music.showGettingData) {
                //Отправляем сообщение о текущем запросе
                UtilsMsg.createMessage({ text: `${message.author}, производится запрос в **${platform.toLowerCase()}.${type}**`, color: "Grey", message });

                //Если у этой платформы нельзя получить исходный файл музыки, то сообщаем
                if (Platform.isAudio(platform) && APIs.showWarningAudio) {
                    const workPlatform = Platform.isFailed("YANDEX") ? "youtube.track" : "yandex.track";

                    UtilsMsg.createMessage({ text: `⚠️ Warning | [${platform}]\n\nЯ не могу получать исходные файлы музыки у этой платформы.\nЗапрос будет произведен в ${workPlatform}`, color: "Yellow", codeBlock: "css", message });
                }
            }

            const argument = Platform.filterArg(args);

            //Вызываем функцию для получения данных
            callback(argument).then((data: ISong.SupportRequest) => {
                //Если данных нет
                if (!data) return UtilsMsg.createMessage({ text: `⚠️ Warning | [${platform}.${type}]\n\nДанные не были получены!`, codeBlock: "css", color: "DarkRed", message });

                //Если пользователь ищет трек, но найден всего один
                if (data instanceof Array && data.length === 1) return this.queue.create(message, VoiceChannel, data[0]);

                //Если пользователь ищет трек
                else if (data instanceof Array) return MessagePlayer.toSearch(data, platform, message);

                //Загружаем трек или плейлист в GuildQueue
                return this.queue.create(message, VoiceChannel, data);
            }).catch((e: any) => {
                if (e.length > 2e3) UtilsMsg.createMessage({ text: `⛔️ Error | [${platform}.${type}]\n\nПроизошла ошибка при получении данных!\n${e.message}`, color: "DarkRed", codeBlock: "css", message });
                else UtilsMsg.createMessage({ text: `⛔️ Error | [${platform}.${type}]\n\nПроизошла ошибка при получении данных!\n${e}`, color: "DarkRed", codeBlock: "css", message });
            });
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

        if (player.hasSkipped) player.stop();
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
    public readonly pause = (message: ClientMessage): void => {
        const { guild } = message;
        const { player, song }: Queue = this.queue.get(guild.id);
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
    public readonly resume = (message: ClientMessage): void => {
        const { guild } = message;
        const { player, song }: Queue = this.queue.get(guild.id);
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
    public readonly remove = (message: ClientMessage, arg: number = 1): void => {
        const { guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
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
    public readonly seek = (message: ClientMessage, seek: number): void => {
        const { guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
        const { song, player } = queue;
        const { title }: Song = song;

        //Если музыку нельзя пропустить из-за плеера
        if (!player.hasSkipped) return UtilsMsg.createMessage({ text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

        //Запускаем голосование
        Vote(message, queue, (win) => {
            if (win) {
                queue.callback(seek); //Начинаем проигрывание трека с <пользователем указанного тайм кода>

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
    public readonly replay = (message: ClientMessage): void => {
        const { guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
        const { song } = queue;
        const { title }: Song = song;

        //Запускаем голосование
        Vote(message, queue, (win) => {
            if (win) {
                queue.callback()

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
    public readonly filter = (message: ClientMessage, filter: Filter, arg: number): Promise<void> | void => {
        const { guild, author } = message;
        const queue: Queue = this.queue.get(guild.id);
        const { player }: Queue = queue;
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

                        queue.callback(seek);

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

                        queue.callback(seek);

                        return UtilsMsg.createMessage({ text: `${author.username} | Filter: ${name} отключен!`, color: "Green", message, codeBlock: "css" });
                    } else return UtilsMsg.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
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

                        queue.callback(seek);

                        return UtilsMsg.createMessage({ text: `${author.username} | Filter: ${name}:${arg} включен!`, color: "Green", message, codeBlock: "css" });
                    } else return UtilsMsg.createMessage({ text: `${author.username}, остальные пользователи не согласны с твоим мнением!`, message, codeBlock: "css", color: "Yellow" });
                }, "добавление фильтра");
                //Если нет аргумента
            } else {
                //Запускаем голосование
                Vote(message, queue, (win) => {
                    if (win) {
                        queue.filters.push(name);

                        queue.callback(seek);

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
export const globalPlayer = new Player();


//====================== ====================== ====================== ======================
/**
 * @description Collection Queue, содержит в себе все очереди
 */
class CollectionQueue<V, K> extends Collection<V, K> {
    /**
    * @description Создаем очереди или добавляем в нее обьект или обьекты
    * @param message {ClientMessage} Сообщение с сервера
    * @param VoiceChannel {Voice.Channels} К какому голосовому каналу надо подключатся
    * @param info {ISong.track | ISong.playlist} Входные данные это трек или плейлист?
    * @requires {CreateQueue}
    */
    public create = (message: ClientMessage, VoiceChannel: Voice.Channels, info: ISong.track | ISong.playlist): void => {
        const { queue, status } = this.CreateQueue(message, VoiceChannel);
        const requester = message.author;

        //Запускаем callback плеера, если очередь была создана, а не загружена!
        if (status === "create") setImmediate(() => this.playCallback(message.guild.id));

        //Зугружаем плейлисты или альбомы
        if ("items" in info) {
            //Отправляем сообщение о том что плейлист будет добавлен в очередь
            MessagePlayer.toPushPlaylist(message, info);

            //Зугрежаем треки из плейлиста в очередь
            for (let track of info.items) queue.songs.push(new Song(track, requester));
            return;
        }

        //Добавляем трек в очередь
        const song = new Song(info, requester);
        if (queue.songs.length >= 1) MessagePlayer.toPushSong(queue, song);

        queue.songs.push(song);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Запуск проигрывания трека
     * @param QueueID {string} Номер очереди или ID сервера
     * @param seek {number} До скольки надо пропустить
     */
    protected playCallback = (QueueID: string, seek: number = 0): void => {
        const queue = _queue.get(QueueID);
        const song = queue.song;

        //Если треков в очереди больше нет
        if (!song) return queue.cleanup();

        setImmediate((): void => {
            //Отправляем сообщение с авто обновлением
            if (!seek) MessagePlayer.toPlay(queue.message);

            new Promise<string>((resolve) => {
                //Если пользователь включил кеширование музыки
                if (Music.CacheMusic) {
                    const info = DownloadManager.getNames(song);

                    //Если есть файл выдаем путь до него
                    if (info.status === "final") return resolve(info.path);
                }

                //Проверяем ссылку на работоспособность
                return findSong.checkingLink(song.link, song).then((url: string) => {
                    if (!url) return resolve(null);

                    //Если включено кеширование музыки то скачиваем
                    if (Music.CacheMusic) setImmediate(() => DownloadManager.download(song, url));

                    song.link = url;
                    return resolve(url);
                });
            }).then((url: string) => {
                //Если ссылка не была найдена
                if (!url) return void queue.player.emit("error", Error(`Link to resource, not found`), true);

                //Создаем поток
                const stream = new OpusAudio(url, { seek, filters: queue.song.options.isLive ? [] : queue.filters });

                //Отправляем поток в плеер
                return queue.player.readStream(stream);

                //Если получение ссылки вызывает ошибку
            }).catch((err: string) => queue.player.emit("error", Error(err), true));

            //Если включен режим отладки показывает что сейчас играет и где
            if (Debug) {
                if (!seek && !queue.filters.length) Logger.debug(`[Queue]: [${QueueID}]: Play: [${song.duration.full}] - [${song.author.title} - ${song.title}]`);
                else Logger.debug(`[Queue]: [${QueueID}]: Play: [seek: ${seek} | filters: ${queue.filters.length}] | [${song.duration.full}] - [${song.author.title} - ${song.title}]`);
            }
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем очереди или если она есть выдаем
     * @param message {ClientMessage} Сообщение с сервера
     * @param VoiceChannel {Voice.Channels} К какому голосовому каналу надо подключатся
     */
    private CreateQueue = (message: ClientMessage, VoiceChannel: Voice.Channels): { status: "create" | "load", queue: Queue } => {
        const { client, guild } = message;
        const queue = client.player.queue.get(guild.id);

        if (queue) return { queue, status: "load" };

        //Создаем очередь
        const GuildQueue = new Queue(message, VoiceChannel);

        //Подключаемся к голосовому каналу
        GuildQueue.player.connection = Voice.Join(VoiceChannel); //Добавляем подключение в плеер
        client.player.queue.set(guild.id, GuildQueue); //Записываем очередь в <client.queue>

        return { queue: GuildQueue, status: "create" };
    };
}
//====================== ====================== ====================== ======================
/**
 * @description Храним все очереди здесь
 */
const _queue = new CollectionQueue<string | number, Queue>();
//====================== ====================== ====================== ======================
/*                             Namespace for find url resource                             */
//====================== ====================== ====================== ======================
namespace findSong {
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем исходник трека
     * @param req {number} Кол-во повторных запросов (не менять)
     */
    export function checkingLink(url: string, song: Song, req = 0): Promise<string> {
        return new Promise(async (resolve) => {
            if (req > 3) return resolve(null);

            //Если нет ссылки, то ищем трек
            if (!url) url = await getLink(song);

            //Проверяем ссылку на работоспособность
            const check = await httpsClient.checkLink(url);

            //Если ссылка работает
            if (check) return resolve(url);

            //Если ссылка не работает, то удаляем ссылку и делаем новый запрос
            req++;
            return resolve(checkingLink(null, song, req));
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем данные о треке заново
     * @param song {Song} Трек который надо найти по новой
     */
    function getLink({ platform, url, author, title, duration }: Song): Promise<string> {
        if (!Platform.isAudio(platform)) {
            const callback = Platform.callback(platform, "track");

            //Если нет такой платформы или нет callbacks.track
            if (typeof callback === "string") return null;

            //Выдаем ссылку
            return (callback(url) as Promise<ISong.track>).then((track: ISong.track) => track?.format?.url);
        }
        //Ищем трек
        let track = searchTracks(`${author.title} ${title}`, duration.seconds, platform);

        //Если трек не найден пробуем 2 вариант без автора
        if (!track) track = searchTracks(title, duration.seconds, platform);

        return track;
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Ищем трек на yandex music, если нет токена yandex music или yandex зажмотил ссылку то ищем на YouTube
     * @param nameSong {string} Название трека
     * @param duration {number} Длительность трека
     * @param platform {platform} Платформа
     */
    function searchTracks(nameSong: string, duration: number, platform: platform): Promise<string> {
        const exPlatform = Platform.isFailed(platform) || Platform.isAudio(platform) ? Platform.isFailed("YANDEX") ? "YOUTUBE" : "YANDEX" : platform;
        const callbacks = Platform.full(exPlatform).requests;

        const seacrh = callbacks.find((req) => req.type === "search");
        const track = callbacks.find((req) => req.type === "track");

        return (seacrh.run(nameSong) as Promise<ISong.track[]>).then((tracks: ISong.track[]) => {
            //Фильтруем треки оп времени
            const FindTracks: ISong.track[] = tracks.filter((track: ISong.track) => {
                const DurationSong: number = (exPlatform === "YOUTUBE" ? DurationUtils.ParsingTimeToNumber : parseInt)(track.duration.seconds);

                //Как надо фильтровать треки
                return DurationSong === duration || DurationSong < duration + 7 && DurationSong > duration - 5 || DurationSong < duration + 27 && DurationSong > duration - 27;
            });

            //Если треков нет
            if (FindTracks?.length < 1) return null;

            //Получаем данные о треке
            return (track.run(FindTracks[0].url) as Promise<ISong.track>).then((video: ISong.track) => video?.format?.url) as Promise<string>;
        });
    }
}