import { Event } from "@Client/Event";
import { Logger } from "@Logger";
import {WatKLOK} from "../../../resource/Structures/Classes/Client";

export class shardDisconnect extends Event<null, null> {
    public readonly name: string = "shardDisconnect";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null, client: WatKLOK): void => Logger.log(`[${client.shardID}]: [WS]: Disconnecting...`);
}