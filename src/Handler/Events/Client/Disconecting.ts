import {consoleTime} from "../../../Core/Client/Client";
import {Event} from "../../../Structures/Handle/Event";

export class shardDisconnect extends Event<null, null> {
    public readonly name: string = "shardDisconnect";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null): void => void consoleTime("[WS]: Disconnecting...");
}