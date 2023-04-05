import { EmbedMessages } from "@AudioPlayer/Structures/Messages/Embeds";
import { AudioPlayer } from "@Structures/AudioPlayer/Structures/Player";
import { Queue } from "@AudioPlayer/Structures/Queue";
import { ClientMessage } from "@Client/Message";
import { Music } from "@db/Config.json";
import { Logger } from "@Logger";

//База данных
const db = {
    // База с плеерами
    pls: [] as AudioPlayer[],
    //База с сообщениями
    msg: [] as ClientMessage[],
    //Общий таймер плееров
    pls_timeout: null as NodeJS.Timeout,
    //Общий таймер сообщений
    msg_timeout: null as NodeJS.Timeout,

    //Время, необходимо для правильной отправки пакетов
    time: 0 as number
};

//====================== ====================== ====================== ======================
//                                 -= Players functions =-                                 //
//====================== ====================== ====================== ======================
export namespace PlayerCycle {
    /**
     * @description Добавляем плеер в базу
     * @param player {AudioPlayer}
     * @requires {playerCycleStep}
     */
    export function toPush(player: AudioPlayer): void {
        if (db.pls.includes(player)) return;
        db.pls.push(player);

        //Запускаем систему
        if (db.pls.length === 1) {
            db.time = Date.now() + Music.AudioPlayer.sendDuration;
            setImmediate(playerCycleStep);
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем плеер из базы
     * @param player {AudioPlayer}
     */
    export function toRemove(player: AudioPlayer): void {
        const index = db.pls.indexOf(player);
        if (index != -1) db.pls.splice(index, 1);

        //Чистим систему
        if (db.pls.length < 1) {
            if (db.pls_timeout) clearTimeout(db.pls_timeout);

            db.time = null;
            db.pls_timeout = null;
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненный цикл плееров
     */
    function playerCycleStep(): void {
        const players = db.pls.filter((player) => player.hasPlayable);

        //Добавляем задержку, в размер пакета
        db.time += 19.999995;

        return sendPlayersPackets(players);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем пакеты
     * @param players {AudioPlayer[]} Плееры на которых играем музыка 
     */
    function sendPlayersPackets(players: AudioPlayer[]) {
        const nextPlayer = players.shift();

        //Если нет больше плееров запускаем проверку заново
        if (!nextPlayer) {
            db.pls_timeout = setTimeout(() => playerCycleStep(), db.time - Date.now());
            return;
        }

        //Отправляем пакеты
        nextPlayer["preparePacket"]();

        //Запускаем следующий плеер
        setImmediate(() => sendPlayersPackets(players));
    }
}


//====================== ====================== ====================== ======================
//                                -= Messages functions =-                                 //
//====================== ====================== ====================== ======================
export namespace MessageCycle {
    /**
     * @description Добавляем сообщение в <Message[]>
     * @param message {message} Сообщение
     * @requires {messageCycleStep}
     */
    export function toPush(message: ClientMessage): void {
        if (db.msg.find(msg => message.channelId === msg.channelId)) return; //Если сообщение уже есть в базе, то ничего не делаем
        db.msg.push(message); //Добавляем сообщение в базу

        //Если в базе есть хоть одно сообщение, то запускаем таймер
        if (db.msg.length === 1) setImmediate(messageCycleStep);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем сообщение из <Message[]>, так-же проверяем отключить ли таймер
     * @param ChannelID {string} ID канала
     * @requires {Message}
     */
    export function toRemove(ChannelID: string): void {
        const Find = db.msg.find(msg => msg.channelId === ChannelID); //Ищем сообщение е базе
        if (!Find) return; //Если его нет ничего не делаем

        if (Find.deletable) Find.delete().catch(() => undefined); //Если его возможно удалить, удаляем!

        const index = db.msg.indexOf(Find);
        if (index != -1) db.msg.splice(index, 1);

        //Если в базе больше нет сообщений
        if (db.msg.length === 0) {
            //Если таймер еще работает то удаляем его
            if (db.msg_timeout) {
                clearTimeout(db.msg_timeout);

                db.msg_timeout = null;
            }
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Обновляем сообщение
     * @param message {ClientMessage} Сообщение
     * @requires {MessageCycle}
     */
    function editMessage(message: ClientMessage): void {
        const { client, guild } = message;
        const queue: Queue = client.player.queue.get(guild.id);

        //Если очереди нет или сообщение нельзя отредактировать, то удаляем сообщение
        if (!queue || !queue?.song) return MessageCycle.toRemove(message.channelId);

        //Если у плеера статус при котором нельзя обновлять сообщение
        if (!queue.player.hasUpdate) return;

        setImmediate((): void => {
            const CurrentPlayEmbed = EmbedMessages.toPlaying(queue);

            //Обновляем сообщение
            message.edit({ embeds: [CurrentPlayEmbed] }).catch((e) => {
                if (e.message === "Unknown Message") MessageCycle.toRemove(message.channelId);
                Logger.log(`[MessageEmitter]: [function: UpdateMessage]: ${e.message}`);
            });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненый цикл сообщений
     */
    function messageCycleStep(): void {
        const messages = db.msg.filter(msg => !!msg.edit);

        //Запускаем отправку сообщений
        sendMessage(messages);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Обновляем сообщения
     * @param messages {ClientMessages} Сообщение которые надо обновлять
     */
    function sendMessage(messages: ClientMessage[]): void {
        const message = messages.shift();

        //Если не больше сообщений то через время начинаем заново
        if (!message) {
            db.msg_timeout = setTimeout(messageCycleStep, Music.AudioPlayer.updateMessage < 10 ? 15e3 : Music.AudioPlayer.updateMessage * 1e3);
            return;
        }

        //Обновляем сообщение
        editMessage(message);

        //Продолжаем обновление
        setImmediate(() => sendMessage(messages));
    }
}