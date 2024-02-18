import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
import {ActionMessage, Assign, Event} from "@handler";
import {db} from "@Client/db";

export default class extends Assign<Event<"message/search">> {
    public constructor() {
        super({
            name: "message/search",
            type: "player",
            execute: (tracks, platform, message) => {
                if (tracks?.length < 1 || !tracks) return void (new ActionMessage({
                    content: `${message.author} | Я не смог найти музыку с таким названием. Попробуй другое название!`,
                    color: "DarkRed", message, replied: true
                }));

                new ActionMessage({
                    replied: true, time: 30e3, message, embeds: [{
                        color: Colors.White, timestamp: new Date(),
                        author: {name: message.guild.name, iconURL: db.emojis.diskImage},
                        title: "Вот что мне удалось найти!"
                    }],
                    //Список треков под сообщением
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
        });
    }
};