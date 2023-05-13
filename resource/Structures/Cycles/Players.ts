import { AudioPlayer } from "@AudioPlayer/Audio/AudioPlayer";
import { Music, Debug } from "@db/Config.json";
import {Logger} from "@Logger";

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
            if (Debug) Logger.debug(`[Cycle]: [Players]: Start cycle`);

            this.time = Date.now() + Music.AudioPlayer.sendDuration;
            setImmediate(() => this.playerCycleStep);
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
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненный цикл плееров
     */
    private get playerCycleStep(): void {
        //Если в базе больше нет плееров
        if (this._players.length === 0) {
            if (Debug) Logger.debug(`[Cycle]: [Players]: Stop cycle`);

            //Если таймер еще работает, то удаляем его
            if (this._timeout) {
                clearTimeout(this._timeout);
                this._timeout = null;
            }
            this.time = null;
            return;
        }

        const players = this._players.filter((player) => player.hasPlayable);

        //Постепенно обрабатываем плееры
        while (players.length > 0) {
            const player = players.shift();

            //Отправляем пакеты
            player.preparePacket;
        }

        //Добавляем задержку, в размер пакета
        this.time += 19.999995;

        setImmediate(() => {
            this._timeout = setTimeout(() => this.playerCycleStep, this.time - Date.now());
        });
    };
}