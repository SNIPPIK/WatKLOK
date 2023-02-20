import UserAgents from "@db/UserAgents.json";

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