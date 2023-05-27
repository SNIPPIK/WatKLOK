import { MessageAction } from "@AudioPlayer/Message/Classes/Action";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Logger } from "@Logger";
import { env } from "@env";

const durationMessage = parseInt(env.get("music.player.message"));
const debug = env.get("debug.cycle");

export class MessageCycle {
    private readonly _messages: ClientMessage[] = [];
    private readonly time: number = durationMessage < 15 ? 15e3 : durationMessage * 1e3;
    private _timeout: NodeJS.Timeout = null;


    /**
     * @description Получаем сообщения, в которые можно обновить
     */
    private get messages() { return this._messages.filter(msg => !!msg.edit); };

    //====================== ====================== ====================== ======================

    /**
     * @description Добавляем сообщение в <Message[]>
     * @param message {message} Сообщение
     */
    public set push(message: ClientMessage) {
        const old = this._messages.find(msg => msg.guild.id === message.guild.id);

        //Если это-же сообщение есть в базе, то нечего не делаем
        if (old) this.remove = message;

        //Добавляем сообщение в базу
        this._messages.push(message)

        //Если в базе есть хоть одно сообщение, то запускаем таймер
        if (this._messages.length === 1 && !this._timeout) {
            if (debug) Logger.debug(`[Cycle]: [Messages]: Start cycle`);
            this.messageCycleStep;
        }
    };

    //====================== ====================== ====================== ======================

    /**
     * @description Удаляем сообщение из <Message[]>, так-же проверяем отключить ли таймер
     * @param message {ClientMessage} Сообщение
     */
    public set remove(message: ClientMessage) {
        const msg = this._messages.find(msg => msg.guild.id === message.guild.id); //Ищем сообщение е базе

        //Если его нет ничего не делаем
        if (!msg) return;

        //Если его возможно удалить, удаляем!
        if (msg.deletable) msg.delete().catch(() => undefined);

        const index = this._messages.indexOf(message);
        if (index != -1) this._messages.splice(index, 1);
    };

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

        this._timeout = setTimeout(() => this.messageCycleStep, this.time);
    };

    //====================== ====================== ====================== ======================

    /**
     * @description Обновляем сообщение
     * @param message {ClientMessage} Сообщение
     */
    private readonly editMessage = (message: ClientMessage): void => {
        const {client, guild} = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если очереди нет или нет трека в очереди, удаляем сообщение
        if (!queue || !queue?.song) {this.remove = message; return; }

        //Если у плеера статус при котором нельзя обновлять сообщение
        if (!queue.player.hasUpdate) return;

        const Action = new MessageAction<"toPlay">("toPlay");
        //Обновляем сообщение
        message.edit({embeds: [new Action.embed(queue).toJson], components: message.components}).catch((e) => {
            if (e.message === "Unknown Message") this.remove = message;
            if (debug) Logger.log(`[Cycle]: [Messages]: [editMessage]: ${e.message}`);
        });
    };
}