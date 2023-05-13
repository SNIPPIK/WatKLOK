import { Logger } from "@Logger";

//Client imports
import { Event } from "@Client/Event";
import {WatKLOK} from "@Client";

export class shardReconnecting extends Event<null, null> {
    public readonly name: string = "shardReconnecting";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null, client: WatKLOK): void => Logger.log(`[${client.shardID}]: Reconnecting...`);
}