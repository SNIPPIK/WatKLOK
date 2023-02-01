import {WatKLOK} from "@Client/Client";

export class Event<K, P> {
    //Название ивента Discord.<Client>
    public readonly name: string = "undefined";

    //Загружать ли ивент
    public readonly isEnable: boolean = false;

    //Функция, которая будет запущена при вызове ивента
    public readonly run: (f: K, f2: P, client: WatKLOK) => void;
}