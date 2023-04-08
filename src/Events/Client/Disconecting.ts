import { Event } from "@Structures/Handlers";
import { Logger } from "@Logger";

export class shardDisconnect extends Event<null, null> {
    public readonly name: string = "shardDisconnect";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null): void => Logger.log("[WS]: Disconnecting...");
}