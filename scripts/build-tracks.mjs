#!/usr/bin/env node
/**
 * Builds tracks.json from a YouTube playlist.
 *
 * Usage:  node scripts/build-tracks.mjs [playlistId]
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PLAYLIST_ID = process.argv[2] || 'PLeatb7hupNV_AWUl_7ttbsKeCQh8tF5N4';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function initialData(html) {
  const marker = 'var ytInitialData = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('ytInitialData not found — YouTube markup changed');

  let i = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return JSON.parse(html.slice(i, j + 1));
    }
  }
  throw new Error('could not find the end of ytInitialData');
}

function toSeconds(text) {
  if (!text) return 0;
  return text
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);
}

function collectVideos(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectVideos(n, out));
  } else if (node && typeof node === 'object') {
    const v = node.playlistPanelVideoRenderer;
    if (v?.videoId) {
      out.push({
        id: v.videoId,
        title: v.title?.simpleText ?? v.title?.runs?.[0]?.text ?? '',
        artist: v.longBylineText?.runs?.[0]?.text ?? v.shortBylineText?.runs?.[0]?.text ?? '',
        duration: toSeconds(v.lengthText?.simpleText),
      });
    }
    Object.values(node).forEach((n) => collectVideos(n, out));
  }
  return out;
}

const NOISE =
  /\b(official\s+(music\s+)?video|full\s+video\s+song|full\s+audio\s+song|full\s+lyrical|lyrical\s+video|lyrics?\s+video|full\s+video|full\s+song|video\s+song|audio\s+song|lyrical|lyrics|remastered|hd|4k)\b/gi;

const tidy = (s) =>
  s
    .replace(/[|•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:.,]+|[\s\-–—:.,]+$/g, '');

function cleanTitle(raw) {
  let t = raw
    .split('|')[0]
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/^[^:]{0,12}:\s*/, '')
    .replace(NOISE, ' ');

  const head = tidy(tidy(t).split(/\s+[-–—]\s+/)[0]);
  if (head.length >= 8) t = head;

  t = tidy(t);

  const half = Math.floor(t.length / 2);
  if (t.length % 2 === 1 && t.slice(0, half) === t.slice(half + 1)) t = t.slice(0, half);

  return t || tidy(raw);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function lookup(title) {
  const direct = await search(title);
  if (direct) return direct;

  const words = title.split(/\s+/);
  if (words.length <= 4) return null;

  const short = words.slice(0, 4).join(' ');
  return norm(short).length >= 12 ? search(short) : null;
}

async function search(title) {
  const url =
    'https://itunes.apple.com/search?media=music&entity=song&limit=5&country=IN&term=' +
    encodeURIComponent(title);

  let results;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    ({ results } = await res.json());
  } catch {
    return null;
  }
  if (!results?.length) return null;

  const want = norm(title);
  if (want.length < 8) return null;

  const candidates = results.filter((r) => norm(r.trackName || '').startsWith(want));
  if (!candidates.length) return null;

  const REWORK = /\b(banjo|instrumental|karaoke|cover|tribute|mixtape|lo-?fi|flute|sitar)\b/i;
  const sourceIsRework = REWORK.test(title);
  const hit = candidates.find((r) => sourceIsRework || !REWORK.test(r.trackName)) ?? null;
  if (!hit) return null;

  return {
    title: hit.trackName,
    artist: hit.artistName,
    album: hit.collectionName || '',
    cover: (hit.artworkUrl100 || '').replace('100x100bb', '400x400bb') || null,
  };
}

async function isEmbeddable(id) {
  try {
    const html = await get(`https://www.youtube.com/watch?v=${id}`);
    if (/"status":"(UNPLAYABLE|LOGIN_REQUIRED|ERROR)"/.test(html)) return false;
    return /"playableInEmbed":\s*true/.test(html);
  } catch {
    return false;
  }
}

console.log(`Reading playlist ${PLAYLIST_ID} …`);
const page = await get(`https://www.youtube.com/watch?list=${PLAYLIST_ID}`);
const data = initialData(page);

const seen = new Set();
const videos = collectVideos(data).filter((v) => !seen.has(v.id) && seen.add(v.id));

if (!videos.length) {
  console.error('No videos found. Is the playlist public?');
  process.exit(1);
}

console.log(`Found ${videos.length} videos. Checking each is embeddable …\n`);

const tracks = [];
const skipped = [];

for (const [i, v] of videos.entries()) {
  process.stdout.write(`[${i + 1}/${videos.length}] ${v.title.slice(0, 58)} … `);

  if (!(await isEmbeddable(v.id))) {
    console.log('not embeddable, skipped');
    skipped.push(v.title);
    await sleep(150);
    continue;
  }

  const trimmed = cleanTitle(v.title);
  const meta = await lookup(trimmed);

  tracks.push({
    id: v.id,
    title: meta?.title || trimmed,
    artist: meta?.artist || v.artist,
    album: meta?.album || '',
    duration: v.duration,
    cover: meta?.cover || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    rawTitle: v.title,
  });

  console.log(meta ? `ok — ${meta.title} · ${meta.artist}` : `ok — ${trimmed} (no iTunes match)`);
  await sleep(200);
}

await writeFile(join(ROOT, 'tracks.json'), JSON.stringify(tracks, null, 2) + '\n');

console.log(`\nWrote ${tracks.length} tracks to tracks.json`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} non-embeddable:`);
  skipped.forEach((t) => console.log(`  · ${t}`));
}
