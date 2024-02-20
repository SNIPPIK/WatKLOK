import {ArrayQueue} from "@watklok/player/queue/Queue";
import {Assign, Event, ResponseAPI} from "@handler";
import {Song} from "@watklok/player/queue/Song";
import {db} from "@Client/db";
import {env} from "@env";

export default class extends Assign<Event<"collection/api">> {
    public constructor() {
        super({
            name: "collection/api",
            type: "player",
            execute: (message, voice, argument): void => {
                const platform = new ResponseAPI(argument[0] ?? argument[1]), name = platform.platform;
                const event = db.queue.events, collection = db.queue;

                if (platform.block) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}**\n\nРазработчик заблокировал доступ к этой платформе!\nВозможно из-за ошибки или блокировки со стороны сервера!`));
                else if (platform.auth) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}**\n\nНет данных для авторизации, запрос не может быть выполнен!`));
                else if (!argument[1].match(platform.filter) && argument[1].startsWith("http")) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}**\n\nЭтот запрос не относится к этой платформе!`));

                const api = platform.find(argument[1]);

                if (!api || !api?.name) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}**\n\nУ меня нет поддержки этого запроса!`));
                else if (!api) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}.${api.name}**\n\nУ меня нет поддержки для выполнения этого запроса!`));

                //Отправляем сообщение о том что запрос производится
                event.emit("collection/error", message, `⚠️ **Warning** | **${name}.${api.name}**\n\n${env.get("loading.emoji")} Ожидание ответа от сервера...\n${platform.audio ? "Эта платформа не может выдать исходный файл музыки! Поиск трека!" : ""}`, "Yellow");

                api.callback(argument[1]).then((item) => {
                    if (!item) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}.${api.name}**\n\n**❯** Данные не были получены!`));
                    else if (item instanceof Error) return void (event.emit("collection/error", message, `⚠️ **Warning** | **${name}.${api.name}**\n\n**❯** При получении данных была получена ошибка!`));
                    else if (item instanceof Array) return void (event.emit("message/search", item, platform.platform, message));

                    let queue = collection.get(message.guild.id);
                    if (!queue) {
                        collection.set(new ArrayQueue({message, voice}));
                        queue = collection.get(message.guild.id);

                        setImmediate(() => queue.player.play(queue.songs.song));
                    }

                    if (item instanceof Song && queue.songs.size >= 1) event.emit("message/push", queue, item);
                    else if ("items" in item) event.emit("message/push", message, item);

                    //Добавляем треки в очередь
                    for (const track of (item["items"] ?? [item])) {
                        track.requester = message.author;
                        queue.songs.push(track);
                    }
                }).catch((err: Error) => { //Отправляем сообщение об ошибке
                    event.emit("collection/error", message, `⛔️ **Error** | **${name}.${api.name}**\n\n**❯** **${err.message}**`);
                });
            }
        });
    };
};