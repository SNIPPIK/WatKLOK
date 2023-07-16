import { ISong, Song } from "@AudioPlayer/Queue/Song";

const days = (duration: string) => Number(duration) * ((60 * 60) * 24);
const hours = (duration: string) => Number(duration) * ((60 * 60) * 24);
const minutes = (duration: string) => (Number(duration) * 60);
const seconds = (duration: string) => Number(duration);

export namespace Duration {
    /**
     * @description Совмещаем время всех треков из очереди
     * @param songs {Song[] | ISong.track[]} Очередь
     */
    export function getTracksTime(songs: Song[] | ISong.track[]): string {
        if (songs.length === 0) return "00:00";

        let Timer: number = 0;
        for (const track of songs) Timer += parseInt(track.duration.seconds as string);

        return toConverting(Timer) as string;
    }


    /**
     * @description Если получаем string выдаем number и наоборот
     * @param duration {number | string} Строка или число
     */
    export function toConverting(duration: number | string) {
        if (typeof duration === "number") {
            const days = Duration.toSplit(duration / ((60 * 60) * 24) % 24) as number;
            const hours = Duration.toSplit(duration / (60 * 60) % 24) as number;
            const minutes = Duration.toSplit((duration / 60) % 60) as number;
            const seconds = Duration.toSplit(duration % 60) as number;

            return (days > 0 ? `${days}:` : "") + (hours > 0 || days > 0 ? `${hours}:` : "") + (minutes > 0 ? `${minutes}:` : "00:") + (seconds > 0 ? `${seconds}` : "00");
        }
        const Splitter = duration?.split(":");

        switch (Splitter.length) {
            case 4: return days(Splitter[0]) + hours(Splitter[1]) + minutes(Splitter[2]) + seconds(Splitter[3]);
            case 3: return hours(Splitter[0]) + minutes(Splitter[1]) + seconds(Splitter[2]);
            case 2: return minutes(Splitter[0]) + seconds(Splitter[1]);
            default:  return Number(duration);
        }
    }


    /**
     * @description Добавляем 0 к числу. Пример: 01:10
     * @param duration {string | number} Число
     */
    export function toSplit(duration: string | number): string | number {
        const fixed = parseInt(duration as any);

        return (fixed < 10) ? ("0" + fixed) : fixed;
    }
}