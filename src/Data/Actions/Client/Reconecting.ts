import { Logger } from "@Utils/Logger";
import {Events} from "discord.js";

//Client imports
import { Action } from "@Client/Action";

export default class extends Action {
    public readonly name = Events.ShardReconnecting;
    public readonly run = (ShardID: string): void => Logger.log(`[${ShardID}]: Reconnecting...`);
}