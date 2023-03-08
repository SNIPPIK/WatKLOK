import {WatKLOK} from "@Client/Client";

export class Module {
    //Включать модуль
    public readonly isEnable: boolean = true;

    //Функция, которая будет запущена
    public readonly run: (client: WatKLOK) => any;
}