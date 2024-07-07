import {ActionRowBuilder, Colors, ComponentData, EmbedData} from "discord.js";
import {Client} from "@lib/discord";
import {Logger} from "@env";

/**
 * @author SNIPPIK
 * @description создаем продуманное сообщение
 * @class MessageBuilder
 */
export class MessageBuilder {
    public callback: (message: Client.message, pages: string[], page: number, embed: MessageBuilder["embeds"]) => void;
    public promise: (msg: Client.message) => void;
    public components: (ComponentData | ActionRowBuilder)[] = [];
    public embeds: (EmbedData)[] = [];
    public page: number = 1;
    public time: number = 15e3;
    public pages: string[] = [];
    public replied: boolean = false;

    /**
     * @description Отправляем сообщение в текстовый канал
     * @param interaction
     */
    public set send(interaction: Client.interact | Client.message) {
        this.prepareChannel(interaction).then((message) => {
            //Удаляем сообщение через время если это возможно
            if (this.time !== 0) MessageBuilder.delete = {message, time: this.time};

            //Если получить возврат не удалось, то ничего не делаем
            if (!message) return;

            //Если надо выполнить действия после
            if (this.promise) this.promise(message);

            //Если меню, то не надо удалять
            if (this.pages && this.pages.length > 1) this.createMenuTable(message);
        }).catch((err) => Logger.log("ERROR", `${err}`));
    };

    /**
     * @description Отправка сообщения
     * @param interaction
     */
    private prepareChannel = (interaction: Client.interact | Client.message) => {
        try {
            if ("replied" in interaction && !(interaction as any).replied && !this.replied) {
                if (interaction.isRepliable()) return interaction.reply({...this as any, fetchReply: true});
                return interaction.followUp({...this as any, fetchReply: true});
            }
        } catch { /*Значит отправляем другое сообщение*/ }

        return interaction.channel.send({...this as any, fetchReply: true}) as Promise<Client.message>;
    };

    /**
     * @description Создаем меню с объектами
     * @param msg - Сообщение пользователя
     * @return void
     */
    private createMenuTable = (msg: Client.message) => {
        const pages = this.pages;
        let page = this.page;

        msg.createMessageComponentCollector({
            time: 60e3, componentType: 2,
            filter: (click) => click.user.id !== msg.client.user.id
        })
            .on("collect", (i) => {
                //Игнорируем ошибки
                try { i.deferReply(); i.deleteReply(); } catch {}

                //Кнопка отмены и удаления сообщения
                if (i.customId === "cancel") {
                    MessageBuilder.delete = {time: 200, message: msg};
                    return;
                }
                //Если нельзя поменять страницу
                else if (page === pages.length || page < 1) return;

                //Кнопка переключения на предыдущую страницу
                if (i.customId === "back") page--;
                //Кнопка переключения на следующую страницу
                else if (i.customId === "next") page++;

                return this.callback(msg, pages, page, this.embeds);
            });
    };

    /**
     * @description Добавляем embeds в базу для дальнейшей отправки
     * @param data - MessageBuilder["configuration"]["embeds"]
     */
    public addEmbeds = (data: MessageBuilder["embeds"]) => {
        Object.assign(this.embeds, data);

        for (let embed of this.embeds) {
            //Добавляем цвет по-умолчанию
            if (!embed.color) embed.color = 258044;

            //Исправляем fields, ну мало ли
            if (embed.fields?.length > 0) {
                for (const field of embed.fields) {
                    if (field === null) embed.fields = embed.fields.toSpliced(embed.fields.indexOf(field), 1);
                }
            }
        }

        return this;
    };

    /**
     * @description Добавляем время удаления сообщения
     * @param time - Время в миллисекундах
     */
    public setTime = (time: number) => {
      this.time = time;
      return this;
    };

    /**
     * @description Добавляем сomponents в базу для дальнейшей отправки
     * @param data - Компоненты под сообщением
     */
    public addComponents = (data: MessageBuilder["components"]) => {
        Object.assign(this.components, data);
        return this;
    };

    /**
     * @description Добавляем pages в базу для дальнейшей обработки
     * @param list - Список данных для обновления
     */
    public setPages = (list: string[]) => {
        this.pages = list;

        //Добавляем кнопки
        if (this.pages && this.pages.length > 1) this.components = [{
            type: 1, components: [
                {type: 2, emoji: {name: "⬅"}, custom_id: "back", style: 2},
                {type: 2, emoji: {name: "➡"}, custom_id: "next", style: 2},
                {type: 2, emoji: {name: "🗑️"}, custom_id: "cancel", style: 4}
            ]
        }] as any;

        return this;
    };

    /**
     * @description Добавляем функцию для управления данными после отправки
     * @param func - Функция для выполнения после
     */
    public setPromise = (func: MessageBuilder["promise"]) => {
        this.promise = func;
        return this;
    };

    /**
     * @description Добавляем функцию для управления данными после отправки, для menu
     * @param func - Функция для выполнения после
     */
    public setCallback = (func: MessageBuilder["callback"]) => {
        this.callback = func;
        return this;
    };

    /**
     * @description Добавляем функцию для управления данными после отправки, для menu
     * @param value - Был ли ответ на сообщение
     * @default false
     */
    public setReplied = (value: boolean) => {
        this.replied = value;
        return this;
    };

    /**
     * @description Удаление сообщения через указанное время
     * @param options - Параметры для удаления сообщения
     */
    public static set delete(options: { message: Client.message | Client.interact, time?: number }) {
        const {message, time} = options;

        //Удаляем сообщение
        setTimeout(() => {
            if ("deletable" in message && message.deletable) {
                message.delete().catch((err) => Logger.log("WARN", err));
            } else if ("replied" in message && !(message as any).replied) {
                (message)?.deleteReply().catch((err) => Logger.log("WARN", err))
            }
        }, time ?? 15e3);
    };
}

/**
 * @author SNIPPIK
 * @description Создаем простое сообщение для быстрой отправки
 * @class LightMessageBuilder
 */
export class LightMessageBuilder {
    private options: {
        color?: "DarkRed" | "Blue" | "Green" | "Default" | "Yellow" | "Grey" | "Navy" | "Gold" | "Orange" | "Purple" | number,
        codeBlock?: string,
        content: string,
        time?: number,
        replied?: boolean
    } = {
        color: null,
        codeBlock: null,
        content: null,
        replied: null
    };

    public constructor(options: LightMessageBuilder["options"]) {
        Object.assign(this.options, options);
    };

    /**
     * @description Создаем продвинутый класс и отправляем данные туда для дальнейшей обработки
     * @param interaction
     */
    public set send(interaction: Client.interact | Client.message) {
        let text = "";

        if (this.options.codeBlock) {
            if (this.options.color === "DarkRed") text = `⛔️ **Error**\n`;
            else if (this.options.color === "Yellow") text = `⚠️ **Warning**\n`;
        } else {
            if (this.options.color === "DarkRed") text = `⛔️ **Error** | `;
            else if (this.options.color === "Yellow") text = `⚠️ **Warning** | `;
        }

        new MessageBuilder().addEmbeds([
            {
                color: this.parseColor,
                description: text + (this.options.codeBlock ? `\`\`\`${this.options.codeBlock}\n${this.options.content}\n\`\`\`` : this.options.content)
            }
        ]).setReplied(this.options.replied).send = interaction;
    };

    /**
     * @description Получаем цвет, если он есть в параметрах конвертируем в число
     * @private
     */
    private get parseColor() {
        if (!this.options.color) return 258044;
        else if (typeof this.options.color === "number") return this.options.color;
        return Colors[this.options.color] ?? 258044;
    };
}
