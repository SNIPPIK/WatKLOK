import {Events} from "discord.js";
import { Event } from "@Event";
import { Logger } from "@Logger";

export default class extends Event {
    public readonly name = Events.ShardReconnecting;
    public readonly execute = (ShardID: string): void => Logger.warn(`[Shard ${ShardID}] reconnecting...`);
}