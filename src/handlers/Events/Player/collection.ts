import {LightMessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {API, Constructor, Handler} from "@handler";
import {Queue} from "@lib/voice/player/queue/Queue";
import {Song} from "@lib/voice/player/queue/Song";
import {locale} from "@lib/locale";
import {Logger} from "@env";
import {db} from "@lib/db";

/**
 * @class onAPI
 * @event collection/api
 * @description Выполняется при запросе API
 */
class onAPI extends Constructor.Assign<Handler.Event<"collection/api">> {
    public constructor() {
        super({
            name: "collection/api",
            type: "player",
            execute: (message, voice, argument) => {
                const platform = new API.response(argument[0] as string), name = platform.platform;
                const event = db.audio.queue.events, collection = db.audio.queue;

                if (platform.block) return void (event.emit("collection/error", message, locale._(message.locale,"api.blocked", [name])));
                else if (platform.auth) return void (event.emit("collection/error", message, locale._(message.locale,"api.auth", [name])));
                else if (typeof argument[1] === "string" && !argument[1].match(platform.filter) && argument[1].startsWith("http"))
                    return void (event.emit("collection/error", message, locale._(message.locale,"api.type.fail", [name])));

                const api = platform.find(typeof argument[1] !== "string" ? argument[1].url : argument[1]);

                if (!api || !api?.name) return void (event.emit("collection/error", message, locale._(message.locale,"api.type.fail", [name])));
                else if (!api) return void (event.emit("collection/error", message, locale._(message.locale,"api.callback.null", [name, api.name])));

                //Отправляем сообщение о том что запрос производится
                const audio = platform.audio ? locale._(message.locale,"api.audio.null") : "";
                event.emit("collection/error", message, locale._(message.locale,"api.wait", [name, api.name, audio]), false, "Yellow");

                api.callback(argument[1] as string, {
                        audio: api.name === "track",
                        limit: db.api.limits[api.name]
                    }
                ).then((item) => {
                    //Если нет данных или была получена ошибка
                    if (item instanceof Error) {
                        event.emit("collection/error", message, locale._(message.locale,"api.fail", [name, api.name]));
                        return;
                    }

                    //Если был указан поиск
                    else if (item instanceof Array) {
                        event.emit("message/search", item, platform.platform, message);
                        return;
                    }

                    //Запускаем проигрывание треков
                    let queue = collection.get(message.guild.id);
                    if (!queue) {
                        const item = new Queue.Music({message, voice});
                        queue = item;

                        collection.set(message.guild.id, item, collection.runQueue);
                        setImmediate(() => queue.player.play(queue.songs.song));
                    }

                    //Отправляем сообщение о том что было добавлено
                    if (item instanceof Song && queue.songs.size >= 1) event.emit("message/push", queue, item);
                    else if ("items" in item) event.emit("message/push", message, item);

                    //Добавляем треки в очередь
                    for (const track of (item["items"] ?? [item]) as Song[]) {
                        track.requester = message.author;
                        queue.songs.push(track);
                    }
                }).catch((err: Error) => { //Отправляем сообщение об ошибке
                    event.emit("collection/error", message, `**${name}.${api.name}**\n\n**❯** **${err.message}**`, true);
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
class onError extends Constructor.Assign<Handler.Event<"collection/error">> {
    public constructor() {
        super({
            name: "collection/error",
            type: "player",
            execute: (message, error, replied = false, color = "DarkRed") => {
                try {
                    new LightMessageBuilder({
                        content: error, replied,
                        color, time: 7e3
                    }).send = message as any;
                } catch (err) {
                    Logger.log("WARN", `[collection/error] ${err}]`);
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
