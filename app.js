/* ─────────────────────────────────────────────────────────────
   Barber Wala
   YouTube iframe under the hood; everything visible is our chrome.
   ───────────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);

const el = {
  player: $('player'),
  cover: $('cover'),
  title: $('title'),
  artist: $('artist'),
  seek: $('seek'),
  seekFill: $('seekFill'),
  seekKnob: $('seekKnob'),
  tCur: $('tCur'),
  tDur: $('tDur'),
  play: $('play'),
  prev: $('prev'),
  next: $('next'),
  shuffle: $('shuffle'),
  listBtn: $('listBtn'),
  list: $('list'),
  listItems: $('listItems'),
  clock: $('clock'),
  listeners: $('listeners'),
  mirrorText: $('mirrorText'),
  mirrorNext: $('mirrorNext'),
  snip: $('snip'),
  main: document.querySelector('main'),
};

const state = {
  tracks: [],
  order: [],
  pos: 0,
  shuffle: true,
  ready: false,
  playing: false,
  started: false,
  scrubbing: false,
};

let yt = null;

const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildOrder() {
  const seq = Array.from({ length: state.tracks.length }, (_, i) => i);
  return state.shuffle ? shuffle(seq) : seq;
}

const currentTrack = () => state.tracks[state.order[state.pos]];

let swapTimer = null;

function renderTrack() {
  const t = currentTrack();
  if (!t) return;

  if (el.title.dataset.rendered) {
    el.player.classList.add('is-swapping');
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => el.player.classList.remove('is-swapping'), 40);
  }
  el.title.dataset.rendered = '1';

  el.title.textContent = t.title;
  el.artist.textContent = t.artist || t.rawTitle || '';
  el.cover.src = t.cover || '';
  el.cover.alt = `${t.title} artwork`;
  el.cover.classList.toggle('is-letterboxed', (t.cover || '').includes('ytimg.com'));
  if (state.started) document.title = `${t.title} — Sargam Nai Wala`;

  [...el.listItems.children].forEach((li, i) =>
    li.classList.toggle('is-current', i === state.pos),
  );
  const active = el.listItems.children[state.pos];
  if (active && el.list.classList.contains('is-open')) {
    active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function renderList() {
  el.listItems.innerHTML = '';
  state.order.forEach((trackIdx, i) => {
    const t = state.tracks[trackIdx];
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';

    const title = document.createElement('span');
    title.className = 't-title';
    title.textContent = t.title;

    const artist = document.createElement('span');
    artist.className = 't-artist';
    artist.textContent = t.artist || '';

    btn.append(title, artist);
    btn.addEventListener('click', () => go(i));
    li.append(btn);
    el.listItems.append(li);
  });
}

const bgLayers = [...document.querySelectorAll('.bg__layer')];
let bgIndex = 0;

function deferSecondBackground() {
  const arm = () => bgLayers.slice(1).forEach((l) => l.classList.add('is-armed'));
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  if (document.readyState === 'complete') idle(arm);
  else window.addEventListener('load', () => idle(arm), { once: true });
}

function rotateBackground(to) {
  if (bgLayers.length < 2) return;
  const n = bgLayers.length;
  bgIndex = (((to ?? bgIndex + 1) % n) + n) % n;
  bgLayers[bgIndex].classList.add('is-armed');
  bgLayers.forEach((layer, i) => layer.classList.toggle('is-active', i === bgIndex));
}

function renderPlaying(on) {
  state.playing = on;
  el.player.classList.toggle('is-playing', on);
  el.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

function go(newPos) {
  const n = state.order.length;
  state.pos = ((newPos % n) + n) % n;
  renderTrack();
  rotateBackground();
  if (!yt) return;
  state.started = true;
  yt.loadVideoById(currentTrack().id);
}

function toggle() {
  if (!yt || !state.ready) return;
  if (state.playing) {
    yt.pauseVideo();
  } else {
    state.started = true;
    yt.playVideo();
  }
}

const poll = { at: 0, time: 0, duration: 0 };
let lastSecond = -1;
let lastDuration = -1;

function samplePlayer() {
  if (!yt || typeof yt.getCurrentTime !== 'function') return;
  poll.time = yt.getCurrentTime() || 0;
  poll.duration = yt.getDuration() || 0;
  poll.at = performance.now();
}

function paintProgress() {
  requestAnimationFrame(paintProgress);
  if (!yt || state.scrubbing || !poll.duration) return;

  const drift = state.playing ? (performance.now() - poll.at) / 1000 : 0;
  const cur = Math.min(poll.duration, poll.time + drift);
  const frac = Math.min(1, Math.max(0, cur / poll.duration));

  el.seekFill.style.transform = `scaleX(${frac})`;
  el.seekKnob.style.transform = `translate(-50%, -50%) translateX(${
    frac * el.seek.clientWidth
  }px)`;

  const second = Math.floor(cur);
  if (second !== lastSecond) {
    lastSecond = second;
    el.tCur.textContent = fmt(cur);
    el.seek.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  }
  if (poll.duration !== lastDuration) {
    lastDuration = poll.duration;
    el.tDur.textContent = fmt(poll.duration);
  }
}

function fractionFromEvent(e) {
  const r = el.seek.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
}

function previewSeek(frac) {
  el.seekFill.style.transform = `scaleX(${frac})`;
  el.seekKnob.style.transform = `translate(-50%, -50%) translateX(${
    frac * el.seek.clientWidth
  }px)`;
  if (yt && typeof yt.getDuration === 'function') {
    el.tCur.textContent = fmt((yt.getDuration() || 0) * frac);
  }
}

el.seek.addEventListener('pointerdown', (e) => {
  if (!yt) return;
  state.scrubbing = true;
  el.seek.setPointerCapture(e.pointerId);
  previewSeek(fractionFromEvent(e));
});

el.seek.addEventListener('pointermove', (e) => {
  if (state.scrubbing) previewSeek(fractionFromEvent(e));
});

el.seek.addEventListener('pointerup', (e) => {
  if (!state.scrubbing) return;
  state.scrubbing = false;
  el.seek.releasePointerCapture(e.pointerId);
  const dur = yt?.getDuration?.() || 0;
  if (dur) yt.seekTo(dur * fractionFromEvent(e), true);
  samplePlayer();
});

el.seek.addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
  if (!step || !yt) return;
  e.preventDefault();
  yt.seekTo(Math.max(0, (yt.getCurrentTime() || 0) + step), true);
});

el.play.addEventListener('click', toggle);
el.prev.addEventListener('click', () => {
  if (yt && (yt.getCurrentTime() || 0) > 3) yt.seekTo(0, true);
  else go(state.pos - 1);
});
el.next.addEventListener('click', () => go(state.pos + 1));

el.shuffle.addEventListener('click', () => {
  const keep = currentTrack();
  state.shuffle = !state.shuffle;
  el.shuffle.classList.toggle('is-on', state.shuffle);
  el.shuffle.setAttribute('aria-pressed', String(state.shuffle));

  state.order = buildOrder();
  state.pos = Math.max(0, state.order.indexOf(state.tracks.indexOf(keep)));
  renderList();
  renderTrack();
});

el.listBtn.addEventListener('click', () => {
  const open = !el.list.classList.contains('is-open');
  el.list.classList.toggle('is-open', open);
  el.listBtn.classList.toggle('is-on', open);
  el.listBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    el.listItems.children[state.pos]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, [contenteditable]')) return;
  if (e.key === ' ' || e.key === 'k') {
    e.preventDefault();
    toggle();
  } else if (e.key === 'n' || e.key === 'ArrowRight') {
    if (e.target !== el.seek) go(state.pos + 1);
  } else if (e.key === 'p' || e.key === 'ArrowLeft') {
    if (e.target !== el.seek) go(state.pos - 1);
  } else if (e.key === 's') {
    doSnip();
  }
});

/* ── Scissors snip (Web Audio synthesis) ─────────────────────── */

