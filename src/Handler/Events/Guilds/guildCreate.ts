import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, Guild, Message } from "discord.js";
import {WatKLOK} from "../../../Core/Client/Client";
import {EmbedConstructor} from "../Activity/Message";
import {Event} from "../../../Structures/Event";

const Buttons = () => {
    const Buttons = {
        OwnerServer: new ButtonBuilder().setURL("https://discord.gg/qMf2Sv3").setEmoji({name: "🛡"}).setLabel("My server").setStyle(ButtonStyle.Link),
        Git: new ButtonBuilder().setURL("https://github.com/SNIPPIK/WatKLOK").setEmoji({name: "🗂"}).setLabel("GitHub").setStyle(ButtonStyle.Link)
    };
    return new ActionRowBuilder().addComponents([Buttons.OwnerServer, Buttons.Git]);
}

export class guildCreate extends Event<Guild, null>{
    public readonly name: string = "guildCreate";
    public readonly enable: boolean = true;

    public readonly run = (guild: Guild, f2: null, client: WatKLOK): void | Promise<Message> => {
        if (!guild.systemChannel) return;

        const Embed: EmbedConstructor = {
            color: Colors.Blue,
            author: {name: client.user.username, iconURL: client.user.displayAvatarURL()},
            thumbnail: { url: guild.bannerURL({size: 4096})},
            timestamp: new Date(),
            description: `Превествую всех пользователей ${guild} сервера. Я просто музыкальный бот, спасибо что добавили меня к себе 🥰`,
        };

        setImmediate(() => {
            // @ts-ignore
            return guild.systemChannel.send({ embeds: [Embed], components: [Buttons()] }).catch(console.log);
        });
    };
}