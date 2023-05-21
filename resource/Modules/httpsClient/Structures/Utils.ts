import UserAgents from "@db/UserAgents.json";

/**
 * @description Получаем рандомный user-agent и его версию
 */
export function getUserAgent(): { Agent: string, Version: string } {
    //Сам агент
    const Agent = UserAgents[randomNumber(UserAgents.length - 1)];
    //Версия агента
    const Version = Agent?.split("Chrome/")[1]?.split(" ")[0];

    return { Agent, Version };
}

//====================== ====================== ====================== ======================

/**
 * @description Получаем случайное число
 * @param max {number} Макс число
 * @param min {number} Мин число
 */
function randomNumber(max: number, min = 0) {
    return Math.floor(Math.random() * (max - min + 1)) + max;
}