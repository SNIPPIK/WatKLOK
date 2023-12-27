import {Song} from "@components/AudioClient/Queue/Song";
/**
 * @author SNIPPIK
 * @class Duration
 */
export const Duration = new class {
    /**
     * @description Получаем случайное число
     * @param min {number} Мин число
     * @param max {number} Макс число
     */
    public randomNumber = (min: number = 0, max: number) => parseInt((Math.random() * (max - min) + min).toFixed(0));


    /**
     * @description Совмещаем время всех треков из очереди
     * @param songs {Song[] | Song.track[]} Очередь
     */
    public getTimeArray = (songs: Song[]): string => {
        //Если трек треков
        if (songs.length === 0) return "00:00";

        let time = 0;
        for (let i = 0; i < songs.length; i++) time += songs[i].duration.seconds;

        return this.parseDuration(time);
    };


    /**
     * @description Добавляем 0 к числу. Пример: 01:10
     * @param duration {string | number} Число
     * @return string | number
     */
    public toSplit = (duration: string | number): string | number => {
        const fixed = parseInt(duration as string);

        return (fixed < 10) ? ("0" + fixed) : fixed;
    };


    /**
     * @description Превращаем число в 00:00
     * @param duration {number} Время в int
     * @return string
     */
    public parseDuration = (duration: number): string => {
        const days = this.toSplit(duration / ((60 * 60) * 24) % 24) as number;
        const hours = this.toSplit(duration / (60 * 60) % 24) as number;
        const minutes = this.toSplit((duration / 60) % 60) as number;
        const seconds = this.toSplit(duration % 60) as number;

        return (days > 0 ? `${days}:` : "") + (hours > 0 || days > 0 ? `${hours}:` : "") + (minutes > 0 ? `${minutes}:` : "00:") + (seconds > 0 ? `${seconds}` : "00");
    };


    /**
     * @description Превращаем 00:00 в число
     * @param duration {string} Время в формате 00:00
     * @return number
     */
    public parseDurationString = (duration: string): number => {
        const time = duration?.split(":").map((value) => parseInt(value)) ?? [parseInt(duration)];

        switch (time.length) {
            case 4: return (time[0] * ((60 * 60) * 24)) + (time[1] * ((60 * 60) * 24)) + (time[2] * 60) + time[3];
            case 3: return (time[0] * ((60 * 60) * 24)) + (time[1] * 60) + time[2];
            case 2: return (time[0] * 60) + time[1];
            default: return time[0];
        }
    };
}