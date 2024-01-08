import {Event} from "@Client";
import {Logger} from "@src";

export default class unhandledRejection extends Event<any> {
    constructor() {
        super({
            name: "unhandledRejection",
            type: "process",
            execute: (_, reason: any) => {
                Logger.warn(reason);
            }
        });
    }
}