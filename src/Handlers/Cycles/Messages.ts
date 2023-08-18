import {LifeCycle} from "../../Models/Abstracts/LifeCycle";
import {ClientMessage} from "@Client/Message";
import {PlayersEmbeds} from "@Embeds/Player";
import {Logger} from "@Logger";
import {env} from "@env";

const debug = env.get("debug.cycle");
/**
 *
 * @description Жизненный цикл всех сообщений о текущем треке
 *
 */
export class Cycles_Messages extends LifeCycle<ClientMessage> {
    protected readonly duration = parseInt(env.get("music.player.message")) * 1e3;
    protected readonly _filter = (message: ClientMessage) => !!message.edit;


    /**
     * @description Добавляем сообщение в <Message[]>
     * @param message {message} Сообщение
     */
    public set push(message: ClientMessage) {
        const old = this.find(msg => msg.guild.id === message.guild.id);

        //Если это-же сообщение есть в базе, то нечего не делаем
        if (old) this.remove = old;

        super.push = message;
    };


    /**
     * @description Удаляем элемент из очереди есть он там есть
     * @param message {message} Сообщение
     */
    public set remove(message: ClientMessage) {
        //Если его возможно удалить, удаляем!
        if (message && message.deletable) message.delete().catch(() => undefined);

        super.remove = message;
    };


    /**
     * @description Обновляем сообщение
     * @param message {ClientMessage} Сообщение
     */
    protected readonly _next = (message: ClientMessage) => {
        const {client, guild} = message;
        const queue = client.queue.get(guild.id);

        //Если очереди нет или нет трека в очереди, удаляем сообщение
        if (!queue || !queue?.song) {
            this.remove = message;
            return;
        }

        //Если у плеера статус при котором нельзя обновлять сообщение
        if (!queue.player.hasUpdate || queue.player.duration === 0) return;


        message.edit({embeds: [new PlayersEmbeds.toPlay(queue).toJson as any], components: message.components}).catch((e) => {
            if (e.message === "Unknown Message") this.remove = message;
            if (debug) Logger.debug(`[Cycle]: [${this.duration}]: [editMessage]: ${e.message}`);
        });
    };
}