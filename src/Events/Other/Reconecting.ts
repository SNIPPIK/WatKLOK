import {WatKLOK} from "../../Core/Client";

export default class shardReconnecting {
    public readonly name: string = "shardReconnecting";
    public readonly enable: boolean = true;

    public readonly run = (f1: null, f2: null, client: WatKLOK): void => void client.console("[WS]: Reconnecting...");
}