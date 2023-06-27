import {Logger} from "@Utils/Logger";
import * as https from "https";
import {env} from "@Client/Fs";
import * as http from "http";
import {randomNumber} from "./Utils";
import fs from "fs";

const Debug = env.get("debug.request.proxy");

export class httpsAgent {
    /**
     * @description Куда надо подключится
     */
    private _path: string;


    /**
     * @description Получаем из Json файла данные прокси
     * @private
     */
    private get proxy() {
        const proxyList = JSON.parse(fs.readFileSync(`Data/Json/Proxy.json`, {encoding: "utf-8"}));
        const number = randomNumber(proxyList.length);

        return proxyList[number];
    };


    /**
     * @description Получаем https.Agent для использования прокси
     */
    public get Agent() {
        const proxy = this.proxy;

        return new Promise<https.Agent>((resolve) => {
            const request = http.request({method: "CONNECT", host: proxy.host, port: proxy.port, path: `${this._path}`});

            //Подключаемся к прокси
            request.once("connect", (res, socket) => {
                if (Debug) Logger.debug(`Proxy: [connect | ${res.statusCode}]: [${proxy.host}:${proxy.port}]: ${res.statusMessage}`);

                if (res.statusCode === 200) return resolve(new https.Agent({ socket }));
                return resolve(null);
            });

            //Если при подключении происходит ошибка
            request.once("error", () => {
                if (Debug) Logger.debug(`Proxy: [error]: [${proxy.host}:${proxy.port}]`);

                return resolve(null);
            });

            //Если время ожидания превышено
            request.once("timeout", () => {
                if (Debug) Logger.debug(`Proxy: [timeout]: [${proxy.host}:${proxy.port}]`);

                return resolve(null);
            });

            //Что делаем при завершении
            request.once("close", () => {
                this._path = null;
            });

            request.end();
        });
    };


    /**
     * @description Создаем класс
     * @param path {string} Куда надо будет подключится
     */
    public constructor(path: string) { this._path = path; }
}