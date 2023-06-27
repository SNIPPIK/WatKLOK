import {Collection, REST, Routes} from "discord.js";

//Client
import {WatKLOK} from "@Client";
import {Command} from "@Client/Command";
import {Action} from "@Client/Action"
import {env, initDataDir} from "@Client/Fs";

//Utils
import {Logger} from "@Utils/Logger";

//APIs
import {Platform} from "@APIs";

const commands = new Collection<string, Command>();

export const db = new class {
    /**
     * @description Получаем Collection<Command>
     */
    public get commands() { return commands; };


    /**
     * @description Загружаем команды
     * @param dir {string} Директория с командами
     */
    public set initCommands(dir: string) {
        new initDataDir<Command>(dir, (file, data) => {
            commands.set(data.name, data);
        }).reading();
    };


    /**
     * @description Загружаем ивенты
     * @param options {dir: string, on: WatKLOK["on"]}
     */
    public set initActions(options: {dir: string, client: WatKLOK}) {
        new initDataDir<Action>(options.dir, (file, data) => {
            options.client.on(data.name as any, (...args) => data.run(...args, options.client));
        }).reading();
    };


    /**
     * @description Загружаем SlashCommands в Discord
     * @param options {token: string, userID: string}
     */
    public set initSlashCommands(options: {token: string, userID: string}) {
        const rest = new REST().setToken(options.token);

        (async () => {
            try {
                const PublicCommands = commands.filter((command) => !command.isOwner).toJSON();
                const OwnerCommands = commands.filter((command) => command.isOwner).toJSON();

                //Загружаем все команды
                const PublicData: any = await rest.put(Routes.applicationCommands(options.userID), {body: PublicCommands});
                const OwnerData: any = await rest.put(Routes.applicationGuildCommands(options.userID, env.get("bot.owner.server")), {body: OwnerCommands});

                if (env.get("debug.client")) Logger.debug(`SlashCommands: Load: Public: ${PublicData.length} | Owner: ${OwnerData.length}`);
            } catch (error) {
                Logger.error(error);
            }
        })();
    };


    /**
     * @description Загружаем запросы
     */
    public initPlatforms = () => { Platform.init; };
}