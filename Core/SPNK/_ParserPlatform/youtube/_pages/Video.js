"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVideoInfo = void 0;
const decipher_1 = require("../decipher");
const Channel_1 = require("./Channel");
const Utils_1 = require("../Utils");
async function getVideoInfo(url) {
    const video_id = new Utils_1.Utils().getID(url);
    let body = await new Utils_1.Utils().RequestExp(`https://www.youtube.com/watch?v=${video_id}&has_verified=1`);
    if (body.indexOf('Our systems have detected unusual traffic from your computer network.') !== -1)
        throw new Error('Google капча: Google понял что я бот! Это может занять много времени!');
    const player_data = new Utils_1.Utils().FindPlayer(body);
    if (!player_data)
        throw new Error('Данные на странице не были найдены');
    const player_response = JSON.parse(player_data);
    if (player_response.playabilityStatus.status !== 'OK')
        throw new Error(`Что-то пошло не так, не могу получить данные со страницы\n${url}`);
    const html5player = `https://www.youtube.com${body.split('"jsUrl":"')[1].split('"')[0]}`;
    const videoDetails = player_response.videoDetails;
    let format = [];
    const VideoData = {
        id: videoDetails.videoId,
        url: `https://www.youtube.com/watch?v=${videoDetails.videoId}`,
        title: videoDetails.title,
        duration: { seconds: Number(videoDetails.lengthSeconds) },
        thumbnails: videoDetails.thumbnail.thumbnails[videoDetails.thumbnail.thumbnails.length - 1],
        author: await new Channel_1.parseChannelPage().callback({ channelID: videoDetails.channelId }),
        isLive: videoDetails.isLiveContent,
        isPrivate: videoDetails.isPrivate,
    };
    const LiveData = {
        isLive: videoDetails.isLiveContent,
        LiveUrl: player_response.streamingData?.dashManifestUrl || player_response.streamingData?.hlsManifestUrl || null
    };
    let VideoFormats = player_response.streamingData.formats && player_response.streamingData.adaptiveFormats;
    if (VideoFormats[0].signatureCipher || VideoFormats[0].cipher) {
        format = await (0, decipher_1.decipherFormats)(VideoFormats, html5player);
    }
    else {
        format.push(...(VideoFormats ?? []));
    }
    return {
        LiveData,
        html5player,
        format,
        VideoData,
    };
}
exports.getVideoInfo = getVideoInfo;
