import { ISong, Song } from "@AudioPlayer/Queue/Song";
import { Queue } from "@AudioPlayer/Queue/Queue";

export namespace DurationUtils {
    /**
     * @description Совмещаем время всех треков из очереди
     * @param queue {Queue | any[]} Очередь
     */
    export function getTracksTime(queue: Queue | Song[] | ISong.track[]): string {
        let Timer: number = 0;

        if (queue instanceof Queue) queue.songs.forEach((song: Song) => Timer += song.duration.seconds);
        else queue.forEach((song) => Timer += parseInt(song.duration.seconds as string));

        return toString(Timer);
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Создаем готовый формат времени. Пример 00:00:00:00 (Days:Hours:Minutes:Seconds)
     * @param duration {number} Число
     * @requires {toString}
     */
    export function toString(duration: number): string {
        const days = toSplit(duration / ((60 * 60) * 24) % 24) as number;
        const hours = toSplit(duration / (60 * 60) % 24) as number;
        const minutes = toSplit((duration / 60) % 60) as number;
        const seconds = toSplit(duration % 60) as number;

        //Получаем дни, часы, минуты, секунды в формате 00:00
        return (days > 0 ? `${days}:` : "") + (hours > 0 || days > 0 ? `${hours}:` : "") + (minutes > 0 ? `${minutes}:` : "00:") + (seconds > 0 ? `${seconds}` : "00");
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Из формата 00:00:00:00, получаем секунды
     * @param duration {string} Пример 00:00:00:00
     */
    export function toInt(duration: string): number {
        if (typeof duration === "number") return duration;

        const Splitter = duration?.split(":");
        const days = (duration: string) => Number(duration) * ((60 * 60) * 24);
        const hours = (duration: string) => Number(duration) * ((60 * 60) * 24);
        const minutes = (duration: string) => (Number(duration) * 60);
        const seconds = (duration: string) => Number(duration);

        if (!Splitter?.length) return Number(duration);

        switch (Splitter.length) {
            case 4: return days(Splitter[0]) + hours(Splitter[1]) + minutes(Splitter[2]) + seconds(Splitter[3]);
            case 3: return hours(Splitter[0]) + minutes(Splitter[1]) + seconds(Splitter[2]);
            case 2: return minutes(Splitter[0]) + seconds(Splitter[1]);
        }
    }
    //====================== ====================== ====================== ======================
    /**
     * @description Добавляем 0 к числу. Пример: 01:10
     * @param duration {string | number} Число
     */
    export function toSplit(duration: string | number): string | number {
        const fixed = parseInt(duration as any);

        return (fixed < 10) ? ("0" + fixed) : fixed;
    }
}