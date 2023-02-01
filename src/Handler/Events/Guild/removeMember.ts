import {ClientMessage} from "@Client/interactionCreate";
import {Event} from "@Structures/Handle/Event";
import {GuildMember} from "discord.js";
import {Channels} from "db/Config.json";
import {WatKLOK} from "@Client/Client";

export class guildMemberRemove extends Event<GuildMember, null> {
    public readonly name: string = "guildMemberRemove";
    public readonly isEnable: boolean = true;

    public readonly run = (member: GuildMember, f2: null, client: WatKLOK): any => {
        const channel = client.channels.cache.get(Channels.removeUser) as ClientMessage["channel"];

        if (channel) channel.send({content: `Нас покинул: ${member.user.tag}`}).catch(() => null);
    };
}