import { ClientMessage } from "@Client/Message";
import { Duration } from "@Utils/Durations";
import { MessageUtils } from "@Utils/Message";
import { env } from "@Client/Fs";

//AudioPlayer
import { CollectionQueue } from "./Queue/Collection";
import { Filter } from "./Audio/AudioFilters";
import { PlayerMessage } from "./Message";
import { Queue } from "./Queue/Queue";
import { Song } from "./Queue/Song";
import { Platform } from "@APIs";


const Info = env.get("music.info");
const Warning = env.get("APIs.warning");

/**
 * @description Храним все очереди здесь
 */
const _queue = new CollectionQueue();



/**
 * @description Все доступные взаимодействия с плеером через client.player
 */
export class Player {
    /**
     * @description Получение всех очередей
     */
    public get queue() { return _queue; };


    /**
     * @description Получаем данные из базы по данным
     * @param message {ClientMessage} Сообщение с сервера
     * @param argument {string} Что требует пользователь
     */
    public readonly play = (message: ClientMessage, argument: string): void => {
        const VoiceChannel = message.member?.voice?.channel;

        //Платформа с которой будем взаимодействовать
        const platform = new Platform(argument);

        //Если нет такой платформы
        if (!platform.platform) return void (MessageUtils.send = { text: `⚠️ Warning\n\nУ меня нет поддержки этой платформы!`, codeBlock: "css", color: "Yellow", message });

        const platform_name = platform.platform.toLowerCase();

        //Если нельзя получить данные с определенной платформы
        if (platform.auth) return void (MessageUtils.send = { text: `⚠️ Warning | [${platform_name}]\n\nНет данных для авторизации, запрос не может быть выполнен!`, codeBlock: "css", color: "Yellow", message });

        //Тип запроса
        const type = platform.type(argument);

        //Ищем функцию, которая вернет данные или ошибку
        const callback = platform.callback(type);

        //Если нет функции запроса
        if (!callback) return void (MessageUtils.send = { text: `⚠️ Warning | [${platform_name}]\n\nУ меня нет поддержки этого запроса!`, codeBlock: "css", color: "Yellow", message });

        //Если включено показывать запросы
        if (Info) {
            //Если у этой платформы нельзя получить исходный файл музыки, то сообщаем
            if (platform.audio && Warning) MessageUtils.send = { text: `⚠️ Warning | [${platform_name}]\n\nЯ не могу получать исходные файлы музыки у этой платформы.`, color: "Yellow", codeBlock: "css", message };
            //Отправляем сообщение о текущем запросе
            else MessageUtils.send = { text: `${message.author}, производится запрос в **${platform_name}.${type}**`, color: "Grey", message };
        }

        //Вызываем функцию для получения данных
        callback(platform.filterArgument(argument)).then((info): void => {
            if (info instanceof Error) return;

            //Если данных нет
            if (!info) return void (MessageUtils.send = { text: `⚠️ Warning | [${platform_name}.${type}]\n\nДанные не были получены!`, codeBlock: "css", color: "DarkRed", message });

            //Если пользователь ищет трек и кол-во треков больше одного
            if (info instanceof Array && info.length > 1) return PlayerMessage.toSearch(info, platform.platform, message);

            //Загружаем трек или плейлист в Queue<GuildID>
            this.queue.create = { message, VoiceChannel, info: info instanceof Array ? info[0] : info };
        }).catch((e: any): void => {
            if (e.length > 2e3) (MessageUtils.send = { text: `⛔️ Error | [${platform_name}.${type}]\n\nПроизошла ошибка при получении данных!\n${e.message}`, color: "DarkRed", codeBlock: "css", message });
            else (MessageUtils.send = { text: `⛔️ Error | [${platform_name}.${type}]\n\nПроизошла ошибка при получении данных!\n${e}`, color: "DarkRed", codeBlock: "css", message });
        });
    };


    /**
     * @description Завершает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     */
    public readonly stop = (message: ClientMessage): void => {
        const { guild } = message;
        const { player }: Queue = this.queue.get(guild.id);

        if (player.hasSkipped) player.stop;
    };


