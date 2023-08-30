import {env} from "@env";

/**
 * @description Поддерживается пока только youtube
 */
export class Cookie {
    /**
     * @description Обновляем куки в файле env
     * @param Cookie {string | string[]} Новый куки или новые данные для замены
     */
    public set update(Cookie: string | string[]) {
        const oldCookie: string = env.get("bot.cookie.youtube");

        if (!oldCookie) return;

        //Объединяем куки если он имеет формат array
        const toCookie = typeof Cookie === "string" ? Cookie : Cookie.join("; ");

        //Соединяем старый и новый куки
        const joinCookie = this.toString({...this.toJson(oldCookie), ...this.toJson(toCookie)});

        env.set("bot.cookie.youtube", joinCookie);
    };


    /**
     * @description Конвертируем куки в Json
     * @param Cookie {string} Куки
     */
    private readonly toJson = (Cookie: string): {} => {
        let output: any = {};

        Cookie.split(/\s*;\s*/).forEach((pair) => {
            const cook = pair.split(/\s*=\s*/);
            output[cook[0]] = cook.splice(1).join('=');
        });

        return output;
    };


    /**
     * @description Конвертируем куки в строку для дальнейшего использования
     * @param Cookie {{}} Совмещенный куки
     */
    private readonly toString = (Cookie: {}): string => Object.entries(Cookie).map(([key, value]) => `${key}=${value}`).join("; ");
}