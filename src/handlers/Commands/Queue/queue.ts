import { MessageReaction, User } from "discord.js";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";
import { Song } from "@AudioPlayer/Queue/Song";
import { ArraySort } from "@Util/ArraySort";
import { Duration } from "@Util/Duration";

export default class extends Command {
    public constructor() {
        super({
            name: "queue",
            description: "Показать всю музыку добавленную в очередь этого сервера?"
        });
    };

    public readonly execute = (message: ClientMessage): ResolveData => {
        const { author, guild, client } = message;
        const queue: Queue = client.queue.get(guild.id);

        //Если нет очереди
        if (!queue) return { text: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

        //Получаем то что надо было преобразовать в string[]
        const pages = ArraySort<Song>(10, queue.songs, (song, index) => {
            const Duration = song.duration.full;

            return `[${index + 1}] - [${Duration}] | ${song.title}`;
        });

        const CurrentPlaying = `Current playing -> [${queue.song.title}]`; //Музыка, которая играет сейчас
        const Footer = `${author.username} | ${Duration.getTimeArray(queue.songs)} | Лист 1 из ${pages.length} | Songs: ${queue.songs.length} | Loop: ${queue.options.loop} | Random: ${queue.options.random} | Radio: ${queue.options.radioMode}`; //Что будет снизу сообщения

        return { embed: `\`\`\`css\n➡️ | ${CurrentPlaying}\n\n${pages[0]}\n\n${Footer}\`\`\``, callbacks: this.Callbacks(1, pages, queue) }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Функции для управления <CollectorSortReaction>
     * @param page {number} С какой страницы начнем
     * @param pages {Array<string>} страницы
     * @param queue {Queue} Очередь сервера
     * @private
     */
    private Callbacks = (page: number, pages: string[], queue: Queue) => {
        return {
            //При нажатии на 1 эмодзи, будет выполнена эта функция
            back: ({ users }: MessageReaction, user: User, message: ClientMessage, msg: ClientMessage): void => {
                setImmediate(() => {
                    users.remove(user).catch((err) => console.log(err));

                    if (page === 1) return null;
                    page--;
                    return this.EditMessage(queue, message, msg, pages, page);
                });
            },
            //При нажатии на 2 эмодзи, будет выполнена эта функция
            cancel: ({ }: MessageReaction, { }: User, message: ClientMessage, msg: ClientMessage): void => {
                setImmediate(() => {
                    [msg, message].forEach((mes) => mes.deletable ? mes.delete().catch(() => null) : null);
                });
            },
            //При нажатии на 3 эмодзи, будет выполнена эта функция
            next: ({ users }: MessageReaction, user: User, message: ClientMessage, msg: ClientMessage): void => {
                setImmediate(() => {
                    users.remove(user).catch((err) => console.log(err));

                    if (page === pages.length) return null;
                    page++;
                    return this.EditMessage(queue, message, msg, pages, page);
                });
            }
        };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Изменяем данные сообщения
     * @param queue {Queue} Очередь сервера
     * @param message {ClientMessage} Сообщение пользователя
     * @param msg {ClientMessage} Сообщение бота
     * @param pages {string[]} Страницы
     * @param page {number} Номер ткущей страницы
     * @private
     */
    private EditMessage = (queue: Queue, message: ClientMessage, msg: ClientMessage, pages: string[], page: number) => {
        const CurrentPlaying = `Current playing -> [${queue.song.title}]`;
        const Footer = `${message.author.username} | ${Duration.getTimeArray(queue.songs)} | Лист ${page} из ${pages.length} | Songs: ${queue.songs.length}`;

        return msg.edit(`\`\`\`css\n➡️ | ${CurrentPlaying}\n\n${pages[page - 1]}\n\n${Footer}\`\`\``);
    };
}