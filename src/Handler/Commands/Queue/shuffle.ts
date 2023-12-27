import { ApplicationCommandOptionType } from "discord.js";
import {Song} from "@components/AudioClient/Queue/Song";
import {Command} from "@handler";

import {db} from "@components/QuickDB";

export default class extends Command {
    public constructor() {
        super({
            name: "shuffle",
            description: "Перетасовка музыки в очереди текущего сервера!",

            options: [{
                name: "value",
                description: "Shuffle queue songs",
                required: true,
                type: ApplicationCommandOptionType["String"]
            }],

            execute: (message) => {
                const { author, member, guild } = message;
                const queue = db.music.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если нет треков в очереди
                else if (!queue.songs) return { content: `${author}, Нет музыки в очереди!`, color: "Yellow" };

                //Если треков меньше 3
                else if (queue.songs.length < 3) return { content: `${author}, Очень мало музыки, нужно более 3`, color: "Yellow" };

                this.shuffleSongs(queue.songs);
                return { content: `🔀 | Shuffle total [${queue.songs.length}]`, codeBlock: "css" };
            }
        });
    };

    private shuffleSongs = (songs: Song[]): void => {
        for (let i = songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songs[i], songs[j]] = [songs[j], songs[i]];
        }
    };
}