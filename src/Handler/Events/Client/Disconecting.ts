import {WatKLOK} from "../../../Core/Client/Client";
import {Event} from "../../../Structures/Event";

export class shardDisconnect extends Event<null, null> {
    public readonly name: string = "shardDisconnect";
    public readonly isEnable: boolean = true;

    public readonly run = (_: null, __: null, client: WatKLOK): void => void client.console("[WS]: Disconnecting...");
}