let audioCtx = null;

try {
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
} catch {
  /* not supported */
}

function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function primeAudio() {
  ensureAudio();
}

['pointerdown', 'keydown'].forEach((evt) =>
  document.addEventListener(evt, primeAudio, { once: true, capture: true }),
);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audioCtx?.state === 'suspended') audioCtx.resume();
});

/** Two metallic snips — high-pass noise bursts through a bandpass. */
function playSnipSound(ctx) {
  const now = ctx.currentTime;

  [0, 0.09].forEach((offset) => {
    const dur = 0.06;
    const bufferSize = Math.ceil(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200 + offset * 800;
    filter.Q.value = 2.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + dur);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now + offset);
    source.stop(now + offset + dur);
  });
}

let duckTimer = null;
let duckedFrom = null;

function duckMusic(ms) {
  if (!yt || typeof yt.getVolume !== 'function') return;
  if (duckedFrom === null) duckedFrom = yt.getVolume();
  yt.setVolume(Math.round(duckedFrom * 0.45));

  clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    if (duckedFrom !== null) yt.setVolume(duckedFrom);
    duckedFrom = null;
  }, ms + 100);
}

function doSnip() {
  const ctx = ensureAudio();
  if (!ctx) return;

  playSnipSound(ctx);
  duckMusic(180);

  [
    [el.snip, 'is-snipping', 380],
    [el.main, 'is-shaking', 520],
  ].forEach(([node, cls, ms]) => {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), ms);
  });
}

