"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceManager = void 0;
const voice_1 = require("@discordjs/voice");
class VoiceManager {
    constructor() {
        this.getVoice = (GuildID) => (0, voice_1.getVoiceConnection)(GuildID);
        this.Join = (VoiceChannel, options) => {
            this.SpeakStateChannel(VoiceChannel.guild, VoiceChannel.type);
            const { id, guild } = VoiceChannel;
            return (0, voice_1.getVoiceConnection)(id) ?? (0, voice_1.joinVoiceChannel)({
                channelId: id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: options?.mute
            });
        };
        this.Disconnect = (GuildID) => {
            const connection = (0, voice_1.getVoiceConnection)(GuildID);
            if (connection)
                return connection.destroy();
            return null;
        };
        this.SpeakStateChannel = (guild, type) => {
            if (type === 'GUILD_STAGE_VOICE' && guild.me)
                guild.me.voice.setRequestToSpeak(true).catch(() => undefined);
        };
    }
}
exports.VoiceManager = VoiceManager;
