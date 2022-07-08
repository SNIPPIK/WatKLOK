import {
    ActivityType,
    Client,
    GuildMember,
    IntentsBitField,
    BaseInteraction,
    Message,
    MessageEditOptions,
    User,
    Options,
} from "discord.js";
import {FileSystemLoad} from "./FileSystem";
import {Channel, MessageChannel, sendType} from "./Utils/TypeHelper";
import {PlayerEmitter} from "./Player/execute";
import {Command} from "../Commands/Constructor";
import {Queue} from "./Player/Structures/Queue/Queue";
import {CollectionMap, Connections, MessageChannelSend, ConvertedText, ConsoleLog} from "./Utils/LiteUtils";

const keepOverLimit = (value: any): boolean => value.id !== value.client.user.id;

export class WatKLOK extends Client {
    public readonly commands = new CollectionMap<string, Command>();
    public readonly aliases = new CollectionMap<string, string>();
    public readonly queue = new CollectionMap<string, Queue>();
    public readonly cfg = require("../../DataBase/Config.json");

    public readonly Send = MessageChannelSend;
    public readonly ConvertedText = ConvertedText;
    public readonly console: (text: string) => NodeJS.Timeout;
    public readonly connections = Connections;
    public readonly player = new PlayerEmitter();

    public readonly ShardID: number | null;

    public constructor() {
        super({
            makeCache: Options.cacheWithLimits({
                BaseGuildEmojiManager: 0,       // guild.emojis
                GuildBanManager: 0,             // guild.bans
                GuildInviteManager: 0,          // guild.invites
                GuildStickerManager: 0,         // guild.stickers
                GuildScheduledEventManager: 0,  // guild.scheduledEvents
                PresenceManager: 0,             // guild.presences
                StageInstanceManager: 0,        // guild.stageInstances
                ThreadManager: 0,               // channel.threads
                ThreadMemberManager: 0,         // threadchannel.members

                UserManager: { keepOverLimit },
                GuildMemberManager: { keepOverLimit },
                VoiceStateManager: { keepOverLimit },
                MessageManager: { keepOverLimit },
                ReactionManager: { keepOverLimit },
                ReactionUserManager: { keepOverLimit },
                GuildEmojiManager: { keepOverLimit }
            }),
            intents: (Object.keys(IntentsBitField.Flags)) as any,
            ws: {
                properties: {
                    browser: "Web" as "Discord iOS" | "Web"
                }
            },
            presence: {
                activities: [{
                    name: "music on youtube, spotify, soundcloud",
                    type: ActivityType.Listening
                }]
            }
        });
        this.ShardID = this.shard?.ids[0];
        this.console = (text: string) => {
            if (this.ShardID !== undefined) return ConsoleLog(`[ShardID: ${this.ShardID}] -> ` + text);
            return ConsoleLog(text);
        };
    };
}

// @ts-ignore
export interface ClientMessage extends Message {
    client: WatKLOK;
    // @ts-ignore
    edit(content: sendType | MessageEditOptions): Promise<ClientMessage>
    // @ts-ignore
    channel: {
        send(options: sendType): Promise<ClientMessage>
    } & Channel
}

// @ts-ignore
export interface ClientInteraction extends BaseInteraction {
    member: GuildMember;
    customId: string;
    commandName: string;
    commandId: string;
    author: User;
    options?: {
        _hoistedOptions: any[]
    }

    delete: () => void;
    deferReply: () => Promise<void>
    deleteReply: () => Promise<void>
}

const client = new WatKLOK();

client.login(client.cfg.Bot.token).then(() => {
    Promise.all([FileSystemLoad(client)]).catch(console.error);

    if (client.cfg.Bot.ignoreError) {
        process.on("uncaughtException", (err: Error): void | Promise<ClientMessage> => {
            console.error(err);
            if (err.toString() === "Error: connect ECONNREFUSED 127.0.0.1:443") return null;

            try {
                const channel = client.channels.cache.get(client.cfg.Channels.SendErrors) as MessageChannel
                if (channel) return channel.send(`${err.toString()}`);
                return null;
            } catch {/* Continue */}
        });
    }
});