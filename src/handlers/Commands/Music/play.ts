import {ApplicationCommandOptionType} from "discord.js";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";
import {MessageUtils} from "@Util/Message";
import {APIs} from "@APIs";
import {env} from "@env";

const _musicInfo = env.get("music.info");
const _APIs_warning = env.get("APIs.warning");

export default class extends Command {
    public constructor() {
        super({
            name: "play",
            description: "Включение музыки по ссылке или названию, можно прикрепить свой файл!",
            usage: "<url>| <name song> | <platform> <name song>",

            permissions: { client: ["Speak", "Connect"], user: [] },
            options: [
                {
                    name: "platform",
                    description: "К какой платформе относится запрос?",
                    type: ApplicationCommandOptionType["String"],
                    choices: (APIs.Platforms.length < 25 ? APIs.Platforms : APIs.Platforms.splice(0, 20)).map((platform) => {
                        return {
                            name: `${platform.name} | Запросы: ${platform.requests.map((req) => req.type).join(", ")}`,
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
            cooldown: 8
        });
    };

    public readonly execute = (message: ClientMessage, args: string[]): ResolveData | Promise<ResolveData> => {
        const { author, member, guild, client } = message;
        const queue = client.queue.get(guild.id);
        const VoiceChannel = member?.voice?.channel;

        //Если пользователь не подключен к голосовым каналам
        if (!VoiceChannel) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Платформа с которой будем взаимодействовать
        const platform = new APIs(args[0]), platformLow = platform?.platform?.toLowerCase();

        //Если нет поддержки платформы
        if (!platform.platform) return { text: `⚠️ **Warning**\n\nУ меня нет поддержки этой платформы!`, codeBlock: "css", color: "Yellow" };

        //Если нельзя получить данные с определенной платформы
        if (platform.auth) return { text: `⚠️ **Warning** | **${platformLow}**\n\nНет данных для авторизации, запрос не может быть выполнен!`, color: "Yellow" };

        const type = platform.type(args[1]);
        const callback = platform.callback(type);

        //Если нет поддержки запроса
        if (!callback) return { text: `⚠️ **Warning** | **${platformLow}.${type}**\n\nУ меня нет поддержки этого запроса!`, color: "Yellow" };

        if (_musicInfo) {
            let text = `⚠️ **Warning** | **${platformLow}.${type}**\n\nОжидание ответа от сервера...\n`;
            if (platform.audio && _APIs_warning) text += `Эта платформа не может выдать исходный файл музыки!`;

            MessageUtils.send = { text: text, color: "Yellow", message };
        }

        //Вызываем функцию для получения данных
        callback(args[1])
            .catch((err) => void (MessageUtils.send = { text: `⛔️ **Error** | **${platformLow}.${type}**\n\nПроизошла ошибка при получении данных!\n${err.message}`, color: "DarkRed", message, replied: true }))
            .then((info): void => {
                if (!info || info instanceof Error) return void (MessageUtils.send = { text: `⚠️ **Warning** | **${platformLow}.${type}**\n\nДанные не были получены!`, color: "DarkRed", message });

                client.queue.push = { message, VoiceChannel, info };
            });
    };
}