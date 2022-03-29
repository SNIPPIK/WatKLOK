import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    DiscordAPIError,
    Guild,
    Message
} from "discord.js";
import {EmbedConstructor, wClient, wMessage} from "../../Core/Utils/TypesHelper";
import cfg from "../../db/Config.json";
import {Colors} from "../../Core/Utils/Colors";

export class guildCreate {
    public readonly name: string = 'guildCreate';
    public readonly enable: boolean = true;

    public run = async (guild: Guild, f2: null, client: wClient): Promise<void | NodeJS.Timeout> | null => {
        const Buttons = {
            MyUrl: new ButtonBuilder().setURL(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot+applications.commands`).setEmoji({name: '🔗'}).setLabel('Invite').setStyle(ButtonStyle.Link),
            ServerUrl: new ButtonBuilder().setURL(cfg.Bot.DiscordServer).setEmoji({name: '🛡'}).setLabel('Help server').setStyle(ButtonStyle.Link),
            Git: new ButtonBuilder().setURL('https://github.com/SNIPPIK/WatKLOK-BOT').setEmoji({name: "🗂"}).setLabel("GitHub").setStyle(ButtonStyle.Link)
        };
        const RunButt = new ActionRowBuilder().addComponents(Buttons.MyUrl, Buttons.ServerUrl);

        // @ts-ignore
        return guild.systemChannel ? guild.systemChannel.send({ embeds: [await ConstructEmbed(guild, client) as any], components: [RunButt]}).then(async (msg: wMessage | Message) => setTimeout(async () => msg.delete().catch(async (err: DiscordAPIError) => console.log(`[Discord Message]: [guildCreate]: [Delete]: ${err}`)), 60e3)).catch(async (e: DiscordAPIError) => console.log(`[Discord event]: [guildCreate]: ${e}`)) : null;
    };
}

async function ConstructEmbed(guild: Guild, client: wClient): Promise<EmbedConstructor> {
    return {
        color: Colors.GREEN,
        author: {
            name: guild.name,
            iconURL: guild.iconURL({size: 512})
        },
        description: `**Спасибо что добавили меня 😉**\nМоя основная задача музыка, официальные платформы которые я поддерживаю (YouTube, Spotify, VK)\nЯ полностью бесплатный.\nНасчет ошибок и багов писать в лс SNIPPIK#4178.\nДанное сообщение будет удалено через 1 мин.\nРестарт каждые 24 часа.`,
        thumbnail: { url: guild.bannerURL({size: 4096})},
        timestamp: new Date()
    }
}