import {Client} from "@lib/discord";
import {Handler} from "@handler";
import {env, Logger} from "@env";
import {db} from "@lib/db";

export class Database_Commands<T extends Handler.Command> extends Array<T> {
    public subCommands = 0;

    /**
     * @description Ищем в array подходящий тип
     * @param names - Имя или имена для поиска
     * @public
     */
    public get = (names: string | string[]): T => {
        for (const cmd of this) {
            if (names instanceof Array) {
                for (const name of names) {
                    if (cmd.data.name === name || cmd.data.name === name) return cmd;
                }
            } else if (cmd.data.name === names) return cmd;
        }

        return null;
    };

    /**
     * @description Команды для разработчика
     * @return Command[]
     * @public
     */
    public get owner() { return this.filter((command) => command.owner); };

    /**
     * @description Команды доступные для всех
     * @return Command[]
     * @public
     */
    public get public() { return this.filter((command) => !command.owner); };

    /**
     * @description Загружаем команды для бота в Discord
     * @param client {Client} Класс клиента
     * @return Promise<true>
     * @public
     */
    public register = (client: Client): Promise<boolean> => {
        return new Promise<true>((resolve) => {
            const guildID = env.get("owner.server"), guild = client.guilds.cache.get(guildID);

            for (const command of this) {
                if (command.afterLoad) command.data.options[0]["choices"] = db.commands.map((command) => {
                    return {
                        name: command.data.name,
                        name_localizations: command.data.name_localizations,
                        value: command.data.name
                    }
                });
            }

            // Загрузка глобальных команд
            client.application.commands.set(this.map((command) => command.data) as any)
                .then(() => Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands | ${this.public.length}] has load public commands`))
                .catch(console.error);

            // Загрузка приватных команд
            if (guild) guild.commands.set(this.owner.map((command) => command.data) as any)
                .then(() => Logger.log("DEBUG", `[Shard ${client.ID}] [SlashCommands | ${this.owner.length}] has load private commands`))
                .catch(console.error);

            return resolve(true);
        });
    };
}