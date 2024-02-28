import {MessageConstructor} from "@Client/MessageConstructor";
import {Assign, Event} from "@handler";
import {Logger} from "@Client";

export default class extends Assign<Event<"collection/error">> {
    public constructor() {
        super({
            name: "collection/error",
            type: "player",
            execute: (message, error, color = "DarkRed") => {
                try {
                    new MessageConstructor({message, time: 7e3, content: error, color});
                } catch (e) {
                    Logger.log("WARN", `[collection/error] ${e}]`);
                }
            }
        });
    };
};