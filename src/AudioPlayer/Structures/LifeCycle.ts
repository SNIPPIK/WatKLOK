import { EmbedMessages } from "@Structures/Messages/Embeds";
import { ClientMessage } from "@Client/interactionCreate";
import { AudioPlayer } from "@Structures/Player";
import { Balancer } from "@Structures/Balancer";
import { consoleTime } from "@Client/Client";
import { Music } from "@db/Config.json";
import { Queue } from "@Queue/Queue";

export { PlayerCycle, MessageCycle };
//====================== ====================== ====================== ======================

//База данных
const db = {
    // База с плеерами
    pls: [] as AudioPlayer[],
    //База с сообщениями
    msg: [] as ClientMessage[],
    //Общий таймер плееров
    timeout: null as NodeJS.Timeout,
    //Общий таймер сообщений
    timeout_m: null as NodeJS.Timeout,

    //Время, необходимо для правильной отправки пакетов
    time: 0 as number
};

//====================== ====================== ====================== ======================
//                                 -= Players functions =-                                 //
//====================== ====================== ====================== ======================
namespace PlayerCycle {
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
            if (db.timeout) clearTimeout(db.timeout);

            db.time = null;
            db.timeout = null;
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненный цикл плееров
     */
    function playerCycleStep(): void {
        setImmediate((): void => {
            try {
                db.time += 20;
                for (let player of db.pls) player["preparePacket"]();
            } finally {
                db.timeout = setTimeout(playerCycleStep, db.time - Date.now());
            }
        });
    }
}


//====================== ====================== ====================== ======================
//                                -= Messages functions =-                                 //
//====================== ====================== ====================== ======================
namespace MessageCycle {
    /**
     * @description Добавляем сообщение в <Message[]>
     * @param message {message} Сообщение
     * @requires {messageCycleStep}
     */
    export function toPush(message: ClientMessage): void {
        if (db.msg.find(msg => message.channelId === msg.channelId)) return; //Если сообщение уже есть в базе, то ничего не делаем
        db.msg.push(message); //Добавляем сообщение в базу

        //Если в базе есть хоть одно сообщение, то запускаем таймер
        if (db.msg.length === 1) Balancer.push(messageCycleStep);
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
            if (db.timeout_m) {
                clearTimeout(db.timeout_m);

                db.timeout_m = null;
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
        const queue: Queue = client.queue.get(guild.id);

        //Если очереди нет или сообщение нельзя отредактировать, то удаляем сообщение
        if (!queue || !queue?.song) return MessageCycle.toRemove(message.channelId);

        //Если у плеера статус при котором нельзя обновлять сообщение
        if (!queue.player.hasUpdate) return;

        setImmediate(() => {
            const CurrentPlayEmbed = EmbedMessages.toPlaying(queue);

            //Обновляем сообщение
            return message.edit({ embeds: [CurrentPlayEmbed] }).catch((e) => {
                if (e.message === "Unknown Message") MessageCycle.toRemove(message.channelId);
                consoleTime(`[MessageEmitter]: [function: UpdateMessage]: ${e.message}`);
            });
        });
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненый цикл сообщений
     */
    function messageCycleStep(): void {
        setImmediate((): void => {
            try {
                setTimeout(() => db.msg.forEach((message) => Balancer.push(() => editMessage(message))), 1e3);
            } finally { db.timeout_m = setTimeout(messageCycleStep, Music.AudioPlayer.updateMessage < 10 ? 15e3 : Music.AudioPlayer.updateMessage * 1e3); }
        });
    }
}
