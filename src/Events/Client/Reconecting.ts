import { Event } from "@Structures/Handlers";
import { Logger } from "@Logger";
import {WatKLOK} from "@Client";

export class shardReconnecting extends Event<null, null> {
    public readonly name: string = "shardReconnecting";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null, client: WatKLOK): void => Logger.log(`[${client.ShardID}]: Reconnecting...`);
}