el.snip.addEventListener('click', doSnip);

/* ── Mirror slogans — barber shop banter ─────────────────────── */

const MIRROR_LINES = [
  'भैया थोड़ा साइड से',
  'ऊपर से पतला',
  'पीछे से भी सेम',
  'दाढ़ी भी साफ',
  'सिर्फ ₹50',
  'शेव भी होगा',
  'फेस वॉश फ्री',
  'मूंछ की लाइन साफ',
  'गर्दन पे ध्यान से',
  'बच्चों का बाल मत काटना',
  'लाइन लगाओ भाई',
  'अगला नंबर किसका है',
  'इधर आओ, कुर्सी खाली है',
  'स्टाइल तो बाज़ार में मिलती है, कलाकार यहीं बैठता है',
  'एक नंबर कटवा लो',
  'धीरे-धीरे, जल्दी क्या है',
  'सामne dekho, peeche mat',
  'Mirror mein dekh ke batao',
  'Upar se zero, side se fade',
  'Bhai thoda umar kam dikha do',
  'Shaadi wale din aana, special rate',
  'Sunday ko band hai',
  'Cash only, UPI bhi chalega',
  'Aaj naya blade laga hai',
  'Tel lagana hai ya dry cut',
  'Baal gir rahe hain bhai, doctor ko dikhao',
  'Dadi pe bhi same style',
  'Ganesh ji ki photo mat hata dena',
  'Radio ki awaaz thodi kam karo',
  'Bhai line seedhi nahi hai aajkal',
  'Papa wala cut chahiye',
  'College jaana hai jaldi se kar do',
  'Hero jaisa chahiye, hero jaisa milega',
  'Ek cup chai ho jaye',
  'Barber sahab ka haath sone jaisa',
  'Pehle number pe aao, pehle kaat lo',
  'Wait karo, abhi blade change ho raha hai',
  'Aajkal sab fade mangte hain',
  'Purana style wapas aa gaya hai',
  'Photo bhej do WhatsApp pe, waisa kar denge',
  'Bhai aankh band karke baith jao, haath tez hai',
  'Ek number, do number, teen number — sab yahin',
  'Mirror ke saamne khade raho',
  'Baith jao bhai, bas paanch minute',
];

