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
                if (options.client.ID > 0) return;

                setInterval(() => {
                    options.client.user.setPresence({
                        activities: [
                            {
                                name: `${options.client.guilds.cache.size} servers`,
                                type: ActivityType.Watching
                            }
                        ],
                        status: "online"
                    });
                }, 20e3);
            }
        });
    };
}

export default Object.values({StatusPlugin});