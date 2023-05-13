import { msgUtil } from "@db/Message";
import { Bot } from "@db/Config.json";
import { Logger } from "@Logger";

//Client imports
import { ClientMessage, interactionCreate } from "@Client/Message";
import { Event } from "@Client/Event";


const { runCommand } = interactionCreate;

export class messageCreate extends Event<ClientMessage, null> {
    public readonly name = "messageCreate";
    public readonly isEnable = true;

    public readonly run = (message: ClientMessage) => {
        //Игнорируем ботов
        //Если в сообщении нет префикса то игнорируем
        if (message?.author?.bot || !message.content?.startsWith(Bot.prefix)) return;

        try {
            //Удаляем сообщение пользователя
            setTimeout(() => msgUtil.deleteMessage(message), 15e3);

            const args = (message as ClientMessage).content.split(" ")?.slice(1)?.filter((string) => string !== "");
            const commandName = (message as ClientMessage).content?.split(" ")[0]?.slice(Bot.prefix.length)?.toLowerCase();
            const command = message.client.commands.get(commandName) ?? message.client.commands.find(cmd => cmd.aliases.includes(commandName));

            //Заставляем бота делать вид, что он что-то печатает
            if (Bot.TypingMessage) return message.channel.sendTyping().then(() => runCommand(message, command, args));
            return runCommand(message, command, args);
        } catch (e) {
            if (e.message === "Missing Access") Logger.error(`[ChannelID: ${message.channel.id}]: ${e.message}`);
        }
    };
}