import {ClientMessage} from "@Client/Message";
import {ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ComponentType, User} from "discord.js";
import {env} from "@Client/Fs";
import {Queue} from "@AudioPlayer/Queue/Queue";
import {MessageUtils} from "@Utils/Message";

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

export class ButtonCollector {
    protected _collector: any;
    public static get buttons() { return Buttons; };


    /**
     * @description Создаем сборщик и добавляем ивент
     * @param message {ClientMessage} Сообщение с сервера
     */
    public constructor(message: ClientMessage) {
        this._collector = message.createMessageComponentCollector({ filter: (i) => ButtonIDs.includes(i.customId), componentType: ComponentType.Button });
        this._collector.on("collect", (i: ButtonInteraction) => this.onCollect(i, message));
    };


    /**
     * @description Отслеживаем ивент
     * @param i {ButtonInteraction} Кто взаимодействует с кнопкой
     * @param message {ClientMessage} Сообщение с сервера
     */
    protected onCollect = (i: ButtonInteraction, message: ClientMessage) => {
        const { client, guild } = message, queue = client.player.queue.get(guild.id), { player } = queue;
        message.author = i?.member?.user as User ?? i?.user;

        i.deferReply().catch(() => {});  i.deleteReply().catch(() => {});

        //Если вдруг пользователь будет нажимать на кнопки после выключения плеера
        if (!player?.status) return;

        return this.onButtonPush(queue, i);
    };


    /**
     * @description Проверяем ID кнопок
     * @param queue {Queue} Очередь
     * @param i {ButtonInteraction} Взаимодействие с кнопкой
     */
    protected onButtonPush = (queue: Queue, i: ButtonInteraction): void => {
        const message = queue.message, player = message.client.player;

        switch (i.customId) {
            case "skip": return player.skip(message, 1);
            case "last": return void (queue.swap = 0);
            case "resume_pause": {
                switch (queue.player.status) {
                    case "read": return player.pause(message);
                    case "pause": return player.resume(message);
                }
                return;
            }
            case "repeat": {
                queue.options.loop = queue.options.loop === "songs" ? "song": "songs";
                MessageUtils.send = { text: `🎶 | Повтор ${queue.options.loop}`, message, color: "Green", codeBlock: "css" };
                return;
            }
        }
    };


    /**
     * @description Отключаем сборщик и удаляем
     */
    public destroy = () => this._collector?.stop();
}