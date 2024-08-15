import {LightMessageBuilder} from "@lib/discord/utils/MessageBuilder";
import {Queue} from "@lib/voice/player/queue/Queue";
import {API, Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {Logger} from "@env";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Система ивентов
 */
const event = db.audio.queue.events;

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
                const platform = new API.response(argument[0] as string);

                if (platform.block) return void (event.emit("collection/error", message, locale._(message.locale,"api.blocked", [platform.platform])));
                else if (platform.auth) return void (event.emit("collection/error", message, locale._(message.locale,"api.auth", [platform.platform])));
                else if (typeof argument[1] === "string" && !argument[1].match(platform.filter) && argument[1].startsWith("http"))
                    return void (event.emit("collection/error", message, locale._(message.locale,"api.type.fail", [platform.platform])));

                const api = platform.find(typeof argument[1] !== "string" ? argument[1].url : argument[1]);

                if (!api || !api?.name) return void (event.emit("collection/error", message, locale._(message.locale,"api.type.fail", [platform.platform])));
                else if (!api) return void (event.emit("collection/error", message, locale._(message.locale,"api.callback.null", [platform.platform, api.name])));

                // Отправляем сообщение о том что запрос производится
                const audio = platform.audio ? locale._(message.locale,"api.audio.null") : "";
                event.emit("collection/error", message, locale._(message.locale,"api.wait", [platform.platform, api.name, audio]), false, "Yellow");

                // Если ответ не был получен от сервера
                const timeout = setTimeout(() => {
                    event.emit("collection/error", message, locale._(message.locale,"api.wait.fail", [platform.platform, api.name]));
                }, 10e3);

                // Получаем данные в системе API
                api.callback(argument[1] as string, { limit: db.api.limits[api.name], audio: true }).then((item) => {
                    clearTimeout(timeout);

                    // Если нет данных или была получена ошибка
                    if (item instanceof Error) {
                        event.emit("collection/error", message, locale._(message.locale,"api.fail", [platform.platform, api.name]));
                        return;
                    }

                    // Если был указан поиск
                    else if (item instanceof Array) {
                        event.emit("message/search", item, platform.platform, message);
                        return;
                    }

                    // Запускаем проигрывание треков
                    return Queue.startUp(message, voice, item);
                }).catch((err: Error) => { // Отправляем сообщение об ошибке
                    console.log(err);

                    clearTimeout(timeout);
                    event.emit("collection/error", message, `**${platform.platform}.${api.name}**\n\n**❯** **${err.message}**`, true);
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
