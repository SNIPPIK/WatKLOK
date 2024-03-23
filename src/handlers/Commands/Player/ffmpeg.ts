import {ApplicationCommandOptionType, Colors, EmbedData} from "discord.js";
import {Constructor, handler} from "@handler";
import {db} from "@lib/db";

/**
 * @class Command_Seek
 * @command seek
 * @description Пропуск времени в текущем треке
 *
 * @param value - Время для пропуска времени
 */
class Command_Seek extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "seek",
            description: "Пропуск времени в текущем треке!",
            options: [
                {
                    name: "value",
                    description: "Пример - 00:00",
                    required: true,
                    type: ApplicationCommandOptionType["String"]
                }
            ],
            execute: (message, args) => {
                const { author, member, guild } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return {
                    content: `${author}, Необходимо подключится к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если текущий трек является потоковым
                else if (queue.songs.song.duration.seconds === 0) return { content: `${author}, А как? Это же стрим!`, color: "Yellow" };

                //Если пользователь не указал время
                else if (!args[0]) return { content: `${author}, Укажи время, пример 00:00:00!`, color: "Yellow" };

                const duration = args[0].duration();

                //Если пользователь написал что-то не так
                if (isNaN(duration)) return { content: `${author}, Я не могу определить что ты написал, попробуй еще раз!`, color: "Yellow" };

                //Если пользователь указал времени больше чем в треке
                else if (duration > queue.songs.song.duration.seconds) return { content: `${author}, Ты указал слишком много времени!`, color: "Yellow" };

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) return { content: `${author}, ⚠ Музыка еще не играет!`, color: "Yellow" };

                //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                queue.player.play(queue.songs.song, duration);

                //Отправляем сообщение о пропуске времени
                return { content: `⏭️ | Seeking to [${args[0]}] song\n> ${queue.songs.song.title}`, codeBlock: "css", color: "Green" };
            }
        });
    };
}

/**
 * @class Command_Filter
 * @command filter
 * @description Включение фильтров для музыки с использованием ffmpeg
 *
 * @param filters - Необходимо выбрать фильтр
 * @param argument - Аргумент для фильтра
 */
class Command_Filter extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "filter",
            description: "Включение фильтров для музыки!",
            options: [
                {
                    name: "filters",
                    description: "Необходимо выбрать фильтр! Все доступные фильтры - all",
                    type: ApplicationCommandOptionType["String"],
                    choices: db.filters.length < 25 ? db.filters.map((filter) => {
                        return {
                            name: `${filter.name} | ${filter.description.length > 75 ? `${filter.description.substring(0, 75)}...` : filter.description}`,
                            value: filter.name
                        }
                    }) : []
                },
                {
                    name: "argument",
                    description: "Аргумент для фильтра, если он необходим!",
                    type: ApplicationCommandOptionType["String"]
                }
            ],

            execute: (message, args) => {
                const { author, member, guild } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return {
                    content: `${author}, Необходимо подключиться к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если статус плеера не позволяет пропустить поток
                else if (!queue.player.playing) return {
                    content: `${author} | На данном этапе невозможно пропустить поток!`,
                    color: "Yellow"
                };

                //Если текущий трек является потоковым
                else if (queue.songs.song.duration.seconds === 0) return {
                    content: `${author}, Фильтр не может работать совместно с Live треками!`,
                    color: "Yellow"
                };

                const FilterName = args[args?.length - 2 ?? args?.length - 1] ?? args[0];
                const arg = args.length > 1 ? Number(args[args?.length - 1]) : null;


                //Показываем пользователю фильтры
                if (!FilterName || FilterName === "all") {
                    if (queue && FilterName !== "all") {
                        if (queue?.player.filters.length === 0) return { content: `${author.username}, включенных аудио фильтров нет!`, codeBlock: "css" };
                    }

                    const embed: EmbedData = { title: "Все доступные фильтры", color: Colors.Yellow, thumbnail: { url: message.client.user.avatarURL() }, timestamp: new Date() };
                    //Преобразуем все фильтры в string
                    const pages = (FilterName === "all" ? db.filters : queue?.player?.filters).ArraySort(5, (filter, index) => {
                        return `┌Номер в списке - [${index + 1}]
                    ├ **Название:** ${filter.name ? `(${filter.name})` : `Нет`}
                    ├ **Аргументы:** ${filter.args ? `(${filter.args})` : `Нет`}
                    ├ **Модификатор скорости:** ${filter.speed ? `${filter.speed}` : `Нет`}
                    └ **Описание:** ${filter.description ? `(${filter.description})` : `Нет`}`
                    });
                    embed.description = pages[0];
                    embed.footer = { text: `${message.author.username} | Лист 1 из ${pages.length}`, iconURL: message.author.displayAvatarURL() }

                    return { pages, page: 0, embeds: [embed],
                        callback: (msg, pages, page) => {
                            return msg.edit({
                                embeds: [{ ...embed, description: pages[page - 1], footer: { ...embed.footer, text: `${message.author.username} | Лист ${page} из ${pages.length}`} }]
                            });
                        }
                    };
                }


                //Получаем данные о фильтре
                const Filter = db.filters.find((item) => item.name === FilterName);
                const seek: number = queue.player.stream?.duration ?? 0;

                //Если есть фильтр
                if (Filter) {
                    const isQueue = !!queue.player.filters.find((filter) => typeof Filter === "number" ? null : Filter.name.includes(filter as any));
                    const name = Filter.name;

                    for (let i = 0; i < queue.player.filters.length; i++) {
                        const filter = queue.player.filters[i];

                        if (Filter.unsupported.includes(filter.name)) return { content: `${author.username}, найден не совместимый фильтр! ${filter.name} нельзя использовать вместе с ${Filter.name}`, codeBlock: "css" };
                    }

                    delete Filter.description;

                    //Если фильтр есть в очереди
                    if (isQueue) {
                        const index = queue.player.filters.indexOf(Filter);

                        //Если пользователь указал аргумент, значит его надо заменить
                        if (arg && Filter.args) {
                            const isOkArgs = arg >= (Filter.args as number[])[0] && arg <= (Filter.args as number[])[1];

                            //Если аргументы не подходят
                            if (!isOkArgs) return { content: `Filter: ${name} не изменен из-за несоответствия аргументов!`, color: "Yellow", codeBlock: "css" };

                            Filter.user_arg = arg;
                            queue.player.filters[index] = Filter;
                            queue.player.play(queue.songs.song, seek);

                            return { content: `Filter: ${name} был изменен аргумент на ${arg}!`, codeBlock: "css", color: "Green", replied: false };
                        }

                        queue.player.filters.splice(index, 1); //Удаляем фильтр
                        queue.player.play(queue.songs.song, seek);
                        return {content: `Filter: ${name} отключен!`, color: "Green", codeBlock: "css", replied: false};
                    }
                    //Если надо добавить аргумент
                    else if (arg && Filter.args) Filter.user_arg = arg;

                    queue.player.filters.push(Filter);
                    queue.player.play(queue.songs.song, seek);

                    return {content: `Filter: ${Filter.user_arg ? `${name}:${args}` : name} включен!`, color: "Green", codeBlock: "css", replied: false};
                }

                return { content: `${author.username}, у меня нет такого фильтра. Все фильтры - all`, color: "Yellow", codeBlock: "css" };
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Filter, Command_Seek});