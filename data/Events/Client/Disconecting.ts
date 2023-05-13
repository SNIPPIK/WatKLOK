import { Logger } from "@Logger";

//Client imports
import { Event } from "@Client/Event";
import {WatKLOK} from "@Client";

export class shardDisconnect extends Event<null, null> {
    public readonly name: string = "shardDisconnect";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null, client: WatKLOK): void => Logger.log(`[${client.shardID}]: [WS]: Disconnecting...`);
}