import { Command, ResolveData } from "@Client/Command";
import { httpsClient } from "@httpsClient";
import {Colors, EmbedData} from "discord.js";

const CetusCycle = "https://api.warframestat.us/pc/cetusCycle";
const CetusDay = "https://media.discordapp.net/attachments/850775689107865641/996406014192668712/CetusSplashScreen.webp";
const CetusNight = "https://media.discordapp.net/attachments/850775689107865641/996406014498848828/Warframe.jpg";

export class CetusCommand extends Command {
    public constructor() {
        super({
            name: "cetus",
            description: "Сколько щас времени на равнинах цетуса!",

            isSlash: true,
            isEnable: true,
            isGuild: false
        });
    };

    public readonly run = async (_: any): Promise<ResolveData> => {
        const result = await new httpsClient(CetusCycle).toJson;
        return { embed: this.EmbedChange(result) };
    };
    //====================== ====================== ====================== ======================
    /**
     * @description Отправляем сообщение о том что сейчас день
     * @param res {CetusCycle} Данные о Цетусе
     * @private
     */
    private EmbedChange = (res: CetusCycle): EmbedData => {
        if (res.isDay) return {
            color: Colors.Yellow,
            description: `Сейчас на Цетусе день. До ночи осталось: ${res.timeLeft}`,
            image: { url: CetusDay }
        };
        return {
            color: Colors.Default,
            description: `Сейчас на Цетусе ночь. До дня осталось: ${res.timeLeft}`,
            image: { url: CetusNight }
        };
    };
}

interface CetusCycle {
    id: string,
    expiry: Date,
    activation: Date,
    isDay: boolean,
    state: "day" | "night",
    timeLeft: string,
    isCetus: boolean,
    shortString: string
}