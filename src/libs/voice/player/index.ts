import type {LocalizationMap} from "discord-api-types/v10";
import {TypedEmitter} from "tiny-typed-emitter";
import {VoiceConnection} from "@lib/voice";
import {SeekStream} from "../audio";
import {Logger} from "@env";
import {db} from "@lib/db";

/**
 * @description Список всех фильтров
 * @private
 */
export const Filters: AudioFilter[] = [
    {
        "name": "loudnorm",
        "unsupported": [],
        "description": "Нормализует тон звуковой дорожки",
        "description_localizations": {
            "en-US": "Normalizes the tone of the audio track"
        },
        "filter": "loudnorm",
        "args": false
    },
    {
        "name": "mono",
        "unsupported": ["8d", "chorus", "chorus2d", "chorus3d"],
        "description": "Используется только один аудиоканал для воспроизведения",
        "description_localizations": {
            "en-US": "Only one audio channel is used for playback"
        },
        "filter": "pan=mono|c0=.5*c0+.5*c1",
        "args": false
    },
    {
        "name": "treble",
        "unsupported": [],
        "description": "Высокие частоты описывают тона высокой частоты или высокого тона в диапазоне от 6 кГц до 20 кГц",
        "description_localizations": {
            "en-US": "High frequencies describe tones of high frequency or high pitch in the range from 6 kHz to 20 kHz"
        },
        "filter": "treble=g=5",
        "args": false
    },
    {
        "name": "reverse",
        "unsupported": [],
        "description": "Все будет играть задом на перед",
        "description_localizations": {
            "en-US": "Everything will be played backwards"
        },
        "filter": "areverse",
        "args": false
    },
    {
        "name": "surround",
        "unsupported": [],
        "description": "Метод повышения точности и глубины воспроизведения звука за счет использования нескольких аудиоканалов от динамиков",
        "description_localizations": {
            "en-US": "A method to increase the accuracy and depth of sound reproduction by using multiple audio channels from speakers"
        },
        "filter": "surround",
        "args": false
    },
    {
        "name": "flanger",
        "unsupported": [],
        "description": "Смешивания двух идентичных сигналов вместе, один сигнал задерживается на небольшой и постепенно меняющийся период",
        "description_localizations": {
            "en-US": "By mixing two identical signals together, one signal is delayed for a small and gradually changing period"
        },
        "filter": "flanger",
        "args": false
    },
    {
        "name": "haas",
        "unsupported": [],
        "description": "Бинауральный психоакустический эффект, состоящий из двух частей",
        "description_localizations": {
            "en-US": "При смешивании двух идентичных сигналов один из них задерживается на небольшой и постепенно изменяющийся период"
        },
        "filter": "haas",
        "args": false
    },
    {
        "name": "nightcore",
        "unsupported": ["vaporwave", "vw"],
        "description": "Высота звука увеличивается, а исходный материал ускоряется примерно на 35%",
        "description_localizations": {
            "en-US": "The pitch of the sound increases, and the source material accelerates by about 35%"
        },
        "filter": "asetrate=48000*1.25,aresample=48000,bass=g=5",
        "args": false,
        "speed": 1.25
    },
    {
        "name": "echo",
        "unsupported": [],
        "description": "Отражение звука, которое доходит до слушателя с задержкой после прямого звука",
        "description_localizations": {
            "en-US": "The reflection of the sound that reaches the listener with a delay after the direct sound"
        },
        "filter": "aecho=0.8:0.9:1000:0.3",
        "args": false
    },
    {
        "name": "8d",
        "unsupported": [],
        "description": "Отражение звука, которое доходит до слушателя с задержкой после прямого звука",
        "description_localizations": {
            "en-US": "The reflection of the sound that reaches the listener with a delay after the direct sound"
        },
        "filter": "apulsator=hz=0.09",
        "args": false
    },
    {
        "name": "speed",
        "unsupported": [],
        "description": "Скорость проигрывания музыки",
        "description_localizations": {
            "en-US": "The speed of music playback"
        },
        "filter": "atempo=",
        "args": [1, 3],
        "speed": "arg"
    },
    {
        "name": "bass",
        "unsupported": [],
        "description": "Тоны низкой частоты, высоты тона и диапазона от 16 до 256 Гц",
        "description_localizations": {
            "en-US": "Tones of low frequency, pitch and range from 16 to 256 Hz"
        },
        "filter": "bass=g=",
        "args": [1, 30]
    },
    {
        "name": "sub_boost",
        "unsupported": [],
        "description": "Глубокие, низкочастотные тона",
        "description_localizations": {
            "en-US": "Deep, low-frequency tones"
        },
        "filter": "asubboost",
        "args": false
    },
    {
        "name": "vibro",
        "unsupported": [],
        "description": "Волны звуковых колебаний сохраняются в виде канавки",
        "description_localizations": {
            "en-US": "The waves of sound vibrations are stored in the form of a groove"
        },
        "filter": "vibrato=f=6.5",
        "args": false
    },
    {
        "name": "phaser",
        "unsupported": [],
        "description": "Электронный звуковой процессор, используемый для фильтрации сигнала",
        "description_localizations": {
            "en-US": "An electronic sound processor used to filter the signal"
        },
        "filter": "aphaser=in_gain=0.4",
        "args": false
    },
    {
        "name": "vaporwave",
        "unsupported": ["nightcore", "night"],
        "description": "Противоположность nightcore",
        "description_localizations": {
            "en-US": "The opposite of nightcore"
        },
        "filter": "asetrate=48000*0.8,aresample=48000,atempo=1.1",
        "args": false,
        "speed": 1.1
    }
];

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 * @extends TypedEmitter
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private readonly id: string = null;
    private readonly audioFilters = new AudioFilters();
    private readonly data = {
        status: "player/wait"   as keyof AudioPlayerEvents,
        voice:  null            as VoiceConnection,
        stream: null            as SeekStream
    };

    /**
     * @description Задаем параметры плеера перед началом работы
     * @param guild - ID сервера для аутентификации плеера
     */
    public constructor(guild: string) {
        super();
        this.id = guild;

        // Загружаем ивенты плеера
        for (const event of db.audio.queue.events.player)
            this.on(event, (...args: any[]) => db.audio.queue.events.emit(event as any, ...args));

        // Добавляем плеер в базу для отправки пакетов
        db.audio.cycles.players.set(this);
    };

    /**
     * @description Выдаем ID сервера с которым работает плеер или аутентификатор плеера
     * @return string - ID сервера для аутентификации плеера
     * @public
     */
    public get ID() { return this.id; };

    /**
     * @description Управляем фильтрами
     * @return AudioFilters
     * @public
     */
    public get filters() { return this.audioFilters; };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this.data.voice; };

    /**
     * @description Текущий статус плеера
     * @return AudioPlayerStatus
     * @public
     */
    public get status() { return this.data.status; };

    /**
     * @description Текущий стрим
     * @return AudioResource
     * @public
     */
    public get stream() { return this.data.stream; };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        if (this.status === "player/wait" || !this.connection) return false;

        //Если больше не читается, переходим в состояние wait.
        if (!this.stream?.readable) {
            this.stream?.stream?.emit("end");
            this.status = "player/wait";
            return false;
        }

        return true;
    };

    /**
     * @description Взаимодействие с голосовым подключением
     * @param connection - Голосовое подключение
     * @public
     */
    public set connection(connection: VoiceConnection) {
        if (this.data.voice && this.data.voice.config.channelId === connection.config.channelId) return;
        this.data.voice = connection;
    };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status - Статус плеера
     * @public
     */
    public set status(status: keyof AudioPlayerEvents) {
        //Если новый статус не является старым
        if (status !== this.data.status) {
            if (status === "player/pause" || status === "player/wait") {
                this.connection.speak = false;
                this.stream?.stream?.emit("pause");
            } else this.connection.speak = true;

            this.emit(status, this);
        }

        this.data.status = status;
    };

    /**
     * @description Смена потока
     * @param stream - Opus конвертор
     * @public
     */
    public set stream(stream: SeekStream) {
        //Если есть текущий поток
        if (this.stream && this.stream?.stream) {
            this.stream?.stream?.emit("close");
            this.data.stream = null;
        }

        //Подключаем новый поток
        this.data.stream = stream;
        this.status = "player/playing";
    };

    /**
     * @description Передача пакета в голосовой канал
     * @public
     */
    public set sendPacket(packet: Buffer) {
        try {
            if (packet) this.connection.playOpusPacket(packet)
        } catch (err) {
            //Подключаемся к голосовому каналу заново
            if (`${err}`.includes("getaddrinfo")) {
                this.status = "player/pause";
                this.emit("player/error", this, `Attempt to reconnect to the voice channel!`);

                for (let r = 0; r < 2; r++) {
                    if (this.connection.state.status === "ready") break;
                    this.connection.rejoin();
                }
            }

            //Если возникает не исправимая ошибка, то выключаем плеер
            this.emit("player/error", this, `${err}`, "crash");
        }
    };

    /**
     * @description Начинаем чтение стрима
     * @public
     */
    public set read(options: {path: string, seek: number}) {
        const stream = new SeekStream(Object.assign(options, this.filters.compress));

        //Если стрим можно прочитать
        if (stream.readable) {
            this.stream = stream;
            return;
        }

        const timeout = setTimeout(() => {
            this.emit("player/error", this, "Timeout the stream has been exceeded!", "skip");
        }, 25e3);

        stream.stream
            //Включаем поток когда можно будет начать читать
            .once("readable", () => {
                this.stream = stream;
                clearTimeout(timeout);
            })
            //Если происходит ошибка, то продолжаем читать этот же поток
            .once("error", () => {
                this.emit("player/error", this, "Fail read stream", "skip");
                clearTimeout(timeout);
            });
    };

    /**
     * @description Функция отвечает за циклическое проигрывание
     * @param track - Трек который будет включен
     * @param seek - Пропуск времени
     * @public
     */
    public play = (track: AudioPlayerInput, seek: number = 0): void => {
        if (!track || !("resource" in track)) {
            this.emit("player/wait", this);
            return;
        }

        // Получаем ссылку на исходный трек
        track.resource.then((path) => {
            // Если нет ссылки на аудио
            if (!path) {
                this.emit("player/error", this, `Not found link audio!`, "skip");
                return;
            }

            // Если получена ошибка вместо ссылки
            else if (path instanceof Error) {
                this.emit("player/error", this, `Failed to getting link audio!\n\n${path.name}\n- ${path.message}`, "skip");
                return;
            }

            this.emit("player/ended", this, seek);
            this.read = {path, seek};
        }).catch((err) => {
            this.emit("player/error", this, `${err}`, "skip");
            Logger.log("ERROR", err);
        });
    };

    /**
     * @description Ставим на паузу плеер
     * @public
     */
    public pause = (): void => {
        if (this.status !== "player/playing") return;
        this.status = "player/pause";
    };

    /**
     * @description Убираем с паузы плеер
     * @public
     */
    public resume = (): void => {
        if (this.status !== "player/pause") return;
        this.status = "player/playing";
    };

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @public
     */
    public stop = (): void => {
        if (this.status === "player/wait") return;
        this.status = "player/wait";
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        this.removeAllListeners();
        //Выключаем плеер если сейчас играет трек
        this.stop();

        try {
            this.stream?.stream?.emit("end");
        } catch (err) {
            console.error(err)
        }

        for (let str of Object.keys(this.data)) this.data[str] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Ивенты плеера
 * @interface AudioPlayerEvents
 */
export interface AudioPlayerEvents {
    //Плеер начал играть новый трек
    "player/ended": (player: AudioPlayer, seek: number) => void;

    //Плеер закончил играть трек
    "player/wait": (player: AudioPlayer) => void;

    //Плеер встал на паузу
    "player/pause": (player: AudioPlayer) => void;

    //Плеер играет
    "player/playing": (player: AudioPlayer) => void;

    //Плеер получил ошибку
    "player/error": (player: AudioPlayer, err: string, type?: "crash" | "skip") => void;
}

/**
 * @author SNIPPIK
 * @description Данные входящие в качестве трека
 * @interface AudioPlayerInput
 * @private
 */
interface AudioPlayerInput {
    resource: Promise<string | Error>
}

/**
 * @author SNIPPIK
 * @description Управление фильтрами
 */
export class AudioFilters {
    /**
     * @description Включенные фильтры
     * @private
     */
    private readonly enables: AudioFilter[] = [];

    /**
     * @description Получаем список включенных фильтров
     * @public
     */
    public get enable() { return this.enables; };

    /**
     * @description Сжимаем фильтры для работы ffmpeg
     */
    public get compress() {
        const realFilters: string[] = [`volume=${db.audio.options.volume / 100}`, `afade=t=in:st=0:d=${db.audio.options.fade}`];
        let chunk = 0;

        // Берем данные из всех фильтров
        for (const filter of this.enable) {
            const filterString = filter.args ? `${filter.filter}${filter.user_arg ?? ""}` : filter.filter;
            realFilters.push(filterString);

            // Если есть модификация скорости, то изменяем размер пакета
            if (filter.speed) {
                if (typeof filter.speed === "number") chunk += Number(filter.speed);
                else chunk += Number(this.enable.slice(this.enable.indexOf(filter) + 1));
            }
        }

        return { filters: realFilters.join(","), chunk };
    };
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface AudioFilter
 */
export interface AudioFilter {
    //Имена
    name: string;

    //Имена несовместимых фильтров
    unsupported: string[];

    //Описание
    description: string;

    //Перевод фильтров
    description_localizations: LocalizationMap;

    //Сам фильтр
    filter: string;

    //Аргументы
    args: false | [number, number];

    //Аргумент пользователя
    user_arg?: any;

    //Меняется ли скорость
    speed?: string | number;
}