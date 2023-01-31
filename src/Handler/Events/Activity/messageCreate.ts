import {ClientMessage, interactionCreate, UtilsMsg} from "./interactionCreate";
import {Event} from "@Structures/Handle/Event";
import {Bot} from "@db/Config.json";

const {runCommand} = interactionCreate;
export class messageCreate extends Event<ClientMessage, null> {
    public readonly name = "messageCreate";
    public readonly isEnable = true;

    public readonly run = (message: ClientMessage) => {
        //Игнорируем ботов
        //Если в сообщении нет префикса то игнорируем
        if (message?.author?.bot || !message.content?.startsWith(Bot.prefix)) return;

        //Заставляем бота делать вид что он что-то печатает
        if (Bot.TypingMessage) message.channel.sendTyping().catch((e) => console.warn(e.message));

        //Удаляем сообщение пользователя
        setTimeout(() => UtilsMsg.deleteMessage(message), 15e3);

        const args = (message as ClientMessage).content.split(" ").slice(1);
        const commandName = (message as ClientMessage).content?.split(" ")[0]?.slice(Bot.prefix.length)?.toLowerCase();
        const command = message.client.commands.get(commandName) ?? message.client.commands.find(cmd => cmd.aliases.includes(commandName));

        return runCommand(message, command, args);
    };
}