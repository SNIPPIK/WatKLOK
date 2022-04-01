import {Command} from "../Constructor";
import {ClientMessage} from "../../Core/Client";
import {EmbedConstructor} from "../../Core/Utils/TypeHelper";
import {Colors} from "../../Core/Utils/Colors";

export class CommandPing extends Command {
    public constructor() {
        super({
            name: "ping",
            description: "Проверка отклика сообщения",

            slash: true,
            enable: true
        })
    };

    public run = async (message: ClientMessage): Promise<void> => message.channel.send('Pinging...').then(async (m: ClientMessage): Promise<void> => {
        const EMBED: EmbedConstructor = {
            description: `Latency is **${Date.now() - message.createdTimestamp < 0 ? 2 : Date.now() - message.createdTimestamp}** ms\nAPI Latency is **${Math.round(message.client.ws.ping < 0 ? 2 : message.client.ws.ping)}** ms`,
            color: Colors.YELLOW
        }

        m.edit({embeds: [EMBED]}).then(async (msg: ClientMessage) => Command.DeleteMessage(msg, 12e3));
    }).catch(async (err: Error) => console.log(`[Discord Error]: [Send message]: ${err}`));
}