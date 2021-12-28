"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const CustomID = new Set(['skip', 'resume', 'pause', 'replay']);
class SlashCommand {
    constructor() {
        this.run = async (interaction, f2, client) => {
            await this.DeleteInteraction(interaction);
            await this.editInteraction(interaction);
            if (interaction.isCommand())
                return this.runCommand(interaction, client);
            else if (CustomID.has(interaction.customId) && client.queue.get(interaction.guildId))
                return this.ButtonsMessage(interaction, client);
        };
        this.editInteraction = async (interaction) => {
            interaction.author = interaction.member.user;
            interaction.delete = async () => null;
        };
        this.runCommand = async (interaction, client) => {
            let cmd = await this._getCommand(client, interaction.commandName);
            if (cmd)
                return cmd.run(interaction, this._parseArgs(interaction));
            return this.DeleteIntegrationCommand(client, interaction);
        };
        this.ButtonsMessage = async (interaction, client) => {
            if (!interaction.member.voice.channel)
                return;
            return this.SkipPause(interaction.customId, client, interaction);
        };
        this._getCommand = (client, name) => client.commands.get(name);
        this.DeleteInteraction = async (interaction) => setTimeout(async () => {
            interaction.deleteReply().catch(() => null);
            interaction.deferReply().catch(() => null);
        }, 200);
        this._parseArgs = (interaction) => interaction.options._hoistedOptions.map((f) => f.value) || '';
        this.DeleteIntegrationCommand = (client, interaction) => interaction.commandId ? client.application?.commands.delete(interaction.commandId) : null;
        this.SkipPause = async (type, client, interaction) => {
            if (type === 'skip')
                return this._getCommand(client, 'skip').run(interaction, []);
            else if (type === 'pause')
                return this._getCommand(client, 'pause').run(interaction, []);
            return this.ResumeReplay(type, client, interaction);
        };
        this.ResumeReplay = async (type, client, interaction) => {
            if (type === 'resume')
                return this._getCommand(client, 'resume').run(interaction, []);
            else if (type === 'replay')
                return this._getCommand(client, 'replay').run(interaction, []);
        };
        this.name = "interactionCreate";
        this.enable = true;
    }
}
exports.default = SlashCommand;
