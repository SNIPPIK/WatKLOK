import { AudioFilters } from "@AudioPlayer/Audio/Media/AudioFilters";
import { ClientMessage, EmbedConstructor } from "@Client/Message";
import { ApplicationCommandOptionType, Colors } from "discord.js";
import { Command, ResolveData } from "@Structures/Handlers";
import { ReactionMenu } from "@Structures/ReactionMenu";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ArraySort } from "@Utils/ArraySort";
import Filters from "@db/Filters.json";

export class FilterCommand extends Command {
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
        const { author, member, guild, client } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка щас не играет.`, color: "Yellow" };

        //Если пользователь не подключен к голосовым каналам
        if (!member?.voice?.channel || !member?.voice) return {
            text: `${author}, Подключись к голосовому каналу!`,
            color: "Yellow"
        };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
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
        const FilterArg = args.length > 1 ? Number(args[args?.length - 1]) : null;

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

        if (Filter) client.player.filter(message, Filter, FilterArg);
        else return { text: `${author.username}, у меня нет такого фильтра. Все фильтры - all`, color: "Yellow", codeBlock: "css" };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Запускаем ReactionMenu
     * @param filters {Filters} Все фильтры
     * @param message {ClientMessage} Сообщение с сервера
     * @returns 
     */
    private ReactionMenuFilters = (filters: typeof Filters, message: ClientMessage) => {
        const embed: EmbedConstructor = { title: "Все доступные фильтры", color: Colors.Yellow, thumbnail: { url: message.client.user.avatarURL() }, timestamp: new Date() };
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