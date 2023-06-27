import UserAgents from "@Json/UserAgents.json";

/**
 * @description Получаем рандомный user-agent и его версию
 */
export function getUserAgent(): { Agent: string, Version: string } {
    //Сам агент
    const Agent = UserAgents[randomNumber(UserAgents.length)];
    //Версия агента
    const Version = Agent?.split("Chrome/")[1]?.split(" ")[0];

    return { Agent, Version };
}

//====================== ====================== ====================== ======================

/**
 * @description Получаем случайное число
 * @param max {number} Макс число
 */
export function randomNumber(max: number) {
    return Math.floor(Math.random() * max);
}