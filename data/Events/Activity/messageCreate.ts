import {MessageUtils} from "@db/Message";
import { Logger } from "@Logger";
import {env} from "@env";

//Client imports
import { ClientMessage, interactionCreate } from "@Client/Message";
import { Event } from "@Client/Event";


const { runCommand } = interactionCreate;
const prefix = env.get("bot.prefix");
const typing = env.get("bot.typing");

export class messageCreate extends Event<ClientMessage, null> {
    public readonly name = "messageCreate";
    public readonly isEnable = true;

    public readonly run = (message: ClientMessage) => {
        //Игнорируем ботов
        //Если в сообщении нет префикса то игнорируем
        if (message?.author?.bot || !message.content?.startsWith(prefix)) return;

        try {
            //Удаляем сообщение пользователя
            setTimeout(() => MessageUtils.delete = {message, time: 15e3});

            const args = (message as ClientMessage).content.split(" ")?.slice(1)?.filter((string) => string !== "");
            const commandName = (message as ClientMessage).content?.split(" ")[0]?.slice(prefix.length)?.toLowerCase();
            const command = message.client.commands.get(commandName) ?? message.client.commands.find(cmd => cmd.aliases.includes(commandName));

            //Заставляем бота делать вид, что он что-то печатает
            if (typing) return message.channel.sendTyping().then(() => runCommand(message, command, args));
            return runCommand(message, command, args);
        } catch (e) {
            if (e.message === "Missing Access") Logger.error(`[ChannelID: ${message.channel.id}]: ${e.message}`);
        }
    };
}