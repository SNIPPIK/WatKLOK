import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {Song} from "@watklok/player/queue/Song";
import {Duration, ArraySort} from "@watklok/player";
import {Command} from "@handler";
import {db} from "@Client/db";


export default class extends Command {
    public constructor() {
        super({
            name: "queue",
            description: "Показать всю музыку добавленную в очередь этого сервера?",

            execute: (message) => {
                const { author, guild } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Получаем то что надо было преобразовать в string[]
                const pages = ArraySort<Song>(10, queue.songs, (song, index) => {
                    const Duration = song.duration.full;

                    return `[${index + 1}] - [${Duration}] | ${song.title}`;
                });

                const CurrentPlaying = `Current playing -> [${queue.songs.song.title}]`; //Музыка, которая играет сейчас
                const Footer = `${Duration.getTimeArray(queue.songs)} | Лист 1 из ${pages.length} | Songs: ${queue.songs.length}`; //Что будет снизу сообщения

                return {
                    content: `\`\`\`css\n➡️ | ${CurrentPlaying}\n\n${pages[0]}\n\n${Footer}\`\`\``, pages, page: 1,
                    callback: (msg: ClientMessage, pages: string[], page: number) => {
                        const CurrentPlaying = `Current playing -> [${queue.songs.song.title}]`;
                        const Footer = `${Duration.getTimeArray(queue.songs)} | Лист ${page} из ${pages.length} | Songs: ${queue.songs.length}`;

                        return msg.edit(`\`\`\`css\n➡️ | ${CurrentPlaying}\n\n${pages[page - 1]}\n\n${Footer}\`\`\``);
                    }
                };
            }
        });
    };
}