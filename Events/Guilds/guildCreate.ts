import {ActionRow, ButtonComponent, ButtonStyle, DiscordAPIError, Embed, Guild, Message} from "discord.js";
import {wClient, wMessage} from "../../Core/Utils/TypesHelper";
import cfg from "../../db/Config.json";
import {Colors} from "../../Core/Utils/Colors";

export class guildCreate {
    public readonly name: string = 'guildCreate';
    public readonly enable: boolean = true;

    public run = async (guild: Guild, f2: null, client: wClient): Promise<void | NodeJS.Timeout> | null => {
        const Buttons = {
            // @ts-ignore
            MyUrl: new ButtonComponent().setURL(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot+applications.commands`).setEmoji({name: '🔗'}).setStyle(ButtonStyle.Link).setLabel('Invite'),
            // @ts-ignore
            ServerUrl: new ButtonComponent().setURL(cfg.Bot.DiscordServer).setEmoji({name: '🛡'}).setStyle(ButtonStyle.Link).setLabel('Help server'),
            // @ts-ignore
            Git: new ButtonComponent().setURL('https://github.com/SNIPPIK/WatKLOK-BOT').setEmoji({name: "🗂"}).setStyle(ButtonStyle.Link).setLabel("GitHub")
        };
        const RunButt = new ActionRow().addComponents(Buttons.MyUrl, Buttons.ServerUrl);

        return guild.systemChannel ? guild.systemChannel.send({ embeds: [new ConstructEmbed(guild)], components: [RunButt]}).then(async (msg: wMessage | Message) => setTimeout(async () => msg.delete().catch(async (err: DiscordAPIError) => console.log(`[Discord Message]: [guildCreate]: [Delete]: ${err}`)), 60e3)).catch(async (e: DiscordAPIError) => console.log(`[Discord event]: [guildCreate]: ${e}`)) : null;
    };
}

class ConstructEmbed extends Embed {
    public constructor(guild: Guild) {
        super({
            color: Colors.GREEN,
            author: {
                name: guild.name,
                iconURL: guild.iconURL({size: 512})
            },
            description: `**Спасибо что добавили меня 😉**\nМоя основная задача музыка, официальные платформы которые я поддерживаю (YouTube, Spotify, VK)\nПоддержка других языков дорабатывается.\nЯ полностью бесплатный\nНасчет ошибок и багов писать в GitHub.\nДанное сообщение будет удалено через 1 мин.`,
            thumbnail: { url: guild.bannerURL({size: 4096})},
            timestamp: new Date() as any
        });
    };
}