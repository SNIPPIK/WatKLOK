import { AudioPlayer } from "@AudioPlayer/Audio/AudioPlayer";
import {Logger} from "@Logger";
import {env} from "@env";

const debug = env.get("debug.cycle");
const duration = parseInt(env.get("music.player.duration"));

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
            if (debug) Logger.debug(`[Cycle]: [Players]: Start cycle`);

            this.time = Date.now() + duration;
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
     * @description Получаем плееры, в которых можно отсылать пакеты
     */
    private get players() { return this._players.filter((player) => player.hasPlayable); };
    //====================== ====================== ====================== ======================
    /**
     * @description Жизненный цикл плееров
     */
    private get playerCycleStep(): void {
        //Если в базе больше нет плееров
        if (this._players.length === 0) {
            if (debug) Logger.debug(`[Cycle]: [Players]: Stop cycle`);

            //Если таймер еще работает, то удаляем его
            if (this._timeout) {
                clearTimeout(this._timeout);
                this._timeout = null;
            }
            this.time = null;
            return;
        }

        const players = this.players;

        //Постепенно обрабатываем плееры
        while (players.length > 0) {
            const player = players.shift();

            //Проверяем можно ли отправлять пакеты
            this.checkPlayer(player);
        }

        //Добавляем задержку, в размер пакета
        this.time += 19.999995;

        setImmediate(() => {
            this._timeout = setTimeout(() => this.playerCycleStep, this.time - Date.now());
        });
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Проверяем можно ли отправить пакет в голосовой канал
     */
    private readonly checkPlayer = (player: AudioPlayer) => {
        const state = player?.state;

        //Если статус (idle или pause или его нет) прекратить выполнение функции
        if (!state || state?.status === "idle" || state?.status === "pause" || !state?.status || player?.connection?.state?.status !== "ready") return;

        //Если вдруг нет голосового канала
        if (!player.connection) { player.state = { ...state, status: "pause" }; return; }

        //Отправка музыкального пакета
        if (state.status === "read") {
            const packet: Buffer | null = state.stream?.read;

            if (packet) player.sendPacket = packet;
            else {
                player.connection.setSpeaking(false);
                player.stop;
            }
        }
    };
}