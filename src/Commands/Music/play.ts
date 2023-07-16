import { ApplicationCommandOptionType } from "discord.js";
import {PlayerMessage} from "@AudioPlayer/Message";
import { ClientMessage } from "@Client/Message";
import { Command, ResolveData } from "@Command";
import {MessageUtils} from "@Util/Message";
import {Platform} from "@APIs";
import {env} from "@env";

const Info = env.get("music.info");
const Warning = env.get("APIs.warning");

export default class extends Command {
    public constructor() {
        super({
            name: "play",
            aliases: ["p", "playing", "з", "search", "find"],
            description: "Включение музыки по ссылке или названию, можно прикрепить свой файл!",
            usage: "<url>| <name song> | <platform> <name song>",

            permissions: { client: ["Speak", "Connect"], user: [] },
            options: [
                {
                    name: "query",
                    description: "Необходимо указать ссылку или название трека!",
                    required: true,
                    type: ApplicationCommandOptionType.String
                }
            ],
            cooldown: 8
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): ResolveData | Promise<ResolveData> => {
        const { author, member, guild, client } = message;
        const queue = client.queue.get(guild.id);
        const argument: string = args.join(" ");
        const VoiceChannel = member?.voice?.channel;

        //Если пользователь не подключен к голосовым каналам
        if (!VoiceChannel) return { text: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (queue && queue.voice && VoiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
            text: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
            color: "Yellow"
        };

        //Если пользователь не указал аргумент
        if (!argument) return { text: `${author}, Укажи ссылку или название!`, color: "Yellow" };

        try {
            //Платформа с которой будем взаимодействовать
            const platform = new Platform(argument);

            //Если нет такой платформы
            if (!platform.platform) return void (MessageUtils.send = { text: `⚠️ Warning\n\nУ меня нет поддержки этой платформы!`, codeBlock: "css", color: "Yellow", message });

            const platform_name = platform.platform.toLowerCase();

            //Если нельзя получить данные с определенной платформы
            if (platform.auth) return void (MessageUtils.send = { text: `⚠️ Warning | [${platform_name}]\n\nНет данных для авторизации, запрос не может быть выполнен!`, codeBlock: "css", color: "Yellow", message });

            //Тип запроса
            const type = platform.type(argument);

            //Ищем функцию, которая вернет данные или ошибку
            const callback = platform.callback(type);

            //Если нет функции запроса
            if (!callback) return void (MessageUtils.send = { text: `⚠️ Warning | [${platform_name}]\n\nУ меня нет поддержки этого запроса!`, codeBlock: "css", color: "Yellow", message });

            //Если включено показывать запросы
            if (Info) {
                //Если у этой платформы нельзя получить исходный файл музыки, то сообщаем
                if (platform.audio && Warning) MessageUtils.send = { text: `⚠️ Warning | [${platform_name}]\n\nЯ не могу получать исходные файлы музыки у этой платформы.`, color: "Yellow", codeBlock: "css", message };
                //Отправляем сообщение о текущем запросе
                else MessageUtils.send = { text: `${message.author}, производится запрос в **${platform_name}.${type}**`, color: "Grey", message };
            }

            //Вызываем функцию для получения данных
            callback(platform.filterArgument(argument)).then((info): void => {
                //Если данных нет
                if (!info || info instanceof Error) return void (MessageUtils.send = { text: `⚠️ Warning | [${platform_name}.${type}]\n\nДанные не были получены!`, codeBlock: "css", color: "DarkRed", message });

                //Если пользователь ищет трек и кол-во треков больше одного
                if (info instanceof Array && info.length > 1) return PlayerMessage.toSearch(info, platform.platform, message);

                //Загружаем трек или плейлист в Queue<GuildID>
                client.queue.push = { message, VoiceChannel, info: info instanceof Array ? info[0] : info };
            }).catch((e: any): void => {
                if (e.length > 2e3) (MessageUtils.send = { text: `⛔️ Error | [${platform_name}.${type}]\n\nПроизошла ошибка при получении данных!\n${e.message}`, color: "DarkRed", codeBlock: "css", message });
                else (MessageUtils.send = { text: `⛔️ Error | [${platform_name}.${type}]\n\nПроизошла ошибка при получении данных!\n${e}`, color: "DarkRed", codeBlock: "css", message });
            });
        } catch (e) {
            return { text: `Произошла ошибка -> ${argument}\n${e}`, color: "DarkRed", codeBlock: "css" };
        }
    };
}