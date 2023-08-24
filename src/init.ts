import { ShardManager } from "@Client/ShardManager";
import {initDataDir} from "@Client/FileSystem";
import {REST, Routes} from "discord.js";
import { WatKLOK } from "@Client";
import { Logger } from "@Logger";
import {Command} from "@Command";
import {API, APIs} from "@APIs";
import {Action} from "@Action";
import {readdirSync} from "fs";
import { env } from "@env";

class init {
    /**
     * @description Запускаем ShardManager
     */
    public ShardManager = () => {
        const manager = new ShardManager(__filename);
        Logger.log("ShardManager has starting");

        //Ивент создания дубликата
        manager.on("shardCreate", (shard) => {
            shard.on("spawn", () => Logger.log(`[Shard ${shard.id}] has added to manager`));
            shard.on("ready", () => Logger.log(`[Shard ${shard.id}] has ready`));
            shard.on("death", () => Logger.log(`[Shard ${shard.id}] has killed`));
        });

        //Создаем дубликат
        manager.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.error(`[ShardManager]: ${err}`));
    };


    /**
     * @description Запускаем клиент
     */
    public Shard = () => {
        const client = new WatKLOK();
        const token = env.get("bot.token.discord");

        //Что будет происходить после подключения к WS
        client.login(token).then((): void => {
            //Сообщаем что бот подключился к discord api
            Logger.log(`[Shard ${client.ID}] has connected for websocket`);

            if (env.get("bot.error.ignore")) process.on("uncaughtException", (err): void => {
                //Если выключено APIs.showErrors, то ошибки не будут отображаться
                if (!env.get("APIs.error.show") && err?.message?.match(/APIs/)) return;

                Logger.error(`\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);

                //Если выключено APIs.sendErrors, то ошибки не буду отправляться в текстовый канал
                if (!env.get("APIs.error.send") && err?.message?.match(/APIs/)) return;

                try {
                    const channel = client.channels.cache.get(env.get("channel.error")) as any;

                    if (channel) channel.send({ content: `\`\`\`ts\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}\n\`\`\`` }).catch((): void => {});
                } catch {/* Continue */ }
            });
        });

        //Что будет происходить когда бот будет готов
        client.once("ready", () => {
            //Загружаем APIs для возможности включать треки
            this.loadAPIs(client.ID);

            //Загружаем необходимые данные
            this.loadModules(client);

            //Загружаем команды и отправляем через REST
            this.pushApplicationCommands(token, client.commands, client.user.id);

            //Создание ссылки если нет серверов
            if (client.guilds.cache.size === 0) Logger.log(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=274914633792&scope=applications.commands%20bot`);
        });
    };


    /**
     * @description Загружаем общие модули
     * @param client {WatKLOK} Бот
     */
    private loadModules = (client: WatKLOK) => {
        //Загружаем команды
        new initDataDir<Command>("Handlers/Commands", (data) => {
            if (!data.execute || !data.name) return;

            client.commands.set(data.name, data);
        }).reading;
        Logger.log(`[Shard ${client.ID}] has initialize commands`);

        //Загружаем ивенты
        new initDataDir<Action>("Handlers/Actions", (data) => {
            if (!data.execute || !data.name) return;

            client.on(data.name as any, (...args) => data.execute(...args, client));
        }).reading;
        Logger.log(`[Shard ${client.ID}] has initialize actions`);
    };


    /**
     * @description Отправляем команды в applicationCommands
     * @param token {string} Токен бота
     * @param commands {WatKLOK["commands"]} Команды бота
     * @param UserID {string} ID бота в Discord
     */
    private pushApplicationCommands = (token: string, commands: WatKLOK["commands"], UserID: string) => {
        const rest = new REST().setToken(token);

        //Загружаем в Discord API SlashCommands
        (async () => {
            try {
                const PublicCommands = commands.filter((command) => !command.isOwner).toJSON();
                const OwnerCommands = commands.filter((command) => command.isOwner).toJSON();

                //Загружаем все команды
                const PublicData: any = await rest.put(Routes.applicationCommands(UserID), {body: PublicCommands});
                const OwnerData: any = await rest.put(Routes.applicationGuildCommands(UserID, env.get("bot.owner.server")), {body: OwnerCommands});

                if (env.get("debug.client")) Logger.debug(`[SlashCommands]: [Load]: Public: ${PublicData.length} | Owner: ${OwnerData.length}`);
            } catch (error) { Logger.error(error); }
        })();
    };


    /**
     * @description Загружаем запросы для музыки
     */
    private loadAPIs = (ShardID: number) => {
        const Platforms = APIs.Platforms, Auths = APIs.Auths, Audios = APIs.Audios;

        //Загружаем директорию с запросами
        readdirSync(`src/Handlers/APIs`).forEach((dir: string) => {
            const platform = Platforms.find((platform) => platform.name.toLowerCase() === dir.toLowerCase());

            //Если нет платформы в базе, то не загружаем ее
            if (!platform) return;

            //Надо ли авторизоваться на этой платформе
            if (platform.auth) {
                //Если нет данных, то откидываем платформу
                if (!env.get(`bot.token.${platform.name.toLowerCase()}`)) Auths.push(platform.name);
            }

            //Поддерживает ли платформа получение аудио
            if (!platform.audio) Audios.push(platform.name);

            //Загружаем запросы для платформы
            new initDataDir<API.list | API.array | API.track>(`Handlers/APIs/${dir}`, (data) => {
                Platforms[Platforms.indexOf(platform)].requests.unshift(data);
            }).reading;
        });

        Logger.log(`[Shard ${ShardID}] has initialize APIs`);
    };
}

if (process.argv.includes("--sharder")) new init().ShardManager();
else new init().Shard();