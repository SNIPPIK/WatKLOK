import { ReactionMenu } from "@Embeds/ReactionMenu";
import {History} from "@AudioPlayer/Audio/History";
import { Command, ResolveData } from "@Command";
import { ClientMessage } from "@Client/Message";
import { FileSystem } from "@Client/FileSystem";
import { ArraySort } from "@Util/ArraySort";
import { Colors } from "discord.js";

export default class extends Command {
    public constructor() {
        super({
            name: "history",
            description: "История прослушиваний этого сервера!",
            cooldown: 20
        });
    };

    public readonly execute = (message: ClientMessage): ResolveData => {
        const { author } = message;

        //Если история отключена
        if (!History.enable) return { text: `${author}, история выключена!`, color: "Yellow" };

        const file = FileSystem.getFile(`db/Guilds/[${message.guildId}].json`);

        //Если нет файла
        if (!file) return { text: `${author}, на этом сервере еще не включали музыку!`, color: "Yellow" };

        const jsonFile = JSON.parse(file);

        //Создаем странички
        const pages = ArraySort<any>(10, jsonFile.tracks, (track) =>
            `\`\`${track.platform.toUpperCase()}\`\` | \`\`${track.total}\`\` -> [${track.author.title}](${track.author.url}) - [${track.title}](${track.url})`, "\n"
        );

        //Создаем EMBED
        const embed = {
            title: `История прослушиваний`, color: Colors.Gold, description: pages[0], timestamp: new Date(),
            footer: { text: `${author.username} | Лист 1 из ${pages.length}`, iconURL: author.avatarURL() },
        }

        //Если есть еще страницы, то добавляем им кнопки взаимодействия
        if (pages.length > 1) return { embed, callbacks: ReactionMenu.DefaultCallbacks(1, pages, embed) };
        return { embed, lifeTime: 30e3 };
    };
}