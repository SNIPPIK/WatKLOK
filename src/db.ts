import {Command, Commands, Event, initDataDir} from "@handler";
import {db_Music} from "@Client/Audio";
import {SuperClient} from "@Client";
import {Routes} from "discord.js";
import {env, Logger} from "@env";
import {API} from "@handler/APIs";

/**
 * @author SNIPPIK
 * @class QuickDB
 * @description База данных бота
 */
export const db = new class QuickDB {
    /**
     * @description Получаем команды
     * @return Commands
     * @public
     */
    public get commands() {
        return this._commands;
    };

    private readonly _commands = new Commands();


    /**
     * @description Выдаем класс Music
     * @return Music
     * @public
     */
    public get music() {
        return this._music;
    };

    private readonly _music = new db_Music();


    /**
     * @description Загружаем команды для бота в Discord
     * @param client {SuperClient} Класс клиента
     * @return Promise<true>
     * @public
     */
    public registerApplicationCommands = (client: SuperClient): Promise<true> => {
        return new Promise<true>(async (resolve) => {
            //Загружаем все команды
            const PublicData: any = await client.rest.put(Routes.applicationCommands(client.user.id), {body: this.commands.public});
            const OwnerData: any = await client.rest.put(Routes["applicationGuildCommands"](client.user.id, env.get("owner.server")), {body: this.commands.owner});

            Logger.debug(`[Shard ${client.ID}]: [SlashCommands]: [Upload]: Public: ${PublicData.length} | Owner: ${OwnerData.length}`);
            return resolve(true);
        });
    };

    /**
     * @description Загружаем Imports
     * @param client {SuperClient} Класс клиента
     * @return Promise<true>
     * @public
     */
    public initHandler = (client: SuperClient): Promise<true> => {
        return new Promise<true>((resolve) => {
            const dirs = ["Handler/APIs", "Handler/Commands", "Handler/Events"];

            for (let i = 0; i < dirs.length; i++) {
                const dir = dirs[i];

                try {
                    new initDataDir<API.load | Command | Event<unknown>>(dir, (data) => {
                        if (data instanceof Command) this._commands.set(data.name, data);
                        else if (data instanceof Event) client.on(data.name as any, (...args: any[]) => data.execute(client, ...args));
                        else {
                            //Надо ли авторизоваться на этой платформе
                            if (data.auth) {
                                //Если нет данных, то откидываем платформу
                                if (!env.get(`token.${data.name.toLowerCase()}`)) this.music.platforms.authorization.push(data.name);
                            }

                            //Поддерживает ли платформа получение аудио
                            if (!data.audio) this.music.platforms.audio.push(data.name);

                            this.music.platforms.supported.push(data);
                        }
                    });
                    Logger.log(`[Shard ${client.ID}] has initialize ${dir}`);
                } catch (err) {
                    Logger.error(err);
                    Logger.warn(`[Shard ${client.ID}] Fail loading ${dir}`);
                }
            }

            return resolve(true);
        });
    };
}