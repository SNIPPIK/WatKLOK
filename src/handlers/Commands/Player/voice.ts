import {ApplicationCommandOptionType, StageChannel, VoiceChannel, ChannelType} from "discord.js";
import {Constructor, handler} from "@handler";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";

/**
 * @class Command_Join
 * @command join
 * @description Подключение к вашему голосовому каналу!
 */
class Command_Join extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "join",
            description: "Подключение к вашему голосовому каналу!",
            permissions: ["Speak", "Connect"],
            execute: (message) => {
                const { author, member, guild } = message;
                const voiceChannel: VoiceChannel | StageChannel = member.voice.channel;
                const queue = db.queue.get(guild.id);

                //Если пользователь не подключен к голосовым каналам
                if (!member?.voice?.channel || !member?.voice) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если пользователь пытается подключить бота к тому же каналу
                else if (voiceChannel.id === guild.members.me.voice.id || queue && voiceChannel.id === queue.voice.id && guild.members.me.voice.channel) return { content: `${author}, Я уже в этом канале <#${voiceChannel.id}>.`, color: "Yellow" };

                //Если нет очереди
                else if (!queue) return { content: `${author}, Я подключусь сам когда надо! В данный момент музыка не играет!`, color: "Yellow" };

                queue.message = message as any;
                queue.voice = voiceChannel;
                return { content: `${author}, Переподключение к ${queue.voice}`, color: "Yellow" };
            }
        });
    };
}

/**
 * @class Command_Leave
 * @command leave
 * @description Отключение от голосового канала!
 */
class Command_Leave extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "leave",
            description: "Отключение от голосового канала!",
            execute: (message) => {
                const {guild, member, author} = message;
                const queue = db.queue.get(guild.id);
                const voiceConnection = Voice.get(guild.id);

                //Если бот не подключен к голосовому каналу
                if (!voiceConnection) return {
                    content: `${author}, я не подключен к голосовому каналу!`,
                    color: "Yellow"
                };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && member?.voice?.channel?.id !== queue.voice.id) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                voiceConnection.disconnect();
                if (queue) return {content: `${author}, отключение от голосового канала! Очередь будет удалена!`};

                return {content: `${author}, отключение от голосового канала!`};
            }
        });
    };
}

/**
 * @class Command_Stage
 * @command stage
 * @description Запрос на транслирование музыки в трибуну!
 * @param choice - Запрос или подключение
 */
class Command_Stage extends Constructor.Assign<handler.Command> {
    public constructor() {
        super({
            name: "stage",
            description: "Запрос на транслирование музыки в трибуну!",
            permissions: ["Speak", "Connect", "RequestToSpeak"],
            options: [
                {
                    name: "choice",
                    description: "Варианты взаимодействия с трибунами!",
                    required: true,
                    type: ApplicationCommandOptionType["String"],
                    choices: [
                        {
                            name: "join - Подключение к трибуне",
                            value: "join"
                        },
                        {
                            name: "request - Запрос на подключение",
                            value: "request"
                        }
                    ]
                }
            ],
            execute: (message, args) => {
                const { author, member, guild } = message;
                const voiceChannel = member?.voice?.channel;
                const queue = db.queue.get(guild.id);
                const me = message.guild.members?.me;

                //Если нет очереди
                if (!queue) return { content: `${author}, ⚠ | Музыка сейчас не играет.`, color: "Yellow" };

                //Если пользователь не подключен к голосовым каналам
                else if (!voiceChannel) return { content: `${author}, Необходимо подключится к голосовому каналу!`, color: "Yellow" };

                //Если есть очередь и пользователь не подключен к тому же голосовому каналу
                else if (queue && queue.voice && voiceChannel?.id !== queue.voice.id && guild.members.me.voice.channel) return {
                    content: `${author}, Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#${queue.voice.id}>`,
                    color: "Yellow"
                };

                //Если текстовые каналы совпадают
                else if (queue.message.channelId === message.channelId) return { content: `${author}, этот текстовый канал совпадает с тем что в очереди!`, color: "Yellow" }

                //Если голосовой канал не трибуна
                else if (voiceChannel.type === ChannelType["GuildVoice"]) return { content: `${author}, этот голосовой канал не является трибуной!`, color: "Yellow" }

                return new Promise((resolve) => {
                    (args[0] === "join" ? me.voice.setSuppressed : me.voice.setRequestToSpeak)(true)
                        .then(() => {
                            if (args[0] === "join") return resolve({content: `${author}, подключение к трибуне произведено!`, color: "Green"});
                            return resolve({content: `${author}, запрос на трибуну отправлен!`, color: "Green"});
                        })
                        .catch(() => {
                            if (args[0] === "join") return resolve({content: `${author}, не удалось подключится к трибуне!`, color: "DarkRed"});
                            return resolve({content: `${author}, не удалось отправить запрос!`, color: "Green"});
                        });
                });
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Join, Command_Leave, Command_Stage});