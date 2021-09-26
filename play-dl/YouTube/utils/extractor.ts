import { request } from './request';
import { format_decipher } from './cipher';
import { Video } from '../classes/Video';
import { PlayList } from '../classes/Playlist';

const DEFAULT_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const video_pattern =
    /^((?:https?:)?\/\/)?(?:(?:www|m)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?$/;
const playlist_pattern = /^((?:https?:)?\/\/)?(?:(?:www|m)\.)?(youtube\.com)\/(?:(playlist|watch))(.*)?((\?|\&)list=)/;

export function yt_validate(url: string): 'playlist' | 'video' | false {
    if (url.indexOf('list=') === -1) {
        if (!url.match(video_pattern)) return false;
        else return 'video';
    } else {
        if (!url.match(playlist_pattern)) return false;
        const Playlist_id = url.split('list=')[1].split('&')[0];
        if (Playlist_id.length !== 34 || !Playlist_id.startsWith('PL')) {
            return false;
        }
        return 'playlist';
    }
}

export function extractID(url: string): string {
    if (url.startsWith('https')) {
        if (url.indexOf('list=') === -1) {
            let video_id: string;
            if (url.includes('youtu.be/')) video_id = url.split('youtu.be/')[1].split('/')[0];
            else if (url.includes('youtube.com/embed/')) video_id = url.split('youtube.com/embed/')[1].split('/')[0];
            else video_id = url.split('watch?v=')[1].split('&')[0];
            return video_id;
        } else {
            return url.split('list=')[1].split('&')[0];
        }
    } else return url;
}

export async function video_basic_info(url: string, cookie?: string) {
    let video_id: string;
    if (url.startsWith('https')) {
        if (yt_validate(url) !== 'video') throw new Error('This is not a YouTube Watch URL');
        video_id = extractID(url);
    } else video_id = url;
    const new_url = `https://www.youtube.com/watch?v=${video_id}`;
    const body = await request(new_url, {
        headers: cookie
            ? {
                  'cookie': cookie,
                  'accept-language': 'en-US,en-IN;q=0.9,en;q=0.8,hi;q=0.7'
              }
            : { 'accept-language': 'en-US,en-IN;q=0.9,en;q=0.8,hi;q=0.7' }
    });
    const player_response = JSON.parse(body.split('var ytInitialPlayerResponse = ')[1].split('}};')[0] + '}}');
    const initial_response = JSON.parse(body.split('var ytInitialData = ')[1].split('}};')[0] + '}}');
    if (player_response.playabilityStatus.status !== 'OK')
        throw new Error(
            `While getting info from url\n${
                player_response.playabilityStatus.errorScreen.playerErrorMessageRenderer?.reason.simpleText ??
                player_response.playabilityStatus.errorScreen.playerKavRenderer?.reason.simpleText
            }`
        );
    const badge =
        initial_response.contents.twoColumnWatchNextResults.results.results.contents[1]?.videoSecondaryInfoRenderer
            ?.owner?.videoOwnerRenderer?.badges &&
        initial_response.contents.twoColumnWatchNextResults.results.results.contents[1]?.videoSecondaryInfoRenderer
            ?.owner?.videoOwnerRenderer?.badges[0];
    const html5player = `https://www.youtube.com${body.split('"jsUrl":"')[1].split('"')[0]}`;
    const related: any[] = [];
    initial_response.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results.forEach(
        (res: any) => {
            if (res.compactVideoRenderer)
                related.push(`https://www.youtube.com/watch?v=${res.compactVideoRenderer.videoId}`);
        }
    );
    const format = [];
    const vid = player_response.videoDetails;
    const microformat = player_response.microformat.playerMicroformatRenderer;
    const video_details = {
        id: vid.videoId,
        url: `https://www.youtube.com/watch?v=${vid.videoId}`,
        title: vid.title,
        description: vid.shortDescription,
        durationInSec: vid.lengthSeconds,
        durationRaw: parseSeconds(vid.lengthSeconds),
        uploadedDate: microformat.publishDate,
        thumbnail: vid.thumbnail.thumbnails[vid.thumbnail.thumbnails.length - 1],
        channel: {
            name: vid.author,
            id: vid.channelId,
            url: `https://www.youtube.com/channel/${vid.channelId}`,
            verified: Boolean(badge?.metadataBadgeRenderer?.style?.toLowerCase().includes('verified'))
        },
        views: vid.viewCount,
        tags: vid.keywords,
        averageRating: vid.averageRating,
        live: vid.isLiveContent,
        private: vid.isPrivate
    };
    format.push(...(player_response.streamingData.formats ?? []));
    format.push(...(player_response.streamingData.adaptiveFormats ?? []));
    const LiveStreamData = {
        isLive: video_details.live,
        dashManifestUrl: player_response.streamingData?.dashManifestUrl ?? null,
        hlsManifestUrl: player_response.streamingData?.hlsManifestUrl ?? null
    };
    return {
        LiveStreamData,
        html5player,
        format,
        video_details,
        related_videos: related
    };
}

function parseSeconds(seconds: number): string {
    const d = Number(seconds);
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);

    const hDisplay = h > 0 ? (h < 10 ? `0${h}` : h) + ':' : '';
    const mDisplay = m > 0 ? (m < 10 ? `0${m}` : m) + ':' : '00:';
    const sDisplay = s > 0 ? (s < 10 ? `0${s}` : s) : '00';
    return hDisplay + mDisplay + sDisplay;
}