let mirrorOrder = [];
let mirrorPos = 0;
let mirrorTimer = null;

function shuffleLines() {
  mirrorOrder = shuffle(MIRROR_LINES.map((_, i) => i));
}

function nextMirror() {
  mirrorPos += 1;
  if (mirrorPos >= mirrorOrder.length) {
    const last = mirrorOrder[mirrorOrder.length - 1];
    shuffleLines();
    if (mirrorOrder[0] === last && mirrorOrder.length > 1) {
      [mirrorOrder[0], mirrorOrder[1]] = [mirrorOrder[1], mirrorOrder[0]];
    }
    mirrorPos = 0;
  }

  el.mirrorText.classList.add('is-swapping');
  setTimeout(() => {
    el.mirrorText.textContent = MIRROR_LINES[mirrorOrder[mirrorPos]];
    el.mirrorText.classList.remove('is-swapping');
  }, 250);

  clearInterval(mirrorTimer);
  mirrorTimer = setInterval(nextMirror, 12000);
}

shuffleLines();
el.mirrorText.textContent = MIRROR_LINES[mirrorOrder[0]];
mirrorTimer = setInterval(nextMirror, 12000);
el.mirrorNext.addEventListener('click', nextMirror);

/* ── Clock + presence ────────────────────────────────────────── */

function tickClock() {
  el.clock.textContent = new Date()
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase();
}
tickClock();
setInterval(tickClock, 15000);

(function trackPresence() {
  const indicator = document.querySelector('.presence');
  const BEAT_MS = 30_000;

  let sid;
  try {
    sid = sessionStorage.getItem('bw-sid');
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem('bw-sid', sid);
    }
  } catch {
    sid = crypto.randomUUID();
  }

  let everWorked = false;

  async function beat() {
    if (document.hidden) return;
    try {
      const res = await fetch(`/api/presence?id=${encodeURIComponent(sid)}`);
      if (!res.ok) throw new Error(String(res.status));
      const { count } = await res.json();
      el.listeners.textContent = String(count);
      indicator.hidden = false;
      everWorked = true;
    } catch {
      if (!everWorked) indicator.hidden = true;
    }
  }

  indicator.hidden = true;
  beat();
  setInterval(beat, BEAT_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) beat();
  });
})();

/* ── YouTube iframe ──────────────────────────────────────────── */

function preferAudio() {
  try {
    yt?.setPlaybackQuality?.('tiny');
  } catch {
    /* ignored */
  }
}

window.onYouTubeIframeAPIReady = () => {
  yt = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    videoId: currentTrack().id,
    playerVars: {
      playsinline: 1,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
    },
    events: {
      onReady: () => {
        state.ready = true;
        el.play.disabled = false;
        preferAudio();
      },
      onStateChange: (e) => {
        const S = YT.PlayerState;
        if (e.data === S.PLAYING) {
          renderPlaying(true);
          preferAudio();
        } else if (e.data === S.PAUSED || e.data === S.BUFFERING) {
          renderPlaying(e.data === S.BUFFERING && state.playing);
        } else if (e.data === S.ENDED) go(state.pos + 1);
      },
      onError: () => {
        if (state.started) go(state.pos + 1);
      },
    },
  });

  setInterval(samplePlayer, 250);
  requestAnimationFrame(paintProgress);
};

(async function init() {
  try {
    const res = await fetch('/tracks.json');
    state.tracks = await res.json();
  } catch {
    el.title.textContent = 'Could not load the playlist';
    el.artist.textContent = 'Check tracks.json';
    return;
  }

  if (!state.tracks.length) {
    el.title.textContent = 'No tracks yet';
    el.artist.textContent = 'Run: node scripts/build-tracks.mjs';
    return;
  }

  state.order = buildOrder();
  renderList();
  renderTrack();
  rotateBackground(0);
  deferSecondBackground();

  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.append(s);
})();
