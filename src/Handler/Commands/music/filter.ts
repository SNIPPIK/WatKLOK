import {ClientMessage, EmbedConstructor} from "@Client/interactionCreate";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, ResolveData} from "@Structures/Handle/Command";
import {ArraySort} from "@Structures/ArraySort";
import {ReactionMenu} from "@Structures/ReactionMenu";
import {FFspace} from "@Structures/Media/FFspace";
import Filters from "@db/Filters.json";
import {Queue} from "@Queue/Queue";

export class Command_Filter extends Command {
    public constructor() {
        super({
            name: "filter",
            aliases: ["fl"],
            description: "Включение фильтров для музыки!",
            usage: "name | Все фильтры - all",

            options: [
                {
                    name: "name",
                    description: "Все доступные фильтры - all",
                    type: ApplicationCommandOptionType.String,
                }
            ],

            isSlash: true,
            isEnable: true,

            isCLD: 12
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData => {
        const {author, member, guild, client} = message;
        const queue: Queue = client.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "DarkRed" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return { text: `${author}, Подключись к голосовому каналу!`, color: "DarkRed" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "DarkRed"
        };

        //Если статус плеера не позволяет пропустить поток
        if (!queue.player.hasSkipped) return { text: `${author} | На данном этапе невозможно пропустить поток!`, color: "DarkRed" };

        //Если текущий трек является потоковым
        if (queue.song.isLive) return { text: `${author}, Фильтр не может работать совместно с Live треками!`, color: "DarkRed" };

        const FilterArg = args.length > 1 ? Number(args[args?.length - 1]) : null;
        const FilterName = args[args?.length - 2 ?? args?.length - 1] ?? args[0];
        const SendArg: { color: any, codeBlock: "css" } = {color: "Blue", codeBlock: "css"};

        //Показываем все доступные фильтры
        if (FilterName === "all") return this.ReactionMenuFilters(Filters, message);
        //Выключаем все фильтры
        else if (FilterName === "off") {
            queue.filters.splice(0, queue.filters.length);
            client.player.filter(message);
            return;
        }

        //Если пользователь не указал название фильтра
        if (!FilterName) {
            if (queue.filters.length === 0) return {text: `${author.username}, включенных аудио фильтров нет!`, ...SendArg};
            const ArrayFilters: typeof Filters = [];

            queue.filters.forEach((filter) => {
                const Filter = Filters.find((fn) => typeof filter === "number" ? null : fn.names.includes(filter));
                ArrayFilters.push(Filter);
            });

            return this.ReactionMenuFilters(ArrayFilters, message);
        }
        //Получаем данные о фильтре
        const Filter = FFspace.getFilter(FilterName);

        try {
            //Если есть такой фильтр
            if (Filter) {
                const enableFilter = !!queue.filters.find((filter) => typeof filter === "number" ? null : Filter.names.includes(filter));

                //Если фильтр есть в очереди
                if (enableFilter) {
                    const index = queue.filters.indexOf(FilterName);

                    //Если пользователь указал аргумент, значит его надо заменить
                    if (FilterArg && Filter.args) {

                        //Изменяем аргумент фильтра
                        if (FilterArg >= (Filter.args as number[])[0] && FilterArg <= (Filter.args as number[])[1]) {
                            queue.filters[index + 1] = FilterArg;

                            return {text: `${author.username} | Filter: ${FilterName} был изменен аргумент на ${FilterArg}!`, ...SendArg};
                            //Если аргументы не подходят
                        } else return {text: `${author.username} | Filter: ${FilterName} не изменен из-за несоответствия аргументов!`, ...SendArg};

                    } else { //Если пользователь не указал аргумент, значит его надо удалить
                        if (Filter.args) queue.filters.splice(index, 2); //Удаляем фильтр и аргумент
                        else queue.filters.splice(index, 1); //Удаляем только фильтр

                        return {text: `${author.username} | Filter: ${FilterName} отключен!`, ...SendArg};
                    }
                } else { //Если фильтра нет в очереди, значит его надо добавить
                    if (FilterArg && Filter.args) { //Если есть аргумент

                        //Добавляем с аргументом
                        if (FilterArg >= (Filter.args as number[])[0] && FilterArg <= (Filter.args as number[])[1]) {
                            queue.filters.push(Filter.names[0]);
                            queue.filters.push(FilterArg as any);
                            return {text: `${author.username} | Filter: ${FilterName}:${FilterArg} включен!`, ...SendArg};
                            //Если аргументы не подходят
                        } else return {text: `${author.username} | Filter: ${FilterName} не включен из-за несоответствия аргументов!`, ...SendArg};
                    } else { //Если нет аргумента
                        queue.filters.push(Filter.names[0]);

                        return {text: `${author.username} | Filter: ${FilterName} включен!`, ...SendArg};
                    }
                }
            } else return {text: `${author.username}, у меня нет такого фильтра. Все фильтры - all`, ...SendArg};
        } finally {
            if (Filter) client.player.filter(message);
        }
    };
    //Запускаем ReactionMenu
    private ReactionMenuFilters = (filters: typeof Filters, message: ClientMessage) => {
        const embed: EmbedConstructor = { title: "Все доступные фильтры",  color: Colors.Yellow, thumbnail: { url: message.client.user.avatarURL() }, timestamp: new Date() };
        //Преобразуем все фильтры в string
        const pages = ArraySort<typeof Filters[0]>(5, filters, (filter, index) => {
            return `┌Номер в списке - [${index+1}]
                    ├ **Названия:** ${filter.names ? `(${filter.names})` : `Нет`}
                    ├ **Описание:** ${filter.description ? `(${filter.description})` : `Нет`}
                    ├ **Аргументы:** ${filter.args ? `(${filter.args})` : `Нет`}
                    └ **Модификатор скорости:** ${filter.speed ? `${filter.speed}` : `Нет`}`
        });
        embed.description = pages[0];
        embed.footer = { text: `${message.author.username} | Лист 1 из ${pages.length}`, iconURL: message.author.displayAvatarURL() }

        return {embed, callbacks: ReactionMenu.Callbacks(1, pages, embed)};
    };
}