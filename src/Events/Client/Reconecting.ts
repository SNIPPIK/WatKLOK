import { Event } from "@Structures/Handlers";
import { Logger } from "@Logger";

export class shardReconnecting extends Event<null, null> {
    public readonly name: string = "shardReconnecting";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null): void => Logger.log("[WS]: Reconnecting...");
}