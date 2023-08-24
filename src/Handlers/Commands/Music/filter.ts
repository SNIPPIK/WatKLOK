import {ApplicationCommandOptionType, Colors, EmbedData} from "discord.js";
import { AudioFilters } from "@AudioPlayer/Audio/AudioFilters";
import { ReactionMenu } from "@Embeds/ReactionMenu";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";
import { ArraySort } from "@Util/ArraySort";
import Filters from "@Json/Filters.json";
import {MessageUtils} from "@Util/Message";

export default class extends Command {
    public constructor() {
        super({
            name: "filter",
            aliases: ["fl"],
            description: "Включение фильтров для музыки!",
            usage: "name | Все фильтры - all",

            options: [
                {
                    name: "choice",
                    description: "Все доступные фильтры - all",
                    type: ApplicationCommandOptionType.String,
                    choices: Filters.length < 25 ? Filters.map((filter) => {
                        return {
                            name: `${filter.names[0]} | ${filter.description.length > 75 ? `${filter.description.substring(0, 75)}...` : filter.description}`,
                            value: filter.names[0]
                        }
                    }) : []
                },
                {
                    name: "argument",
                    description: "Аргумент для фильтра, если он необходим!",
                    type: ApplicationCommandOptionType.String
                }
            ],
            cooldown: 12
        });
    };

    public readonly execute = (message: ClientMessage, args: string[]): ResolveData => {
        const { author, member, guild, client } = message;
        const queue: Queue = client.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return {
            text: `${author}, Необходимо подключится к голосовому каналу!`,
            color: "Yellow"
        };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если статус плеера не позволяет пропустить поток
        if (!queue.player.hasSkipped) return {
            text: `${author} | На данном этапе невозможно пропустить поток!`,
            color: "Yellow"
        };

        //Если текущий трек является потоковым
        if (queue.song.options.isLive) return {
            text: `${author}, Фильтр не может работать совместно с Live треками!`,
            color: "Yellow"
        };

        const FilterName = args[args?.length - 2 ?? args?.length - 1] ?? args[0];
        const arg = args.length > 1 ? Number(args[args?.length - 1]) : null;

        //Пользователи запросил показать все фильтры, если есть очередь то показываем фильтры в очереди
        if (!FilterName) {

            //Если пользователь напишет all, то очередь сервера при ее наличии не будет показана
            if (queue) {
                if (queue.filters.length === 0) return { text: `${author.username}, включенных аудио фильтров нет!`, codeBlock: "css" };
                const ArrayFilters: typeof Filters = [];

                queue.filters.forEach((filter) => {
                    const Filter = Filters.find((fn) => typeof filter === "number" ? null : fn.names.includes(filter));
                    ArrayFilters.push(Filter);
                });

                return this.ReactionMenuFilters(ArrayFilters, message);
            }
            //Показываем все фильтры
        } else if (FilterName === "all") return this.ReactionMenuFilters(Filters, message);


        //Получаем данные о фильтре
        const Filter = AudioFilters.get(FilterName);
        const seek: number = queue.player.duration;

        //Если есть фильтр
        if (Filter) {
            const isFilter = !!queue.filters.find((filter) => typeof Filter === "number" ? null : Filter.names.includes(filter as any));
            const name = Filter.names[0];

            //Если фильтр есть в очереди
            if (isFilter) {
                const index = queue.filters.indexOf(name);

                //Если пользователь указал аргумент, значит его надо заменить
                if (arg && Filter.args) {
                    const isOkArgs = arg >= (Filter.args as number[])[0] && arg <= (Filter.args as number[])[1];

                    //Если аргументы не подходят
                    if (!isOkArgs) return void (MessageUtils.send = { text: `${author.username} | Filter: ${name} не изменен из-за несоответствия аргументов!`, message, color: "Yellow", codeBlock: "css" });

                    queue.filters[index + 1] = arg;
                    queue.play = seek;

                    return void (MessageUtils.send = { text: `Filter: ${name} был изменен аргумент на ${arg}!`, message, codeBlock: "css", color: "Green", replied: false });
                    //Если пользователь не указал аргумент, значит его надо удалить
                } else {
                    if (Filter.args) queue.filters.splice(index, 2); //Удаляем фильтр и аргумент
                    else queue.filters.splice(index, 1); //Удаляем только фильтр

                    queue.play = seek;
                    return void (MessageUtils.send = { text: `Filter: ${name} отключен!`, color: "Green", message, codeBlock: "css", replied: false });
                }
                //Если фильтра нет в очереди, значит его надо добавить
            } else {
                //Если пользователь указал аргумент, значит его надо добавить с аргументом
                if (arg && Filter.args) {
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
        }
        else return { text: `${author.username}, у меня нет такого фильтра. Все фильтры - all`, color: "Yellow", codeBlock: "css" };
    };


    /**
     * @description Запускаем ReactionMenu
     * @param filters {Filters} Все фильтры
     * @param message {ClientMessage} Сообщение с сервера
     * @returns 
     */
    private ReactionMenuFilters = (filters: typeof Filters, message: ClientMessage) => {
        const embed: EmbedData = { title: "Все доступные фильтры", color: Colors.Yellow, thumbnail: { url: message.client.user.avatarURL() }, timestamp: new Date() };
        //Преобразуем все фильтры в string
        const pages = ArraySort<typeof Filters[0]>(5, filters, (filter, index) => {
            return `┌Номер в списке - [${index + 1}]
                    ├ **Названия:** ${filter.names ? `(${filter.names})` : `Нет`}
                    ├ **Аргументы:** ${filter.args ? `(${filter.args})` : `Нет`}
                    ├ **Модификатор скорости:** ${filter.speed ? `${filter.speed}` : `Нет`}
                    └ **Описание:** ${filter.description ? `(${filter.description})` : `Нет`}`
        });
        embed.description = pages[0];
        embed.footer = { text: `${message.author.username} | Лист 1 из ${pages.length}`, iconURL: message.author.displayAvatarURL() }

        return { embed, callbacks: ReactionMenu.DefaultCallbacks(1, pages, embed) };
    };
}