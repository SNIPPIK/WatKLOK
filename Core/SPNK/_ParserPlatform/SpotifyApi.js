"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fetch_1 = __importDefault(require("node-fetch"));
const ApiLink = "https://accounts.spotify.com/api";
const GetApi = "https://api.spotify.com/v1";
const SpotifyStr = /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi;
let clientID, clientSecret;
class SpotifyApi {
    constructor() {
        this.Settings = (ClientID, ClientSecret) => {
            clientID = ClientID;
            clientSecret = ClientSecret;
        };
        this.getTrack = async (url) => {
            const id = this.getID(url);
            const result = await this.AutoLogin(`${GetApi}/tracks/${id}`);
            if (result?.error)
                return null;
            return {
                id: result.id,
                title: `${result.artists[0].name} - ${result.name}`,
                url: `https://open.spotify.com/track/${result.id}`,
                author: await this.getAuthorTrack(`https://open.spotify.com/artist/${result.artists[0].id}`),
                duration: {
                    seconds: result.duration_ms / 1000
                },
                thumbnails: result.album.images[0],
                isValid: true,
                PrevFile: result.preview_url
            };
        };
        this.getPlaylistTracks = async (url) => {
            try {
                const id = this.getID(url);
                const result = await this.AutoLogin(`${GetApi}/playlists/${id}`);
                return {
                    id: id,
                    url: `https://open.spotify.com/playlist/${id}`,
                    title: result.name,
                    items: await Promise.all(result.tracks.items.map(async ({ track }) => {
                        return {
                            id: track.id,
                            title: `${track.artists[0].name} - ${track.name}`,
                            url: `https://open.spotify.com/track/${track.id}`,
                            author: await this.getAuthorTrack(`https://open.spotify.com/artist/${track.artists[0].id}`),
                            duration: {
                                seconds: track.duration_ms / 1000
                            },
                            thumbnails: track.album.images[0],
                            isValid: true,
                            PrevFile: track.preview_url
                        };
                    })),
                    thumbnails: result.images[0],
                    author: await this.getAuthorTrack(`https://open.spotify.com/artist/${result.owner.id}`, true)
                };
            }
            catch (e) {
                console.log(e);
                return null;
            }
        };
        this.getAuthorTrack = async (url, isUser = false) => {
            const id = this.getID(url);
            const result = await this.AutoLogin(`${GetApi}/${isUser ? "users" : "artists"}/${id}`);
            return {
                id: result.id,
                title: result.name || result.display_name,
                url: url,
                thumbnails: result.images[0],
                isVerified: result.followers.total > 2e3
            };
        };
        this.getToken = async () => {
            const body = new URLSearchParams();
            body.append('grant_type', 'client_credentials');
            const response = await (0, node_fetch_1.default)(`${ApiLink}/token`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + this.encode(clientID + ':' + clientSecret)
                }, body
            });
            const result = await response.json();
            this.TokenTime = Date.now() + result['expires_in'];
            this.ClientToken = result['access_token'];
        };
        this.AutoLogin = async (url) => {
            await this.login();
            const response = await (0, node_fetch_1.default)(url, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + this.ClientToken
                }
            });
            return await response.json();
        };
        this.login = async () => !this.isLoggedIn() ? await this.getToken() : null;
        this.isLoggedIn = () => this.ClientToken !== undefined && this.TokenTime > Date.now() + 2;
        this.encode = (str) => Buffer.from(str).toString('base64');
        this.getID = (url) => {
            if (!url.match(SpotifyStr))
                return undefined;
            if (typeof url !== 'string')
                return undefined;
            return new URL(url).pathname.split('/')[2];
        };
    }
}
exports.default = SpotifyApi;
