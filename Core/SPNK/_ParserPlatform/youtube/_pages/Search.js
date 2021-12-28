"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchVideo = void 0;
const Utils_1 = require("../Utils");
class SearchVideo {
    constructor() {
        this.FindVideo = (search, options = {}) => new Utils_1.Utils().RequestExp('https://www.youtube.com/results?search_query=' + search.replaceAll(' ', '+'), { headers: { 'accept-language': 'en-US,en-IN;q=0.9,en;q=0.8,hi;q=0.7' } }).then(async (body) => !body ? { error: true, message: 'Not found info page' } : await this.Parser(body, options));
        this.Parser = async (html, options = { limit: 15 }) => {
            if (html.indexOf('Our systems have detected unusual traffic from your computer network.') !== -1)
                throw new Error('Google капча: Google понял что я бот! Это может занять много времени!');
            let details = JSON.parse((html.split("var ytInitialData = ")[1].split("}};")[0] + '}}').split(';</script><script')[0]).contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
            return this.PushVideos(details, options);
        };
        this.PushVideos = async (details, options, base = []) => {
            let num = 0;
            for (let i = 0; i < details.length; i++) {
                if (this._Limiter(num, options.limit))
                    break;
                if (this._NotVideo(details, i))
                    continue;
                num++;
                base.push(await this._push(details[i]));
            }
            return base;
        };
        this._push = async (data) => new ParseVideo(data.videoRenderer, data.videoRenderer.ownerBadges && data.videoRenderer.ownerBadges[0]);
        this._Limiter = (i, limit) => i >= limit;
        this._NotVideo = (video, i) => !video[i] || !video[i].videoRenderer;
    }
}
exports.SearchVideo = SearchVideo;
class ParseVideo {
    constructor(data, badge) {
        this._parseAuthor = (data, badge) => {
            return {
                id: data.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId,
                title: data.ownerText.runs[0].text,
                url: this._url(data),
                thumbnails: this._parseAuthorThumbnails(data),
                isVerified: this._isVerified(badge)
            };
        };
        this._url = (data) => `https://www.youtube.com${data.ownerText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl || data.ownerText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`;
        this._isVerified = (badge) => badge?.metadataBadgeRenderer?.tooltip === 'Verified' || badge?.metadataBadgeRenderer?.tooltip === 'Official Artist Channel';
        this._parseAuthorThumbnails = (data) => {
            return {
                url: data.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail.thumbnails[0].url,
                width: data.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail.thumbnails[0].width,
                height: data.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail.thumbnails[0].height
            };
        };
        this.id = data.videoId;
        this.url = `https://www.youtube.com/watch?v=${data.videoId}`;
        this.title = data.title.runs[0].text;
        this.thumbnail = data.thumbnail.thumbnails[data.thumbnail.thumbnails.length - 1];
        this.author = this._parseAuthor(data, badge);
        this.duration = data.lengthText ? data.lengthText.simpleText : null;
        this.isLive = !data.lengthText;
    }
    ;
}
