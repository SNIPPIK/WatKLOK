import {LifeCycle} from "@Typed/Abstracts/LifeCycle";
import {AudioPlayer} from "@AudioPlayer/Audio/AudioPlayer";
import {env} from "@env";

/**
 *
 * @description Жизненный цикл всех плееров
 *
 */
export class Cycles_Players extends LifeCycle<AudioPlayer> {
    protected readonly duration = parseInt(env.get("music.player.duration"));
    protected readonly _filter = (player: AudioPlayer) => player.hasPlayable;

    /**
     * @description Проверяем можно ли отправить пакет в голосовой канал
     */
    protected readonly _next = (player: AudioPlayer) => {
        const status = player?.status;

        //Если статус (idle или pause или его нет) прекратить выполнение функции
        if (status === "idle" || status === "pause" || !status || player?.connection?.state?.status !== "ready") return;

        //Если вдруг нет голосового канала
        if (!player.connection) { player.pause; return; }

        //Отправка музыкального пакета
        if (status === "read") {
            const packet: Buffer | null = player.stream?.read;

            if (packet) player.sendPacket = packet;
            else player.stop;
        }
    };
}