    /**
     * @description Пропускает текущую музыку
     * @param message {ClientMessage} Сообщение с сервера
     * @param args {number} Сколько треков пропускаем
     */
    public readonly skip = (message: ClientMessage, args: number = 1): void => {
        const {guild, author} = message;
        const queue: Queue = this.queue.get(guild.id);
        const {player, songs, options} = queue;
        const {title}: Song = songs[args - 1];

        //Если музыку нельзя пропустить из-за плеера
        if (!player.hasSkipped) return void (MessageUtils.send = { text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

        //Если пользователь укажет больше чем есть в очереди
        if (args > songs.length) return void (MessageUtils.send = { text: `${author}, В очереди ${songs.length}!`, message, color: "Yellow" });

        if (args > 1) {
            if (options.loop === "songs") for (let i = 0; i < args - 2; i++) songs.push(songs.shift());
            else queue.songs = songs.slice(args - 2);

            MessageUtils.send = { text: `⏭️ | Skip to song [${args}] | ${title}`, message, codeBlock: "css", color: "Green", replied: false };
        } else MessageUtils.send = { text: `⏭️ | Skip song | ${title}`, message, codeBlock: "css", color: "Green", replied: false };

        return this.stop(message);
    };


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
        return void (MessageUtils.send = { text: `⏸ | Pause song | ${title}`, message, codeBlock: "css", color: "Green" });
    };


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
        return void (MessageUtils.send = { text: `▶️ | Resume song | ${title}`, message, codeBlock: "css", color: "Green" });
    };


    /**
     * @description Убираем музыку из очереди
     * @param message {ClientMessage} Сообщение с сервера
     * @param arg {string} Аргументы Пример: команда аргумент1 аргумент2
     */
    public readonly remove = (message: ClientMessage, arg: number = 1): void => {
        const {guild, author} = message;
        const queue: Queue = this.queue.get(guild.id);
        const {player, songs} = queue;
        const {title}: Song = songs[arg - 1];

        //Если музыку нельзя пропустить из-за плеера
        if (!player.hasSkipped) return void (MessageUtils.send = { text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

        if (arg === 1) {
            if (queue.options.loop !== "off") {
                queue.songs.splice(0, 1); //Удаляем первый трек
                queue.player.stop;
            } else queue.player.stop;
        } else queue.songs.splice(arg - 1, 1); //Удаляем трек указанный пользователем

        //Сообщаем какой трек был убран
        return void (MessageUtils.send = { text: `⏭️ | Remove song | ${title}`, message, codeBlock: "css", color: "Green" });
    };


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
        if (!player.hasSkipped) return void (MessageUtils.send = { text: `${author}, ⚠ Музыка еще не играет!`, message, color: "Yellow" });

        //Начинаем проигрывание трека с <пользователем указанного тайм кода>
        queue.play = seek;

        //Отправляем сообщение о пропуске времени
        return void (MessageUtils.send = { text: `⏭️ | Seeking to [${Duration.toConverting(seek)}] song | ${title}`, message, codeBlock: "css", color: "Green", replied: false });
    };


    /**
     * @description Повтор текущей музыки
     * @param message {ClientMessage} Сообщение с сервера
     */
    public readonly replay = (message: ClientMessage): void => {
        const { guild} = message;
        const queue: Queue = this.queue.get(guild.id);
        const { song } = queue;
        const { title }: Song = song;

        queue.play = 0;
        //Сообщаем о том что музыка начата с начала
        return void (MessageUtils.send = { text: `🔂 | Replay | ${title}`, message, color: "Green", codeBlock: "css", replied: false });
    };


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
                if (!isOkArgs) return void (MessageUtils.send = { text: `${author.username} | Filter: ${name} не изменен из-за несоответствия аргументов!`, message, color: "Yellow", codeBlock: "css" });

                queue.filters[index + 1] = arg;
                queue.play = seek;

                return void (MessageUtils.send = { text: `${author.username} | Filter: ${name} был изменен аргумент на ${arg}!`, message, codeBlock: "css", color: "Green", replied: false });
                //Если пользователь не указал аргумент, значит его надо удалить
            } else {
                if (filter.args) queue.filters.splice(index, 2); //Удаляем фильтр и аргумент
                else queue.filters.splice(index, 1); //Удаляем только фильтр

                queue.play = seek;
                return void (MessageUtils.send = { text: `${author.username} | Filter: ${name} отключен!`, color: "Green", message, codeBlock: "css", replied: false });
            }
            //Если фильтра нет в очереди, значит его надо добавить
        } else {
            //Если пользователь указал аргумент, значит его надо добавить с аргументом
            if (arg && filter.args) {
                queue.filters.push(name);
                queue.filters.push(arg as any);
                queue.play = seek;

                return void (MessageUtils.send = { text: `${author.username} | Filter: ${name}:${arg} включен!`, color: "Green", message, codeBlock: "css", replied: false });
                //Если нет аргумента
            } else {
                queue.filters.push(name);
                queue.play = seek;

                return void (MessageUtils.send = { text: `${author.username} | Filter: ${name} включен!`, color: "Green", message, codeBlock: "css", replied: false });
            }
        }
    };
}