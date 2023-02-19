import UserAgents from "@db/UserAgents.json";
import proxies from "@db/Proxies.json"

/**
 * @description Получаем рандомный user-agent и его версию
 */
export function GetUserAgent(): { Agent: string, Version: string } {
    const MinAgents = Math.ceil(0);
    const MaxAgents = Math.floor(UserAgents.length - 1);

    //Сам агент
    const Agent = UserAgents[Math.floor(Math.random() * (MaxAgents - MinAgents + 1)) + MinAgents];
    //Версия агента
    const Version = Agent?.split("Chrome/")[1]?.split(" ")[0];

    return {Agent, Version};
}
//====================== ====================== ====================== ======================
/**
 * @description Получаем рандомный прокси
 */
export function getProxy(): {ip: string, port: number} {
    const MinProxy = Math.ceil(0);
    const MaxProxy = Math.floor(proxies.length - 1);

    return proxies[Math.floor(Math.random() * (MaxProxy - MinProxy + 1)) + MinProxy];
}