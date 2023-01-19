import {EmbedMessages} from "@Structures/EmbedMessages";
import {ClientMessage} from "@Client/interactionCreate";
import {AudioPlayer} from "@Structures/AudioPlayer";
import {consoleTime} from "@Client/Client";
import {Music} from "@db/Config.json";
import {Queue} from "@Queue/Queue";

//Настройки для плеера
const PlayerSettings = Music.AudioPlayer;
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

/**
 * @description Player CycleStep
 */
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
            db.time = Date.now() + PlayerSettings.sendDuration;
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
}
//====================== ====================== ====================== ======================
/**
 * @description Цикл жизни плеера
 */
function playerCycleStep(): void {
    const players = db.pls.filter((player) => player.state.status === "read");

    try {
        db.time += 20;
        for (const player of players) player["preparePacket"]();
    } finally {
        db.timeout = setTimeout(playerCycleStep, db.time - Date.now());
    }
}
/*====================== ====================== ====================== ======================*/
/*====================== ====================== ====================== ======================*/
/*====================== ====================== ====================== ======================*/

/**
 * @description Система для обновления данных сообщения
 */
export namespace MessageCycle {
    /**
     * @description Добавляем сообщение в <Message[]>
     * @param message {message} Сообщение
     * @requires {StepCycleMessage}
     */
    export function toPush(message: ClientMessage) {
        if (db.msg.find(msg => message.channelId === msg.channelId)) return; //Если сообщение уже есть в базе, то ничего не делаем
        db.msg.push(message); //Добавляем сообщение в базу

        //Если в базе есть хоть одно сообщение, то запускаем таймер
        if (db.msg.length === 1) setImmediate(StepCycleMessage);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Удаляем сообщение из <Message[]>, так-же проверяем отключить ли таймер
     * @param ChannelID {string} ID канала
     * @requires {Message}
     */
    export function toRemove(ChannelID: string) {
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
}
//====================== ====================== ====================== ======================
/**
 * @description Обновляем сообщения на текстовый каналах
 */
function StepCycleMessage() {
    setImmediate(() => {
        try {
            setTimeout(() => db.msg.forEach(UpdateMessage), 1e3);
        } finally { db.timeout_m = setTimeout(StepCycleMessage, 15e3); }
    });
}
//====================== ====================== ====================== ======================
/**
 * @description Обновляем сообщение
 * @param message {ClientMessage} Сообщение
 * @requires {MessageCycle}
 */
function UpdateMessage(message: ClientMessage): void {
    const {client, guild} = message;
    const queue: Queue = client.queue.get(guild.id);

    //Если очереди нет или сообщение нельзя отредактировать, то удаляем сообщение
    if (!queue || !queue?.song) return MessageCycle.toRemove(message.channelId);

    //Если у плеера статус при котором нельзя обновлять сообщение
    if (queue.player.hasUpdate) return;

    setImmediate(() => {
        const CurrentPlayEmbed = EmbedMessages.toPlay(client, queue);

        //Обновляем сообщение
        return message.edit({embeds: [CurrentPlayEmbed]}).catch((e) => {
            if (e.message === "Unknown Message") MessageCycle.toRemove(message.channelId);
            consoleTime(`[MessageEmitter]: [function: UpdateMessage]: ${e.message}`);
        });
    });
}