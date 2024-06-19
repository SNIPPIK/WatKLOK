import {Constructor, Handler} from "@handler";
import {Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {MessageBuilder} from "@lib/discord/utils/MessageBuilder";

/**
 * @class Command_Contact
 * @command contact
 * @description Связь с разработчиком | WARNING - изменение данных в этой команде запрещено лицензией
 * @license https://github.com/SNIPPIK/WatKLOK/blob/nightly/LICENSE.md
 */
class Command_Contact extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("contact")
                .setDescription("Связь с разработчиком!")
                .json,
            execute: ({message}) => {
                const {client} = message;
                const Latency = (Date.now() - message.createdTimestamp < 0 ? Math.random() * 78 : Date.now() - message.createdTimestamp).toFixed(0);
                const WS = (client.ws.ping < 0 ? Math.random() * 78 : client.ws.ping).toFixed(0);

                return new MessageBuilder().addEmbeds([
                    {
                        timestamp: new Date(), color: Colors.Green,
                        thumbnail: {url: client.user.displayAvatarURL()},
                        title: "Раздел для связи с разработчиком!",
                        footer: {
                            text: `Latency - ${Latency} | Api - ${WS} | Uptime: ${(client.uptime / 1000).duration()}`,
                            iconURL: client.user.displayAvatarURL()
                        }
                    }
                ])
                    .addComponents([{
                        type: 1, components: [
                            {type: 2, label: "SNIPPIK", url: "https://github.com/SNIPPIK", style: 5},
                            {type: 2, label: "GITHUB", url: "https://github.com/SNIPPIK/WatKLOK", style: 5},
                            {type: 2, label: "Discord", url: "https://discord.gg/qMf2Sv3", style: 5},
                        ]
                    }])
                    .setTime(30e3);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Contact});