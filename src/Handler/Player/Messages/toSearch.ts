import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
import {ClientMessage} from "@handler/Events/Client/interactionCreate";
import {Song} from "@Client/Audio/Queue/Song";
import {env} from "@env";
import {db} from "@Client/db";
import {ActionMessage} from "@Client";

/**
 * @author SNIPPIK
 * @description Локальная база
 */
const local_db = {
    image_disk: env.get("image.currentPlay")
};

export default (tracks: Song[], platform: string, message: ClientMessage) => {
    if (tracks?.length < 1 || !tracks) return void (new ActionMessage({
        content: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`,
        color: "DarkRed", message, replied: true
    }));

    new ActionMessage({
        replied: true, time: 30e3, message,
        //Сообщение
        embeds: [{
            color: Colors.White, timestamp: new Date(),
            author: {name: message.guild.name, iconURL: local_db.image_disk},
            title: "Вот что мне удалось найти!"
        }],

        //Треки под сообщением
        components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("menu-builder").setPlaceholder("Найденные треки")
            .setOptions(...tracks.map((track) => {
                    return {
                        label: `${track.title}`,
                        description: `${track.author.title} | ${track.duration.full}`,
                        value: track.url
                    }
                }), {label: "Отмена", value: "stop"}
            )
        )],

        //Действия после сообщения
        promise: (msg) => {
            //Создаем сборщик
            const collector = msg.createMessageComponentCollector({
                filter: (interaction) => !interaction.user.bot,
                time: 30e3,
                max: 1
            });

            //Что будет делать сборщик после выбора трека
            collector.once("collect", (interaction: any) => {
                const id = interaction.values[0];

                if (id && id !== "stop") {
                    //Ищем команду и выполняем ее
                    const command = db.commands.get("play").execute(message, [platform, id]);
                    if (command) {
                        if ((command instanceof Promise)) command.then((d) => new ActionMessage({...d, message}));
                        else new ActionMessage({...command, message});
                    }
                }

                interaction?.deferReply();
                interaction?.deleteReply();

                //Удаляем данные
                ActionMessage.delete = {message: msg};
                collector.stop();
            });
        }
    });
}