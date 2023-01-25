import {ClientMessage} from "@Client/interactionCreate";
import {Command} from "@Structures/Handle/Command";
import {httpsClient} from "@httpsClient";

export class Eval extends Command {
    public constructor() {
        super({
            name: "test",

            isEnable: true,
            isOwner: true,
            isSlash: false,
            isGuild: false
        });
    };

    public readonly run = (message: ClientMessage, args: string[]): any => {
        httpsClient.parseBody("https://soundcloud.com/officialvenbee/messy-in-heaven").catch(console.log);
    };
}