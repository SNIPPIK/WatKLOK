import {API, Constructor, handler} from "@handler";
import {Queue} from "@lib/player/queue/Queue";
import {Song} from "@lib/player/queue/Song";
import {Logger} from "@lib/discord";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @class onAPI
 * @event collection/api
 * @description Выполняется при запросе API
 */
class onAPI extends Constructor.Assign<handler.Event<"collection/api">> {
    public constructor() {
        super({
            name: "collection/api",
            type: "player",
            execute: (message, voice, argument): void => {
                const platform = new API.response(argument[0] as string), name = platform.platform;
                const event = db.queue.events, collection = db.queue;

                if (platform.block) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}**\n\nРазработчик заблокировал доступ к этой платформе!\nВозможно из-за ошибки или блокировки со стороны сервера!`));
                else if (platform.auth) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}**\n\nНет данных для авторизации, запрос не может быть выполнен!`));
                else if (typeof argument[1] === "string") {
                    if (!argument[1].match(platform.filter) && argument[1].startsWith("http")) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}**\n\nЭтот запрос не относится к этой платформе!`));
                }

                const api = platform.find(typeof argument[1] !== "string" ? argument[1].url : argument[1]);

                if (!api || !api?.name) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}**\n\nУ меня нет поддержки этого запроса!`));
                else if (!api) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}.${api.name}**\n\nУ меня нет поддержки для выполнения этого запроса!`));

                //Отправляем сообщение о том что запрос производится
                event.emit("collection/error", message, `⚠️ **Warning** | **${name}.${api.name}**\n\n${env.get("loading.emoji")} Ожидание ответа от сервера...\n${platform.audio ? "Эта платформа не может выдать исходный файл музыки! Поиск трека!" : ""}`, true, "Yellow");

                api.callback(argument[1] as any).then((item): void => {
                    //Если нет данных или была получена ошибка
                    if (!item || item instanceof Error) {
                        event.emit("collection/error", message, `⚠️ **Warning** | **${name}.${api.name}**\n\n**❯** Данные не были получены!`);
                        return;
                    }
                    //Если был указан поиск
                    else if (item instanceof Array) {
                        event.emit("message/search", item, platform.platform, message);
                        return;
                    }

                    let queue = collection.get(message.guild.id);
                    if (!queue) {
                        const item = new Queue.Music({message, voice});
                        queue = item;

                        collection.set(message.guild.id, item, collection.runQueue);
                        setImmediate(() => queue.player.play(queue.songs.song));
                    }

                    if (item instanceof Song && queue.songs.size >= 1) event.emit("message/push", queue, item);
                    else if ("items" in item) event.emit("message/push", message, item);

                    //Добавляем треки в очередь
                    for (const track of (item["items"] ?? [item]) as Song[]) {
                        track.requester = message.author;
                        queue.songs.push(track);
                    }
                }).catch((err: Error) => { //Отправляем сообщение об ошибке
                    event.emit("collection/error", message, `⛔️ **Error** | **${name}.${api.name}**\n\n**❯** **${err.message}**`, false);
                });
            }
        });
    };
}

/**
 * @class onError
 * @event collection/error
 * @description Выполнятся при возникновении ошибки в collection
 */
class onError extends Constructor.Assign<handler.Event<"collection/error">> {
    public constructor() {
        super({
            name: "collection/error",
            type: "player",
            execute: (message, error, replied = true,  color = "DarkRed") => {
                try {
                    new Constructor.message({message, time: 7e3, content: error, color, replied});
                } catch (e) {
                    Logger.log("WARN", `[collection/error] ${e}]`);
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({onError, onAPI});