export async function video_info(url: string, cookie?: string) {
    const data = await video_basic_info(url, cookie);
    if (data.LiveStreamData.isLive === true && data.LiveStreamData.hlsManifestUrl !== null) {
        return data;
    } else if (data.format[0].signatureCipher || data.format[0].cipher) {
        data.format = await format_decipher(data.format, data.html5player);
        return data;
    } else {
        return data;
    }
}

export async function playlist_info(url: string, parseIncomplete = false) {
    if (!url || typeof url !== 'string') throw new Error(`Expected playlist url, received ${typeof url}!`);
    let Playlist_id: string;
    if (url.startsWith('https')) {
        if (yt_validate(url) !== 'playlist') throw new Error('This is not a Playlist URL');
        Playlist_id = extractID(url);
    } else Playlist_id = url;
    const new_url = `https://www.youtube.com/playlist?list=${Playlist_id}`;

    const body = await request(new_url, {
        headers: { 'accept-language': 'en-US,en-IN;q=0.9,en;q=0.8,hi;q=0.7' }
    });
    const response = JSON.parse(body.split('var ytInitialData = ')[1].split(';</script>')[0]);
    if (response.alerts) {
        if (response.alerts[0].alertWithButtonRenderer?.type === 'INFO') {
            if (!parseIncomplete)
                throw new Error(
                    `While parsing playlist url\n${response.alerts[0].alertWithButtonRenderer.text.simpleText}`
                );
        } else if (response.alerts[0].alertRenderer?.type === 'ERROR')
            throw new Error(`While parsing playlist url\n${response.alerts[0].alertRenderer.text.runs[0].text}`);
        else throw new Error('While parsing playlist url\nUnknown Playlist Error');
    }

    const rawJSON = `${body.split('{"playlistVideoListRenderer":{"contents":')[1].split('}],"playlistId"')[0]}}]`;
    const parsed = JSON.parse(rawJSON);
    const playlistDetails = JSON.parse(body.split('{"playlistSidebarRenderer":')[1].split('}};</script>')[0]).items;

    const API_KEY =
        body.split('INNERTUBE_API_KEY":"')[1]?.split('"')[0] ??
        body.split('innertubeApiKey":"')[1]?.split('"')[0] ??
        DEFAULT_API_KEY;
    const videos = getPlaylistVideos(parsed, 100);

    const data = playlistDetails[0].playlistSidebarPrimaryInfoRenderer;
    if (!data.title.runs || !data.title.runs.length) return undefined;

    const author = playlistDetails[1]?.playlistSidebarSecondaryInfoRenderer.videoOwner;
    const views = data.stats.length === 3 ? data.stats[1].simpleText.replace(/[^0-9]/g, '') : 0;
    const lastUpdate =
        data.stats
            .find((x: any) => 'runs' in x && x['runs'].find((y: any) => y.text.toLowerCase().includes('last update')))
            ?.runs.pop()?.text ?? null;
    const videosCount = data.stats[0].runs[0].text.replace(/[^0-9]/g, '') || 0;

    const res = new PlayList({
        continuation: {
            api: API_KEY,
            token: getContinuationToken(parsed),
            clientVersion:
                body.split('"INNERTUBE_CONTEXT_CLIENT_VERSION":"')[1]?.split('"')[0] ??
                body.split('"innertube_context_client_version":"')[1]?.split('"')[0] ??
                '<some version>'
        },
        id: data.title.runs[0].navigationEndpoint.watchEndpoint.playlistId,
        title: data.title.runs[0].text,
        videoCount: parseInt(videosCount) || 0,
        lastUpdate: lastUpdate,
        views: parseInt(views) || 0,
        videos: videos,
        url: `https://www.youtube.com/playlist?list=${data.title.runs[0].navigationEndpoint.watchEndpoint.playlistId}`,
        link: `https://www.youtube.com${data.title.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`,
        author: author
            ? {
                  name: author.videoOwnerRenderer.title.runs[0].text,
                  id: author.videoOwnerRenderer.title.runs[0].navigationEndpoint.browseEndpoint.browseId,
                  url: `https://www.youtube.com${
                      author.videoOwnerRenderer.navigationEndpoint.commandMetadata.webCommandMetadata.url ||
                      author.videoOwnerRenderer.navigationEndpoint.browseEndpoint.canonicalBaseUrl
                  }`,
                  icon: author.videoOwnerRenderer.thumbnail.thumbnails.length
                      ? author.videoOwnerRenderer.thumbnail.thumbnails[
                            author.videoOwnerRenderer.thumbnail.thumbnails.length - 1
                        ].url
                      : null
              }
            : {},
        thumbnail: data.thumbnailRenderer.playlistVideoThumbnailRenderer?.thumbnail.thumbnails.length
            ? data.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails[
                  data.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails.length - 1
              ].url
            : null
    });
    return res;
}

