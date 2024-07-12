import {Constructor, Handler} from "@handler";
import {createServer} from "node:http"

/**
 * @author SNIPPIK
 * @description Смена статуса
 */
class AlivePlugin extends Constructor.Assign<Handler.Plugin> {
    public constructor() {
        super({
            start: (options) => {
                if (options.client.ID > 0) return;

                createServer((_, res) => {
                    res.write(`Worked`);
                    res.end();
                }).listen(27082);
            }
        });
    }
}

export default Object.values({AlivePlugin});