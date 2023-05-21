import { EmbedMessages } from "@AudioPlayer/Message/Embeds";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Logger } from "@Logger";
import {env} from "@env";

const durationMessage = parseInt(env.get("music.player.message"));
const debug = env.get("debug.cycle");

export class MessageCycle {
    private readonly _messages: ClientMessage[] = [];
    private readonly time: number = durationMessage < 20 ? 20e3 : durationMessage * 1e3;
    private _timeout: NodeJS.Timeout = null;

    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем сообщение в <Message[]>
     * @param message {message} Сообщение
     */
    public set push(message: ClientMessage) {
        const old = this._messages.find(msg => message.channelId === msg.channelId);

        //Если это-же сообщение есть в базе, то удаляем его
        if (old) this.remove = message;
        else {
            if (debug) Logger.debug(`[Cycle]: [Messages]: Start cycle`);

            //Если в базе есть хоть одно сообщение, то запускаем таймер
            setImmediate(() => {
                if (this._messages.length === 1 && !this._timeout) this.messageCycleStep;
            });
        }

        //Добавляем сообщение в базу
        this._messages.push(message);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем сообщение из <Message[]>, так-же проверяем отключить ли таймер
     * @param message {ClientMessage} Сообщение
     */
    public set remove(message: ClientMessage) {
        message.delete().catch(() => undefined);

        const index = this._messages.indexOf(message);
        if (index != -1) this._messages.splice(index, 1);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Получаем сообщения, в которые можно обновить
     */
    private get messages() { return this._messages.filter(msg => !!msg.edit); };
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненный цикл сообщений
     */
    private get messageCycleStep(): void {
        //Если в базе больше нет сообщений
        if (this._messages.length === 0) {
            if (debug) Logger.debug(`[Cycle]: [Messages]: Stop cycle`);

            //Если таймер еще работает, то удаляем его
            if (this._timeout) {
                clearTimeout(this._timeout);
                this._timeout = null;
            }
            return;
        }

        const messages = this.messages;

        //Постепенно обрабатываем сообщения
        while (messages.length > 0) {
            const message = messages.shift();

            //Обновляем сообщение
            this.editMessage(message);
        }

        setImmediate(() => {
            this._timeout = setTimeout(() => this.messageCycleStep, this.time);
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Обновляем сообщение
     * @param message {ClientMessage} Сообщение
     */
    private readonly editMessage = (message: ClientMessage): void => {
        const { client, guild } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если очереди нет или нет трека в очереди, удаляем сообщение
        if (!queue || !queue?.song) { this.remove = message; return; }

        //Если у плеера статус при котором нельзя обновлять сообщение
        if (!queue.player.hasUpdate) return;

        setImmediate((): void => {
            const CurrentPlayEmbed = EmbedMessages.toPlaying(queue);

            //Обновляем сообщение
            message.edit({ embeds: [CurrentPlayEmbed] }).catch((e) => {
                if (e.message === "Unknown Message") this.remove = message;
                Logger.log(`[Cycle]: [Messages]: [editMessage]: Not critical, ${e.message}`);
            });
        });
    };
}