import { Event } from "@Handler/FileSystem/Handle/Event";
import { Logger } from "@Structures/Logger";

export class shardDisconnect extends Event<null, null> {
    public readonly name: string = "shardDisconnect";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null): void => Logger.log("[WS]: Disconnecting...");
}