import {Client, Collection, IntentsBitField, REST, Routes} from "discord.js";
import {initDataDir} from "@Client/FileSystem";
import {Command} from "@Command";
import {Action} from "@Action";
import {Logger} from "@Logger";
import {API, Platform} from "@APIs";
import {env} from "@env";
import {CollectionQueue} from "@AudioPlayer/Queue/Collection";

/**
 * @description Храним все очереди здесь
 */
const _queue = new CollectionQueue();
const commands = new Collection<string, Command>();


export class WatKLOK extends Client {
    /**
     * @description Плеер
     */
    public get queue() { return _queue; };


    /**
     * @description Получаем ID осколка
     */
    public get ID() { return this.shard?.ids[0] ?? 0}


    /**
     * @description Все команды бота
     */
    public get commands() { return commands; };


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


    /**
     * @description Немного меняем djs<Client.login>
     * @param token {string} Токен, по умолчанию будет взят из env.TOKEN
     */
    public login(token: string): Promise<string> {
        //Загружаем команды
        new initDataDir<Command>("Commands", (file, data) => {
            commands.set(data.name, data);
        }).reading();
        //Загружаем ивенты
        new initDataDir<Action>("Actions", (file, data) => {
            this.on(data.name as any, (...args) => data.run(...args, this));
        }).reading();


        this.once("ready", () => {
            const rest = new REST().setToken(token);

            //Загружаем в Discord API SlashCommands
            (async () => {
                try {
                    const PublicCommands = commands.filter((command) => !command.isOwner).toJSON();
                    const OwnerCommands = commands.filter((command) => command.isOwner).toJSON();

                    //Загружаем все команды
                    const PublicData: any = await rest.put(Routes.applicationCommands(this.user.id), {body: PublicCommands});
                    const OwnerData: any = await rest.put(Routes.applicationGuildCommands(this.user.id, env.get("bot.owner.server")), {body: OwnerCommands});

                    if (env.get("debug.client")) Logger.debug(`SlashCommands: Load: Public: ${PublicData.length} | Owner: ${OwnerData.length}`);
                } catch (error) { Logger.error(error); }
            })();

            const Platforms = Platform.Platforms;

            if (Platforms.audio.length === 0) {
                if (!env.get("bot.token.spotify")) Platforms.auth.push("SPOTIFY");
                if (!env.get("bot.token.vk")) Platforms.auth.push("VK");
                if (!env.get("bot.token.yandex")) Platforms.auth.push("YANDEX");

                //Если платформа не поддерживает получение аудио
                for (let platform of Platforms.all) if (!platform.audio) Platforms.audio.push(platform.name);

                ["YouTube", "Yandex", "Discord", "VK", "Spotify"].forEach((platform) => {
                    const Platform = Platforms.all.find(data => data.name === platform.toUpperCase());
                    const index = Platforms.all.indexOf(Platform);

                    new initDataDir<API.list | API.array | API.track>(`Models/APIs/${platform}/Classes`,
                        (_, data) => Platforms.all[index].requests.push(data), true).reading();

                    Platforms.all[index].requests.reverse();
                });
            }
        });

        return super.login(token);
    };
}