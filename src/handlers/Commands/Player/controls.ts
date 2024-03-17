import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Command} from "@handler";
import {db} from "@lib/db";

/**
 * @class Command_Pause
 * @command pause
 * @description Приостановить воспроизведение текущего трека
 */
class Command_Pause extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "pause",
            description: "Приостановить воспроизведение текущего трека?!",

            execute: (message) => {
                const { author, member, guild } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если музыка уже приостановлена
                else if (queue.player.status === "player/pause") return { content: `${author}, ⚠ | Музыка уже приостановлена!`, color: "Yellow" };

                //Если текущий трек является потоковым
                else if (queue.songs.song.duration.seconds === 0) return { content: `${author}, ⚠ | Это бесполезно!`, color: "Yellow" };

                //Приостанавливаем музыку если она играет
                queue.player.pause();
                return { content: `⏸ | Pause song | ${queue.songs.song.title}`, codeBlock: "css", color: "Green" };
            }
        });
    };
}

/**
 * @class Command_Resume
 * @command resume
 * @description Возобновить воспроизведение текущего трека
 */
class Command_Resume extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "resume",
            description: "Возобновить воспроизведение текущего трека?!",

            execute: (message) => {
                const { author, member, guild } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если музыка уже играет
                else if (queue.player.status === "player/playing") return { content: `${author}, ⚠ | Музыка сейчас играет.`, color: "Yellow" };

                //Если текущий трек является потоковым
                else if (queue.songs.song.duration.seconds === 0) return { content: `${author}, ⚠ | Это бесполезно!`, color: "Yellow" };

                let { title } = queue.songs.song;

                queue.player.resume();
                return { content: `▶️ | Resume song | ${title}`, codeBlock: "css", color: "Green" };
            }
        });
    };
}

/**
 * @class Command_Stop
 * @command stop
 * @description Удаление музыкальной очереди
 */
class Command_Stop extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "stop",
            description: "Удаление музыкальной очереди!",

            execute: (message) => {
                const { author, guild, member } = message;
                const queue = db.queue.get(guild.id);

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!member.voice?.channel || !member.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`, color: "Yellow"
                };

                db.queue.remove(queue.guild.id);
                return { content: `${author}, музыкальная очередь удалена!` };
            }
        });
    };
}

/**
 * @class Command_Repeat
 * @command repeat
 * @description Включение повтора и выключение повтора музыки
 *
 * @param type - Тип повтора
 */
class Command_Repeat extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "repeat",
            description: "Включение повтора и выключение повтора музыки!",

            options: [
                {
                    name: "type",
                    description: "Тип повтора, необходимо указать!",
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
                const queue = db.queue.get(guild.id);

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
                        queue.repeat = "song";
                        return { content: `🔂 | Повтор  | ${queue.songs[0].title}`, codeBlock: "css"};
                    }
                    case "songs": {
                        queue.repeat = "songs";
                        return { content: `🔁 | Повтор всей музыки`, codeBlock: "css"};
                    }
                    case "off": {
                        queue.repeat = "off";
                        return { content: `❌ | Повтор выключен`, codeBlock: "css"};
                    }
                }
            }
        });
    };
}

export default Object.values({Command_Pause, Command_Resume, Command_Stop, Command_Repeat});