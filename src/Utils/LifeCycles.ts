import { EmbedMessages } from "@AudioPlayer/Message/Embeds";
import { AudioPlayer } from "@AudioPlayer/Audio/AudioPlayer";
import { Queue } from "@AudioPlayer/Queue/Queue";
import { ClientMessage } from "@Client/Message";
import { Music } from "@db/Config.json";
import { Logger } from "@Logger";

export class PlayerCycle {
    private readonly _players: AudioPlayer[] = [];
    private _timeout: NodeJS.Timeout = null;
    private time: number = 0;

    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем плеер в базу
     * @param player {AudioPlayer}
     */
    public set push(player: AudioPlayer) {
        if (this._players.includes(player)) return;
        this._players.push(player);

        //Запускаем систему
        if (this._players.length === 1) {
            this.time = Date.now() + Music.AudioPlayer.sendDuration;
            setImmediate(this.playerCycleStep);
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем плеер из базы
     * @param player {AudioPlayer}
     */
    public set remove(player: AudioPlayer) {
        const index = this._players.indexOf(player);
        if (index != -1) this._players.splice(index, 1);

        //Чистим систему
        if (this._players.length < 1) {
            if (this._timeout) clearTimeout(this._timeout);

            this.time = null;
            this._timeout = null;
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненный цикл плееров
     */
    private readonly playerCycleStep = (): void => {
        const players = this._players.filter((player) => player.hasPlayable);

        //Добавляем задержку, в размер пакета
        this.time += 19.999995;

        return this.sendPlayersPackets(players);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем пакеты
     * @param players {AudioPlayer[]} Плееры на которых играем музыка
     */
    private readonly sendPlayersPackets = (players: AudioPlayer[]): void => {
        const nextPlayer = players.shift();

        //Если нет больше плееров запускаем проверку заново
        if (!nextPlayer) {
            this._timeout = setTimeout(() => this.playerCycleStep(), this.time - Date.now());
            return;
        }

        //Отправляем пакеты
        nextPlayer["preparePacket"]();

        //Запускаем следующий плеер
        setImmediate(() => this.sendPlayersPackets(players));
    };
}

export class MessageCycle {
    private readonly _messages: ClientMessage[] = [];
    private readonly time: number = Music.AudioPlayer.updateMessage < 10 ? 15e3 : Music.AudioPlayer.updateMessage * 1e3;
    private _timeout: NodeJS.Timeout = null;

    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем сообщение в <Message[]>
     * @param message {message} Сообщение
     */
    public set push(message: ClientMessage) {
        if (this._messages.find(msg => message.channelId === msg.channelId)) return; //Если сообщение уже есть в базе, то ничего не делаем
        this._messages.push(message); //Добавляем сообщение в базу

        //Если в базе есть хоть одно сообщение, то запускаем таймер
        if (this._messages.length === 1) setImmediate(this.messageCycleStep);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем сообщение из <Message[]>, так-же проверяем отключить ли таймер
     * @param channelID {string} ID канала
     */
    public set remove(channelID: string) {
        const Find = this._messages.find(msg => msg.channelId === channelID); //Ищем сообщение е базе
        if (!Find) return; //Если его нет ничего не делаем

        if (Find.deletable) Find.delete().catch(() => undefined); //Если его возможно удалить, удаляем!

        const index = this._messages.indexOf(Find);
        if (index != -1) this._messages.splice(index, 1);

        //Если в базе больше нет сообщений
        if (this._messages.length === 0) {
            //Если таймер еще работает, то удаляем его
            if (this._timeout) {
                clearTimeout(this._timeout);

                this._timeout = null;
            }
        }
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Обновляем сообщение
     * @param message {ClientMessage} Сообщение
     */
    private readonly editMessage = (message: ClientMessage): void => {
        const { client, guild } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если очереди нет или сообщение нельзя отредактировать, то удаляем сообщение
        if (!queue || !queue?.song) {
            this.remove = message.channelId;
            return;
        }

        //Если у плеера статус при котором нельзя обновлять сообщение
        if (!queue.player.hasUpdate) return;

        setImmediate((): void => {
            const CurrentPlayEmbed = EmbedMessages.toPlaying(queue);

            //Обновляем сообщение
            message.edit({ embeds: [CurrentPlayEmbed] }).catch((e) => {
                if (e.message === "Unknown Message") this.remove = message.channelId;
                Logger.log(`[MessageEmitter]: [function: UpdateMessage]: ${e.message}`);
            });
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненный цикл сообщений
     */
    private readonly messageCycleStep = (): void => {
        const messages = this._messages.filter(msg => !!msg.edit);

        //Запускаем отправку сообщений
        this.sendMessage(messages);
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Обновляем сообщения
     * @param messages {ClientMessage[]} Сообщение которые надо обновлять
     */
    private readonly sendMessage = (messages: ClientMessage[]): void => {
        const message = messages.shift();

        //Если не больше сообщений, то через время начинаем заново
        if (!message) {
            this._timeout = setTimeout(this.messageCycleStep, this.time);
            return;
        }

        //Обновляем сообщение
        this.editMessage(message);

        //Продолжаем обновление
        setImmediate(() => this.sendMessage(messages));
    };
}