export function getPlaylistVideos(data: any, limit = Infinity): Video[] {
    const videos = [];

    for (let i = 0; i < data.length; i++) {
        if (limit === videos.length) break;
        const info = data[i].playlistVideoRenderer;
        if (!info || !info.shortBylineText) continue;

        videos.push(
            new Video({
                id: info.videoId,
                index: parseInt(info.index?.simpleText) || 0,
                duration: parseDuration(info.lengthText?.simpleText) || 0,
                duration_raw: info.lengthText?.simpleText ?? '0:00',
                thumbnail: {
                    id: info.videoId,
                    url: info.thumbnail.thumbnails[info.thumbnail.thumbnails.length - 1].url,
                    height: info.thumbnail.thumbnails[info.thumbnail.thumbnails.length - 1].height,
                    width: info.thumbnail.thumbnails[info.thumbnail.thumbnails.length - 1].width
                },
                title: info.title.runs[0].text,
                channel: {
                    id: info.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.browseId || undefined,
                    name: info.shortBylineText.runs[0].text || undefined,
                    url: `https://www.youtube.com${
                        info.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl ||
                        info.shortBylineText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url
                    }`,
                    icon: undefined
                }
            })
        );
    }
    return videos;
}

function parseDuration(duration: string): number {
    duration ??= '0:00';
    const args = duration.split(':');
    let dur = 0;

    switch (args.length) {
        case 3:
            dur = parseInt(args[0]) * 60 * 60 + parseInt(args[1]) * 60 + parseInt(args[2]);
            break;
        case 2:
            dur = parseInt(args[0]) * 60 + parseInt(args[1]);
            break;
        default:
            dur = parseInt(args[0]);
    }

    return dur;
}

export function getContinuationToken(data: any): string {
    const continuationToken = data.find((x: any) => Object.keys(x)[0] === 'continuationItemRenderer')
        ?.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
    return continuationToken;
}
