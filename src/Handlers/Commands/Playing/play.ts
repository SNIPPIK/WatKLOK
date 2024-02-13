import {ClientMessage} from "@handler/Events/Atlas/interactionCreate";
import {ApplicationCommandOptionType} from "discord.js";
import {Assign, Command} from "@handler";
import {db} from "@Client/db";

export default class extends Assign<Command> {
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
                            name: `${platform.name}`,
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

            execute: (message: ClientMessage, args) => {
                const { author, member, guild } = message;
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

                return db.queue.runAPIs(message, VoiceChannel, args);
            }
        });
    };
}