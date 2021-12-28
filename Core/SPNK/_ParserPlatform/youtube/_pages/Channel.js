"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChannelPage = void 0;
const https_1 = require("../https");
class parseChannelPage {
    constructor() {
        this.callback = async (base) => new https_1.httpsClient(`https://www.youtube.com/channel/${base.channelId || base.channelID}/channels?flow=grid&view=0&pbj=1`)._parseToJson({ cookie: false }).then(async (channel) => {
            if (channel.error || typeof channel === "string")
                return this.IfError(base);
            let data = channel[1]?.response || null;
            return this.Out(data);
        });
        this.Out = async (data) => {
            let channelMetaData = data.metadata.channelMetadataRenderer, channelHeaderData = data.header.c4TabbedHeaderRenderer;
            return {
                id: channelMetaData.externalId,
                title: channelMetaData.title,
                url: channelMetaData.vanityChannelUrl,
                thumbnails: channelHeaderData.avatar.thumbnails[2] ?? channelHeaderData.avatar.thumbnails[1] ?? channelHeaderData.avatar.thumbnails[0],
                isVerified: !!channelHeaderData.badges?.find((badge) => badge.metadataBadgeRenderer.tooltip === 'Verified' || badge.metadataBadgeRenderer.tooltip === 'Official Artist Channel'),
            };
        };
        this.IfError = (base) => {
            return {
                id: base.channelId || base.channelID || "No found id",
                title: base.author || base.name || "No found name",
                url: `https://www.youtube.com/channel/${base.channelId || base.channelID || ""}`,
                thumbnails: {
                    url: null,
                    width: 0,
                    height: 0
                },
                isVerified: undefined
            };
        };
    }
}
exports.parseChannelPage = parseChannelPage;
