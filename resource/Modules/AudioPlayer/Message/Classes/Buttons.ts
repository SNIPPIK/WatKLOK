import {ClientMessage} from "@Client/Message";
import {ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ComponentType, User} from "discord.js";
import {env} from "@env";

//Кнопки с которыми можно взаимодействовать
const ButtonIDs = ["skip", "resume_pause", "repeat", "last"];
const MusicButtons = JSON.parse(env.get("buttons"));

if (MusicButtons.length < 4) Error(`[Config]: Buttons has not found, find ${MusicButtons.length}, need 4`);
//Кнопки над сообщением о проигрывании трека
const Buttons = new ActionRowBuilder().addComponents(
    [
        new ButtonBuilder().setCustomId("last").setEmoji(MusicButtons[0]).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("resume_pause").setEmoji(MusicButtons[1]).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("skip").setEmoji(MusicButtons[2]).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("repeat").setEmoji(MusicButtons[3]).setStyle(ButtonStyle.Secondary)
    ]
);

/**
 * @description Создаем сборщик кнопок
 */
export class ButtonCollector {
    /**
     * @description Сборщик
     */
    private _collector: any;

    public static get buttons() { return Buttons; };

    //====================== ====================== ====================== ======================

    /**
     * @description Создаем сборщик и добавляем ивент
     * @param message {ClientMessage} Сообщение с сервера
     */
    public constructor(message: ClientMessage) {
        this._collector = message.createMessageComponentCollector({ filter: (i) => ButtonIDs.includes(i.customId), componentType: ComponentType.Button });
        this._collector.on("collect", (i: ButtonInteraction) => this.onCollect(i, message));
    };

    //====================== ====================== ====================== ======================

    /**
     * @description Отслеживаем ивент
     * @param i {ButtonInteraction} Кто взаимодействует с кнопкой
     * @param message {ClientMessage} Сообщение с сервера
     * @returns
     */
    private onCollect = (i: ButtonInteraction, message: ClientMessage) => {
        const { client, guild } = message;
        const queue = client.player.queue.get(guild.id);
        const { player } = queue;

        message.author = i?.member?.user as User ?? i?.user;

        try { i.deferReply().catch(() => {}); i.deleteReply().catch(() => {}); } catch (e) {/*Notfing*/ }

        //Если вдруг пользователь будет нажимать на кнопки после выключения плеера
        if (!player?.state || !player?.state?.status) return;

        switch (i.customId) {
            case "resume_pause": { //Если надо приостановить музыку или продолжить воспроизведение
                switch (player.state.status) {
                    case "read": return void client.player.pause(message);
                    case "pause": return void client.player.resume(message);
                }
                return;
            }
            //Пропуск текущей музыки
            case "skip": return void client.player.skip(message, 1);
            //Повторно включить текущую музыку
            case "repeat": {
                queue.options.loop = queue.options.loop === "songs" ? "song": "songs";
                return;
            }
            //Включить последнею из списка музыку
            case "last": return queue.swap = 0;
        }
    };

    //====================== ====================== ====================== ======================

    /**
     * @description Отключаем сборщик и удаляем
     */
    public destroy = () => {
        this._collector?.stop();
        this._collector = null;
    };
}