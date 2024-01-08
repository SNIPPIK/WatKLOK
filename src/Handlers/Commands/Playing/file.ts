import {ClientInteraction} from "@handler/Events/Atlas/interactionCreate";
import {ApplicationCommandOptionType} from "discord.js";
import {Command} from "@Client";
import {db} from "@src";

export default class extends Command {
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

            execute: (message: ClientInteraction) => {
                const { author, member, guild } = message;
                const queue = db.music.queue.get(guild.id);
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

                return db.music.queue.runAPIs(message as any, VoiceChannel, ["DISCORD", attachment.url]);
            }
        });
    };
}