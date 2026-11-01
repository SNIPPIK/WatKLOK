import { createEvent } from 'seyfert';
import { db } from "#db";

export default createEvent({
    data: { name: 'voiceServerUpdate' },
    run(packet) {
        return db.adapter.onVoiceServer({...packet, guild_id: packet.guildId});
    }
});