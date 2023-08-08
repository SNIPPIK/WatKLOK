import {Events} from "discord.js";
import { Action } from "@Action";
import { Logger } from "@Logger";

export default class extends Action {
    public readonly name = Events.ShardReconnecting;
    public readonly run = (ShardID: string): void => Logger.log(`[Shard ${ShardID}] reconnecting...`);
}