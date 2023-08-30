import { ISong, Song } from "@AudioPlayer/Queue/Song";

export const Duration = new class parseDuration {
    /**
     * @description Получаем случайное число
     * @param max {number} Макс число
     */
    public randomNumber = (max: number) => Math.floor(Math.random() * max);


    /**
     * @description Совмещаем время всех треков из очереди
     * @param songs {Song[] | ISong.track[]} Очередь
     */
    public getTimeArray = (songs: Song[] | ISong.track[]): string => {
        //Если трек треков
        if (songs.length === 0) return "00:00";

        let time: number | string = 0;
        for (const song of songs) time += parseInt(song.duration.seconds as string);

        return this.parseDuration(time);
    };


    /**
     * @description Добавляем 0 к числу. Пример: 01:10
     * @param duration {string | number} Число
     */
    public toSplit = (duration: string | number): string | number => {
        const fixed = parseInt(duration as string);

        return (fixed < 10) ? ("0" + fixed) : fixed;
    };


    public parseDuration(duration: number): string;
    public parseDuration(duration: string): number;
    public parseDuration(duration: number | string): any {
        if (typeof duration === "number") {
            let time = [duration / ((60 * 60) * 24) % 24, duration / (60 * 60) % 24, (duration / 60) % 60, duration % 60].filter(dur => dur >= 1).map(this.toSplit);

            if (time.length === 0) return "00:00";
            else if (time.length === 1) return `00:${time[0]}`;
            return time.join(":");
        }

        let time = duration.split(":").map(parseInt);
        switch (time.length) {
            case 4: return (time[0] * ((60 * 60) * 24)) + (time[1] * ((60 * 60) * 24)) + (time[2] * 60) + time[3];
            case 3: return (time[0] * ((60 * 60) * 24)) + (time[1] * 60) + time[2];
            case 2: return (time[0] * 60) + time[1];
            default: return time[0];
        }
    };
}