import {ApplicationCommandOptionType} from "discord.js";
import {Command} from "@handler";
import {db} from "@Client/db";

export default class extends Command {
    public constructor() {
        super({
            name: "repeat",
            description: "Включение повтора и выключение повтора музыки!",

            usage: "song | Доступны: song, songs, off",
            options: [
                {
                    name: "type",
                    description: "Необходимо указать что-то из...",
                    type: ApplicationCommandOptionType["String"],
                    choices: [
                        {
                            name: "song | Повтор текущего трека",
                            value: "song"
                        },
                        {
                            name: "songs | Повтор всех треков",
                            value: "songs"
                        },
                        {
                            name: "off | Выключение повтора",
                            value: "off"
                        }
                    ]
                }
            ],

            execute: (message, args) => {
                const { author, member, guild } = message;
                const queue = db.music.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
                };

                //Если нет очереди
                else if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                const argument = args?.pop()?.toLowerCase();

                switch (argument) {
                    case "song": {
                        queue.options.loop = "song";
                        return { content: `🔂 | Повтор  | ${queue.songs[0].title}`, codeBlock: "css"};
                    }
                    case "songs": {
                        queue.options.loop = "songs";
                        return { content: `🔁 | Повтор всей музыки`, codeBlock: "css"};
                    }
                    case "off": {
                        queue.options.loop = "off";
                        return { content: `❌ | Повтор выключен`, codeBlock: "css"};
                    }
                }
            }
        });
    };
}