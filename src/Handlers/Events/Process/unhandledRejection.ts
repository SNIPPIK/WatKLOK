import {Event} from "@handler";
import {Logger} from "@Client";

export default class unhandledRejection extends Event<any> {
    constructor() {
        super({
            name: "unhandledRejection",
            type: "process",
            execute: (_, reason: any) => {
                Logger.log("WARN", `[unhandledRejection]: ${reason}`);
            }
        });
    }
}