"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectorSortReaction = void 0;
const FullTimeSongs_1 = require("../../Modules/Music/src/Manager/Functions/FullTimeSongs");
class CollectorSortReaction {
    constructor() {
        this._run = async (embed, pages, page, message, EnableQueue) => message.channel.send(typeof embed === "string" ? embed : { embeds: [embed] }).then(async (msg) => {
            let user = message.author, queue = message.client.queue.get(message.guild.id);
            setTimeout(async () => msg.delete().catch(() => null), 120000);
            let type = await this._type(embed, page, pages, queue, EnableQueue);
            return (await this._reaction(user, message, msg, type.back, "⬅️"), await this._reaction(user, message, msg, type.cancel, "❌"), await this._reaction(user, message, msg, type.up, "➡️"));
        });
        this._callback_string = async (page, pages, queue) => {
            return {
                back: async ({ users }, user, message, msg) => {
                    await users.remove(user);
                    return setTimeout(async () => {
                        if (page === 1)
                            return null;
                        page--;
                        return msg.edit(`\`\`\`css\n➡️ | Current playing [${queue.songs[0].title}]\n\n${pages[page - 1]}\n\n${message.author.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(queue)} | Лист ${page} из ${pages.length} | Songs: ${queue.songs.length}\`\`\``);
                    }, 150);
                },
                cancel: async (reaction, user, message, msg) => setTimeout(async () => (await this.DeleteMessage(msg), await this.DeleteMessage(message)), 50),
                up: async ({ users }, user, message, msg) => {
                    await users.remove(user);
                    return setTimeout(async () => {
                        if (page === pages.length)
                            return null;
                        page++;
                        return msg.edit(`\`\`\`css\n➡️ | Current playing [${queue.songs[0].title}]\n\n${pages[page - 1]}\n\n${message.author.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(queue)} | Лист ${page} из ${pages.length} | Songs: ${queue.songs.length}\`\`\``);
                    }, 150);
                }
            };
        };
        this._callbacks_embed = async (page, pages, embed, queue, EnableQueue) => {
            return {
                back: async ({ users }, user, message, msg) => {
                    await users.remove(user);
                    return setTimeout(async () => {
                        if (page === 1)
                            return null;
                        page--;
                        embed.setDescription(pages[page - 1]);
                        if (EnableQueue)
                            embed.setFooter(`${message.author.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(queue)} | Лист ${page} из ${pages.length}`, message.author.displayAvatarURL());
                        else
                            embed.setFooter(`${message.author.username} | Лист ${page} из ${pages.length}`, message.author.displayAvatarURL());
                        return msg.edit({ embeds: [embed] });
                    }, 150);
                },
                cancel: async (reaction, user, message, msg) => setTimeout(async () => (await this.DeleteMessage(msg), await this.DeleteMessage(message)), 50),
                up: async ({ users }, user, message, msg) => {
                    await users.remove(user);
                    return setTimeout(async () => {
                        if (page === pages.length)
                            return null;
                        page++;
                        embed.setDescription(pages[page - 1]);
                        if (EnableQueue)
                            embed.setFooter(`${message.author.username} | ${(0, FullTimeSongs_1.FullTimeSongs)(queue)} | Лист ${page} из ${pages.length}`, message.author.displayAvatarURL());
                        else
                            embed.setFooter(`${message.author.username} | Лист ${page} из ${pages.length}`, message.author.displayAvatarURL());
                        return msg.edit({ embeds: [embed] });
                    }, 150);
                }
            };
        };
        this._type = async (embed, page, pages, queue, EnableQueue) => typeof embed === "string" ? this._callback_string(page, pages, queue) : this._callbacks_embed(page, pages, embed, queue, EnableQueue);
        this._reaction = async (user, message, msg, callback, emoji) => msg.react(emoji).then(async () => msg.createReactionCollector({ filter: async (reaction, user) => this._filter(emoji, reaction, user, message) })
            .on('collect', async (reaction) => callback(reaction, user, message, msg))).catch(() => undefined);
        this._filter = (emoji, reaction, user, message) => (reaction.emoji.name === emoji && user.id !== message.client.user.id);
        this.DeleteMessage = (msg) => msg.delete().catch(() => null);
    }
}
exports.CollectorSortReaction = CollectorSortReaction;
