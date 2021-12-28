"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParsePlaylistPage = void 0;
const Utils_1 = require("../Utils");
const Channel_1 = require("./Channel");
class ParsePlaylistPage {
    constructor() {
        this.run = async (url) => new Utils_1.Utils().RequestExp(url, { headers: { 'accept-language': 'en-US,en-IN;q=0.9,en;q=0.8,hi;q=0.7' } }).then(async (body) => {
            if (body.indexOf('Our systems have detected unusual traffic from your computer network.') !== -1)
                throw new Error('Google капча: Google понял что я бот! Это может занять много времени!');
            let parsed = JSON.parse(`${body.split('{"playlistVideoListRenderer":{"contents":')[1].split('}],"playlistId"')[0]}}]`);
            let playlistDetails = JSON.parse(body.split('{"playlistSidebarRenderer":')[1].split("}};</script>")[0]).items;
            let playlistID = new Utils_1.Utils().getID(url);
            return {
                id: playlistID,
                title: this._playlistTitle(playlistDetails[0].playlistSidebarPrimaryInfoRenderer),
                items: await this._parsePlaylistItem(parsed) ?? [],
                url: `https://www.youtube.com/playlist?list=${playlistID}`,
                author: await new Channel_1.parseChannelPage().callback({ channelId: playlistDetails[1]?.playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer.title.runs[0].navigationEndpoint.browseEndpoint.browseId }),
                thumbnail: this._thumbnail(playlistDetails[0].playlistSidebarPrimaryInfoRenderer)?.split('?sqp=')[0]
            };
        });
        this._playlistTitle = (data) => data.titleForm?.inlineFormRenderer?.textDisplayed?.simpleText === undefined ? 'Not found' : data.titleForm?.inlineFormRenderer?.textDisplayed?.simpleText;
        this._thumbnail = (data) => data.thumbnailRenderer.playlistVideoThumbnailRenderer?.thumbnail.thumbnails.length ? data.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails[data.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails.length - 1].url : null;
        this._parsePlaylistItem = async (parsed) => await Promise.all(parsed.map(async (video) => new _parseVideos()._parse(video.playlistVideoRenderer)));
    }
}
exports.ParsePlaylistPage = ParsePlaylistPage;
class _parseVideos {
    constructor() {
        this._parse = async (video) => !video || !video.isPlayable ? null : this._parseVideo(video);
        this._parseVideo = async (info) => {
            return {
                id: info.videoId,
                title: info.title.runs[0].text,
                url: `https://www.youtube.com/watch?v=${info.videoId}`,
                duration: {
                    seconds: info.lengthSeconds ?? 0
                },
                thumbnails: {
                    url: info.thumbnail.thumbnails[info.thumbnail.thumbnails.length - 1].url,
                    height: info.thumbnail.thumbnails[info.thumbnail.thumbnails.length - 1].height,
                    width: info.thumbnail.thumbnails[info.thumbnail.thumbnails.length - 1].width
                },
                author: {
                    id: info.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.browseId || undefined,
                    title: info.shortBylineText.runs[0].text || undefined,
                    url: `https://www.youtube.com${info.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl || info.shortBylineText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`,
                },
                isLive: undefined,
                isPrivate: info.isPlayable
            };
        };
    }
}
