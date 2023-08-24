import {Events} from "discord.js";

/**
 * @description Класс для событий
 */
export abstract class Action {
    //Название ивента Discord.<Client>
    public readonly name: Events;

    //Функция, которая будет запущена при вызове ивента
    public readonly execute: (...args: any) => void;
}