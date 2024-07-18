import type {LocalizationMap} from "discord-api-types/v10";

/**
 * @author SNIPPIK
 * @description База данных фильтров
 */
export const Filters: Filter[] = [
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
    },
    {
        "name": "chorus",
        "unsupported": [],
        "description": "Имитирует хоровое звучание музыкальных инструментов",
        "description_localizations": {
            "en-US": "Imitates the choral sound of musical instruments"
        },
        "filter": "chorus=0.7:0.9:55:0.4:0.25:2",
        "args": false
    },
    {
        "name": "chorus2d",
        "unsupported": [],
        "description": "Имитирует хоровое звучание музыкальных инструментов в 2D",
        "description_localizations": {
            "en-US": "Simulates the choral sound of musical instruments in 2D"
        },
        "filter": "chorus=0.6:0.9:50|60:0.4|0.32:0.25|0.4:2|1.3",
        "args": false
    },
    {
        "name": "chorus3d",
        "unsupported": [],
        "description": "Имитирует хоровое звучание музыкальных инструментов в 3D",
        "description_localizations": {
            "en-US": "Simulates the choral sound of musical instruments in 3D"
        },
        "filter": "chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3",
        "args": false
    },
    {
        "name": "softlimiter",
        "unsupported": [],
        "description": "Полностью предотвращает превышение сигналом заданной настройки — предела, который ничто не может превысить",
        "description_localizations": {
            "en-US": "Completely prevents the signal from exceeding the preset setting — a limit that nothing can exceed"
        },
        "filter": "compand=attacks=0:points=-80/-80|-12.4/-12.4|-6/-8|0/-6.8|20/-2.8",
        "args": false
    },
    {
        "name": "expander",
        "unsupported": [],
        "description": "Уменьшает динамический диапазон аудиосигнала",
        "description_localizations": {
            "en-US": "Reduces the dynamic range of the audio signal"
        },
        "filter": "compand=attacks=0:points=-80/-169|-54/-80|-49.5/-64.6|-41.1/-41.1|-25.8/-15|-10.8/-4.5|0/0|20/8.3",
        "args": false
    }
]


/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface Filter
 */
export interface Filter {
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