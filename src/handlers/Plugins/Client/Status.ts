import {Constructor, Handler} from "@handler";
import {ActivityType} from "discord.js";

/**
 * @author SNIPPIK
 * @description Смена статуса
 */
class StatusPlugin extends Constructor.Assign<Handler.Plugin> {
    public constructor() {
        super({
            start: (options) => {
                //Создаем интервал в 5 мин для смены статуса бота
                setInterval(() => {
                    options.client.user.setPresence({
                        activities: [
                            {
                                name: "музыку",
                                type: ActivityType.Listening //Слушает <name>
                            }
                        ],
                        status: "online" //Статус бота
                    })
                }, 15e3);
            }
        });
    }
}

export default Object.values({StatusPlugin});