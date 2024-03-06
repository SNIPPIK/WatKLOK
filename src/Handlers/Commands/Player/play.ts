import {ApplicationCommandOptionType} from "discord.js";
import {Command, Constructor} from "@handler";
import {Client} from "@Client";
import {db} from "@Client/db";

/**
 * @class Command_Play
 * @command play
 * @description Включение музыки по ссылке или названию
 *
 * @param platform - Тип платформы
 * @param request - Ссылка или название трека для поиска
 */
class Command_Play extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "play",
            description: "Включение музыки по ссылке или названию!",

            permissions: ["Speak", "Connect"],
            options: [
                {
                    name: "platform",
                    description: "К какой платформе относится запрос?",
                    type: ApplicationCommandOptionType["String"],
                    choices: (db.platforms.supported.length < 25 ? db.platforms.supported : db.platforms.supported.splice(0, 20)).map((platform) => {
                        return {
                            name: `[${platform.requests.length}] ${platform.name} | ${platform.url}`,
                            value: platform.name
                        }
                    }),
                    required: true
                },
                {
                    name: "request",
                    description: "Необходимо указать ссылку или название трека!",
                    required: true,
                    type: ApplicationCommandOptionType["String"]
                }
            ],

            execute: (message: Client.message, args) => {
                const {author, member, guild} = message;
                const queue = db.queue.get(guild.id);
                const VoiceChannel = member?.voice?.channel;

                //Если пользователь не подключен к голосовым каналам
                if (!VoiceChannel) return {
                    content: `${author}, Необходимо подключится к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                db.queue.events.emit("collection/api", message, VoiceChannel, args);
            }
        });
    };
}

/**
 * @class Command_PlayFile
 * @command play-file
 * @description Включение музыки с использованием файла
 *
 * @param file - Прикрепленный файл
 */
class Command_PlayFile extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "play-file",
            description: "Включение музыки с использованием файла!",

            permissions: ["Speak", "Connect"],
            options: [
                {
                    name: "file",
                    description: "Необходимо прикрепить файл!",
                    type: ApplicationCommandOptionType["Attachment"],
                    required: true
                }
            ],

            execute: (message: Client.interact) => {
                const { author, member, guild } = message;
                const queue = db.queue.get(guild.id);
                const VoiceChannel = member?.voice?.channel;
                const attachment = message.options.getAttachment("file");

                //Если пользователь подсунул фальшивку
                if (!attachment.contentType.match("audio")) return {
                    content: `${author}, В этом файле нет звуковой дорожки!`,
                    color: "Yellow"
                };

                //Если пользователь не подключен к голосовым каналам
                else if (!VoiceChannel) return {
                    content: `${author}, Необходимо подключится к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                db.queue.events.emit("collection/api", message as any, VoiceChannel, ["DISCORD", attachment.url]);
            }
        });
    };
}

/**
 * @class Command_Replay
 * @command replay
 * @description Повтор текущего трека
 */
class Command_Replay extends Constructor.Assign<Command> {
    public constructor() {
        super({
            name: "replay",
            description: "Повторить текущий трек?",
            execute: (message) => {
                const { author, member, guild } = message;
                const queue = db.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если нет очереди
                else if (!queue) return { content: `${author}, ⚠ | Музыка щас не играет.`, color: "Yellow" };
                let { title } = queue.songs.song;

                queue.player.play(queue.songs.song);
                //Сообщаем о том что музыка начата с начала
                return { content: `🔂 | Replay | ${title}`, color: "Green", codeBlock: "css" };
            }
        });
    };
}

export default Object.values({Command_Play, Command_PlayFile, Command_Replay});