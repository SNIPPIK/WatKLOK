import {WatKLOK} from "../../../resource/Structures/Classes/Client";

/**
 * @description Класс для событий
 */
export abstract class Event<K, P> {
    //Название ивента Discord.<Client>
    public readonly name: string = "undefined";

    //Загружать ли ивент
    public isEnable: boolean = false;

    //Функция, которая будет запущена при вызове ивента
    public readonly run: (f: K, f2: P, client: WatKLOK) => void;
}