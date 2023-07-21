import {Client, Collection, IntentsBitField} from "discord.js";
import {CollectionQueue} from "@AudioPlayer/Queue/Collection";
import {Command} from "@Command";

export class WatKLOK extends Client {
    #Queue = new CollectionQueue();
    #Commands = new Collection<string, Command>();
    /**
     * @description Плеер
     */
    public get queue() { return this.#Queue; };


    /**
     * @description Получаем ID осколка
     */
    public get ID() { return this.shard?.ids[0] ?? 0; };


    /**
     * @description Все команды бота
     */
    public get commands() { return this.#Commands; };


    /**
     * @description Создаем класс бота и затем запускаем
     */
    public constructor() {
        super({
            intents: [
                //Message (Бот может писать в текстовые каналы)
                IntentsBitField.Flags.GuildMessages,
                IntentsBitField.Flags.DirectMessages,

                //Reaction (Бот может ставить emoji)
                IntentsBitField.Flags.GuildMessageReactions,
                IntentsBitField.Flags.DirectMessageReactions,

                //Emoji and stickers (Бот может получать данные о emoji или стакерах)
                IntentsBitField.Flags.GuildEmojisAndStickers,

                //Slash Commands (Пользователям доступны slash команды)
                IntentsBitField.Flags.GuildIntegrations,

                //Voice (Бот может получить данные кто находится в голосовом канале)
                IntentsBitField.Flags.GuildVoiceStates,

                //Guild (Бот может получить данные о серверах)
                IntentsBitField.Flags.Guilds
            ],
            shards: "auto"
        });
    };
}