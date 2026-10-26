/* Winamp mode: a Winamp 2.x-style remote display and controller for Spotify.
 *
 * ES5 only (Safari on iOS 9). The Spotify Web API exposes playback state, not audio, so the
 * spectrum analyzer, equalizer and Milkdrop window are driven by a deterministic pseudo-spectrum
 * computed from the track identity and playback position. Nothing here alters Spotify's audio:
 * the EQ shapes the visuals only, and the transport buttons send Spotify commands through the host.
 *
 * Skin bitmaps come from the Winamp 2.91 base skin (vendor/winamp-skin); winamp.css positions them
 * with the original Winamp sprite coordinates.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WinampMode = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // VISCOLOR.TXT of the base skin: 0 background, 1 grid dots, 2-17 analyzer (top -> bottom),
  // 18-22 oscilloscope, 23 analyzer peaks.
  var VIS_COLORS = ['rgb(0,0,0)', 'rgb(24,33,41)', 'rgb(239,49,16)', 'rgb(206,41,16)', 'rgb(214,90,0)',
    'rgb(214,102,0)', 'rgb(214,115,0)', 'rgb(198,123,8)', 'rgb(222,165,24)', 'rgb(214,181,33)',
    'rgb(189,222,41)', 'rgb(148,222,33)', 'rgb(41,206,16)', 'rgb(50,190,16)', 'rgb(57,181,16)',
    'rgb(49,156,8)', 'rgb(41,148,0)', 'rgb(24,132,8)', 'rgb(255,255,255)', 'rgb(214,214,222)',
    'rgb(181,189,189)', 'rgb(160,170,175)', 'rgb(148,156,165)', 'rgb(150,150,150)'];
  // EQ_GRAPH_LINE_COLORS (EQMAIN.BMP 115,294) and EQ_PREAMP_LINE (EQMAIN.BMP 0,314).
  var EQ_LINE_COLORS = ['#d3221b', '#ef5221', '#ef7b21', '#e09228', '#e09228', '#e09228', '#e0b228',
    '#efdc31', '#efdc31', '#efdc31', '#d2eb35', '#d2eb35', '#a4e238', '#a4e238', '#89e230', '#71cd34',
    '#5ab02c', '#2a9a16', '#2a9a16'];
  var EQ_PREAMP_COLOR = '#bacbdd';
  var EQ_BAND_LABELS = ['60HZ', '170HZ', '310HZ', '600HZ', '1KHZ', '3KHZ', '6KHZ', '12KHZ', '14KHZ', '16KHZ'];
  // Winamp's built-in presets, in dB (+/-12).
  var EQ_PRESETS = [
    { name: 'Flat', preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'Classical', preamp: 0, bands: [0, 0, 0, 0, 0, 0, -7.2, -7.2, -7.2, -9.6] },
    { name: 'Club', preamp: 0, bands: [0, 0, 8, 5.6, 5.6, 5.6, 3.2, 0, 0, 0] },
    { name: 'Dance', preamp: 0, bands: [9.6, 7.2, 2.4, 0, 0, -5.6, -7.2, -7.2, 0, 0] },
    { name: 'Full Bass', preamp: -2.4, bands: [-8, 9.6, 9.6, 5.6, 1.6, -4, -8, -10.4, -11.2, -11.2] },
    { name: 'Full Treble', preamp: -4.8, bands: [-9.6, -9.6, -9.6, -4, 2.4, 11.2, 12, 12, 12, 12] },
    { name: 'Large Hall', preamp: 0, bands: [10.4, 10.4, 5.6, 5.6, 0, -4.8, -4.8, -4.8, 0, 0] },
    { name: 'Live', preamp: 0, bands: [-4.8, 0, 4, 5.6, 5.6, 5.6, 4, 2.4, 2.4, 2.4] },
    { name: 'Pop', preamp: 0, bands: [-1.6, 4.8, 7.2, 8, 5.6, 0, -2.4, -2.4, -1.6, -1.6] },
    { name: 'Reggae', preamp: 0, bands: [0, 0, 0, -5.6, 0, 6.4, 6.4, 0, 0, 0] },
    { name: 'Rock', preamp: 0, bands: [8, 4.8, -5.6, -8, -3.2, 4, 8.8, 11.2, 11.2, 11.2] },
    { name: 'Soft', preamp: 0, bands: [4.8, 1.6, 0, -2.4, 0, 4, 8, 9.6, 11.2, 12] },
    { name: 'Techno', preamp: 0, bands: [8, 5.6, 0, -5.6, -4.8, 0, 8, 9.6, 9.6, 8.8] }
  ];
  // TEXT.BMP glyph grid (5x6 cells): [row, column], as in Webamp's FONT_LOOKUP.
  var FONT = (function () {
    var map = {}, i, lower = 'abcdefghijklmnopqrstuvwxyz"@', row1 = '0123456789\u2026.:()-\'!_+\\/[]^&%,=$#';
    for (i = 0; i < lower.length; i++) map[lower.charAt(i)] = [0, i];
    map[' '] = [0, 30];
    for (i = 0; i < row1.length; i++) map[row1.charAt(i)] = [1, i];
    map['\u00e5'] = [2, 0]; map['\u00f6'] = [2, 1]; map['\u00e4'] = [2, 2]; map['?'] = [2, 3]; map['*'] = [2, 4];
    map['<'] = [1, 22]; map['>'] = [1, 23]; map['{'] = [1, 22]; map['}'] = [1, 23];
    return map;
  }());
  var FOLD = { '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e6': '\u00e4', '\u00e7': 'c',
    '\u00e8': 'e', '\u00e9': 'e', '\u00ea': 'e', '\u00eb': 'e', '\u00ec': 'i', '\u00ed': 'i', '\u00ee': 'i',
    '\u00ef': 'i', '\u00f1': 'n', '\u00f2': 'o', '\u00f3': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f8': '\u00f6',
    '\u00f9': 'u', '\u00fa': 'u', '\u00fb': 'u', '\u00fc': 'u', '\u00fd': 'y', '\u00ff': 'y', '\u00df': 's',
    '\u2018': '\'', '\u2019': '\'', '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '|': '/', ';': ':', '~': '-', '\u0060': '\'' };
  var WINDOW_W = 275, WINDOW_H = 116, POS_TRACK = 248 - 29, VIS_BARS = 19, MILK_BINS = 48;
  var MARQUEE_STEP_MS = 220, FLASH_MS = 1600, STORAGE_KEY = 'ipad2spotify.winamp';
  var BACKGROUND_KEY = 'ipad2spotify.winamp.background', SNAP_DISTANCE = 15, WINDOW_NAMES = ['main', 'eq', 'pl', 'md'];

  // VisMap integration for Milkdrop beat-locked visuals (iOS 9.3.5 ES5)
  var visMapCache = {};
  var visMapCacheOrder = [];
  var visMapCacheMax = 20; // unbounded cache guard
  var currentVisMap = null;
  var currentVisMapTrackId = null;
  var isFetchingVisMap = {};
  var PRESET_NAMES = ['Prismatic Hourglass Tunnel', 'Prismatic Foldwheel', 'Interleaved Ribbons',
    'Radial Spectrum', 'Stellar Wake', 'Resonant Plasma', 'Spiral Vortex'];

  // ---------------------------------------------------------------- pure helpers (unit tested)

  var imul = Math.imul || function (a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) | 0);
  };
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function hashString(str) {
    var h = 2166136261;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = imul(h, 16777619); }
    return h >>> 0;
  }
  // Deterministic [0, 1) value for an integer pair.
  function hash2(a, b) {
    var h = imul((a | 0) ^ imul((b | 0) + 0x9e3779b9, 0x85ebca6b), 0xc2b2ae35);
    h ^= h >>> 15; h = imul(h, 0x27d4eb2d); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  // Smooth 1D value noise in [0, 1).
  function noise(seed, x) {
    var i = Math.floor(x), f = x - i, a = hash2(seed, i), b = hash2(seed, i + 1), u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }

  // Normalises Spotify's currently-playing payload. "item: null" (HTTP 200 or 204) means stopped.
  function fromSpotify(data, now) {
    var item = data && data.item;
    if (!item) return { status: 'stopped', trackId: null, title: '', artist: '', album: '', durationMs: 0, progressMs: 0, fetchedAt: now };
    var artists = [];
    for (var i = 0; item.artists && i < item.artists.length; i++) artists.push(item.artists[i].name);
    var artist = artists.join(', ');
    return {
      status: data.is_playing ? 'playing' : 'paused',
      trackId: item.id || item.uri || (artist + '|' + item.name),
      title: item.name || '',
      artist: artist,
      album: (item.album && item.album.name) || '',
      durationMs: item.duration_ms || 0,
      progressMs: data.progress_ms || 0,
      fetchedAt: now
    };
  }
  function positionMs(state, now) {
    if (!state || state.status === 'stopped') return 0;
    var p = state.progressMs || 0;
    if (state.status === 'playing') p += now - state.fetchedAt;
    if (state.durationMs) p = Math.min(p, state.durationMs);
    return Math.max(0, p);
  }
  // Per-track constants: tempo, tonal balance and Milkdrop preset all follow from the track id,
  // so the same song always produces the same visual character.
  function trackProfile(trackId) {
    var seed = hashString(trackId);
    return {
      seed: seed,
      bpm: 78 + Math.floor(hash2(seed, 1) * 82),
      bass: 0.55 + 0.45 * hash2(seed, 2),
      bright: 0.3 + 0.6 * hash2(seed, 3),
      busy: hash2(seed, 4),
      preset: Math.floor(hash2(seed, 5) * PRESET_NAMES.length),
      autoEq: 1 + Math.floor(hash2(seed, 6) * (EQ_PRESETS.length - 1))
    };
  }
  function sliderToDb(v) { return (clamp(v, 0, 100) - 50) * 12 / 50; }
  function dbToSlider(db) { return clamp(Math.round(50 + db * 50 / 12), 0, 100); }
  // Gain in dB at relative frequency f (0 = 60 Hz band, 1 = 16 kHz band), including preamp.
  function eqGainDb(eq, f) {
    if (!eq || !eq.on) return 0;
    var pos = clamp(f, 0, 1) * 9, i = Math.min(8, Math.floor(pos)), frac = pos - i;
    return sliderToDb(eq.preamp) + sliderToDb(eq.bands[i]) * (1 - frac) + sliderToDb(eq.bands[i + 1]) * frac;
  }
  // Deterministic pseudo-spectrum: a function of (track, position, duration, EQ) only, so pausing
  // freezes it, seeking reproduces it and the same moment of a song always looks the same.
  function spectrum(profile, tSec, durationSec, eq, out) {
    var n = out.length, seed = profile.seed, t = Math.max(0, tSec);
    var beat = t * profile.bpm / 60, bi = Math.floor(beat), ph = beat - bi;
    var inBar = bi % 4;
    var kick = (inBar === 0 || inBar === 2 || hash2(seed, 100 + bi % 16) < profile.busy * 0.6) ? Math.exp(-ph * 7) : 0;
    var snare = (inBar === 1 || inBar === 3) ? Math.exp(-ph * 9) : 0;
    var half = beat * 2, hph = half - Math.floor(half);
    var hat = Math.exp(-hph * 14) * (0.5 + 0.5 * hash2(seed, 200 + Math.floor(half) % 32));
    var fadeIn = clamp(t / 3, 0, 1), fadeOut = durationSec > 0 ? clamp((durationSec - t) / 4, 0, 1) : 1;
    var env = (0.55 + 0.45 * noise(seed + 3, beat / 32)) * fadeIn * fadeOut;
    var melody = 0.15 + 0.6 * noise(seed + 5, beat / 2), tone = 0.6 + 0.4 * noise(seed + 13, beat);
    for (var i = 0; i < n; i++) {
      var f = n > 1 ? i / (n - 1) : 0, inv = 1 - f;
      var base = (0.78 - 0.5 * f) * (0.6 + 0.4 * noise(seed + 11 + i * 7, t * 6));
      var low = kick * profile.bass * inv * inv * inv * 1.1;
      var mid = snare * 0.55 * Math.exp(-((f - 0.45) / 0.18) * ((f - 0.45) / 0.18));
      var high = hat * profile.bright * f * f * 0.8;
      var partial = 0.45 * tone * Math.exp(-((f - melody) / 0.06) * ((f - melody) / 0.06));
      var v = env * (base * 0.55 + low + mid + high + partial) * Math.pow(10, eqGainDb(eq, f) / 20);
      out[i] = clamp(v, 0, 1);
    }
    return out;
  }
  // Resample a real (Spotify audio-analysis) band vector into out and apply the
  // Winamp EQ weighting, so the analyzer/Milkdrop can show actual audio data.
  // Returns true when real bands are used; false means the caller should fall
  // back to the deterministic pseudo-spectrum. eqGainDb() yields 0 dB when the
  // EQ is off, which is a no-op multiplier, so EQ OFF still bypasses correctly.
  function realBands(src, eq, out) {
    var n = out.length;
    if (!src || !src.length) return false;
    for (var i = 0; i < n; i++) {
      var t = n > 1 ? i / (n - 1) : 0;
      var s = t * (src.length - 1), si = Math.floor(s), frac = s - si;
      var a = src[si] || 0, b = src[Math.min(si + 1, src.length - 1)] || 0;
      var base = a + (b - a) * frac;
      var f = n > 1 ? i / (n - 1) : 0;
      out[i] = clamp(base * Math.pow(10, eqGainDb(eq, f) / 20), 0, 1);
    }
    return true;
  }
  // Oscilloscope samples in [-1, 1], shaped by the same spectrum.
  function waveform(profile, tSec, levels, out) {
    var n = out.length, seed = profile.seed, lowAmp = (levels[0] + levels[1] + levels[2]) / 3;
    var hiAmp = (levels[levels.length - 1] + levels[levels.length - 2]) / 2;
    var f1 = 1.5 + 2 * hash2(seed, 7), f2 = 5 + 6 * hash2(seed, 8), f3 = 13 + 10 * hash2(seed, 9);
    for (var i = 0; i < n; i++) {
      var x = i / n * Math.PI * 2;
      out[i] = clamp(lowAmp * 0.8 * Math.sin(x * f1 + tSec * 9) + 0.3 * Math.sin(x * f2 - tSec * 23) * (lowAmp + hiAmp) +
        hiAmp * 0.35 * Math.sin(x * f3 + tSec * 41), -1, 1);
    }
    return out;
  }
  function textGlyphs(text) {
    var glyphs = [], s = String(text || '').toLowerCase();
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (FOLD[c]) c = FOLD[c];
      glyphs.push(FONT[c] || FONT[' ']);
    }
    return glyphs;
  }
  function formatTime(ms) {
    var total = Math.floor(Math.max(0, ms) / 1000), m = Math.floor(total / 60), s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  // Winamp's four-digit mm:ss display.
  function clockDigits(ms) {
    var total = Math.min(99 * 60 + 59, Math.floor(Math.max(0, ms) / 1000)), m = Math.floor(total / 60), s = total % 60;
    return [Math.floor(m / 10), m % 10, Math.floor(s / 10), s % 10];
  }
  function marqueeText(state) {
    if (!state || state.status === 'stopped' || !state.title) return 'iPad2Spotify - nothing playing on Spotify. press play, or eject to search';
    return state.artist + ' - ' + state.title + ' (' + formatTime(state.durationMs) + ')';
  }
  // Windows dock like Winamp's default layout: main / equalizer / playlist stacked, Milkdrop beside
  // them (landscape) or underneath (portrait), whichever lets the stage be scaled up more.
  function computeLayout(open, vw, vh) {
    var y = WINDOW_H, pos = { main: { x: 0, y: 0 } };
    if (open.eq) { pos.eq = { x: 0, y: y }; y += WINDOW_H; }
    if (open.pl) { pos.pl = { x: 0, y: y }; y += WINDOW_H; }
    var width = WINDOW_W, height = y, scale = Math.min(vw / width, vh / height);
    if (open.md) {
      var besideScale = Math.min(vw / (WINDOW_W * 2), vh / y), belowH = WINDOW_H * 2;
      var belowScale = Math.min(vw / WINDOW_W, vh / (y + belowH));
      if (belowScale > besideScale) { pos.md = { x: 0, y: y, h: belowH }; height = y + belowH; scale = belowScale; }
      else { pos.md = { x: WINDOW_W, y: 0, h: y }; width = WINDOW_W * 2; scale = besideScale; }
    }
    scale *= 0.96;
    if (scale >= 2) scale = Math.floor(scale);
    return { pos: pos, width: width, height: height, scale: scale,
      left: Math.round((vw - width * scale) / 2), top: Math.round((vh - height * scale) / 2) };
  }

  // Window snapping, ported from Webamp's snapUtils/WindowManager. Boxes are {x, y, width, height}.
  function near(a, b) { return Math.abs(a - b) < SNAP_DISTANCE; }
  function overlapX(a, b) { return a.x <= b.x + b.width + SNAP_DISTANCE && b.x <= a.x + a.width + SNAP_DISTANCE; }
  function overlapY(a, b) { return a.y <= b.y + b.height + SNAP_DISTANCE && b.y <= a.y + a.height + SNAP_DISTANCE; }
  // New position for box a that snaps it to box b; x/y are undefined when that axis doesn't snap.
  function snapBox(a, b) {
    var x, y;
    if (overlapY(a, b)) {
      if (near(a.x, b.x + b.width)) x = b.x + b.width;
      else if (near(a.x + a.width, b.x)) x = b.x - a.width;
      else if (near(a.x, b.x)) x = b.x;
      else if (near(a.x + a.width, b.x + b.width)) x = b.x + b.width - a.width;
    }
    if (overlapX(a, b)) {
      if (near(a.y, b.y + b.height)) y = b.y + b.height;
      else if (near(a.y + a.height, b.y)) y = b.y - a.height;
      else if (near(a.y, b.y)) y = b.y;
      else if (near(a.y + a.height, b.y + b.height)) y = b.y + b.height - a.height;
    }
    return { x: x, y: y };
  }
  function snapWithin(a, width, height) {
    var x, y;
    if (a.x - SNAP_DISTANCE < 0) x = 0;
    else if (a.x + a.width + SNAP_DISTANCE > width) x = width - a.width;
    if (a.y - SNAP_DISTANCE < 0) y = 0;
    else if (a.y + a.height + SNAP_DISTANCE > height) y = height - a.height;
    return { x: x, y: y };
  }
  function boundingBox(boxes) {
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (var i = 0; i < boxes.length; i++) {
      l = Math.min(l, boxes[i].x); t = Math.min(t, boxes[i].y);
      r = Math.max(r, boxes[i].x + boxes[i].width); b = Math.max(b, boxes[i].y + boxes[i].height);
    }
    return { x: l, y: t, width: r - l, height: b - t };
  }
  // Windows docked (transitively) to start; dragging the main window brings these along.
  function connectedWindows(boxes, start) {
    var found = [start];
    for (var k = 0; k < found.length; k++) {
      for (var i = 0; i < boxes.length; i++) {
        if (found.indexOf(boxes[i]) !== -1) continue;
        var s = snapBox(boxes[i], found[k]);
        if (s.x !== undefined || s.y !== undefined) found.push(boxes[i]);
      }
    }
    return found;
  }
  function shift(box, d) { return { x: box.x + d.x, y: box.y + d.y, width: box.width, height: box.height }; }
  // Final offset for a drag: snap the moving group to stationary windows and to the screen edges.
  function dragOffset(moving, stationary, proposed, width, height) {
    var snapD = { x: 0, y: 0 }, moved = [], i, j;
    for (i = 0; i < moving.length; i++) moved.push(shift(moving[i], proposed));
    for (i = 0; i < moved.length; i++) {
      for (j = 0; j < stationary.length; j++) {
        var s = snapBox(moved[i], stationary[j]);
        if (!snapD.x && s.x !== undefined) snapD.x = s.x - moved[i].x;
        if (!snapD.y && s.y !== undefined) snapD.y = s.y - moved[i].y;
      }
    }
    var box = boundingBox(moved), w = snapWithin(box, width, height);
    var withinD = { x: w.x === undefined ? 0 : w.x - box.x, y: w.y === undefined ? 0 : w.y - box.y };
    function pick(a, b) { return a === 0 || b === 0 ? a + b : (Math.abs(a) < Math.abs(b) ? a : b); }
    return { x: proposed.x + pick(snapD.x, withinD.x), y: proposed.y + pick(snapD.y, withinD.y) };
  }
  // Size that fits (w, h) within max x max, keeping the aspect ratio.
  function fitWithin(w, h, max) {
    var k = Math.min(1, max / Math.max(w, h, 1));
    return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
  }

  // ---------------------------------------------------------------- DOM view

  var MAIN_HTML =
    '<div class="wa-window wa-main wa-drag" data-window="main">' +
      '<div class="wa-main-title wa-drag"></div>' +
      '<button type="button" class="wa-btn wa-main-options" data-action="menu" aria-label="Main menu"></button>' +
      '<button type="button" class="wa-btn wa-main-minimize" data-action="exit" aria-label="Exit Winamp mode"></button>' +
      '<button type="button" class="wa-btn wa-main-close" data-action="exit" aria-label="Exit Winamp mode"></button>' +
      '<div class="wa-clutter"></div>' +
      '<button type="button" class="wa-btn wa-clutter-v" data-action="toggle-md" aria-label="Toggle Milkdrop window"></button>' +
      '<div class="wa-work"></div><div class="wa-playpause"></div>' +
      '<div class="wa-time" data-action="toggle-time"><div class="wa-minus"></div>' +
        '<div class="wa-digit wa-d0"></div><div class="wa-digit wa-d1"></div><div class="wa-digit wa-d2"></div><div class="wa-digit wa-d3"></div></div>' +
      '<canvas class="wa-vis" width="76" height="16" data-action="cycle-vis"></canvas>' +
      '<div class="wa-marquee"><div class="wa-marquee-text"></div></div>' +
      '<div class="wa-kbps"></div><div class="wa-khz"></div>' +
      '<div class="wa-mono"></div><div class="wa-stereo"></div>' +
      '<div class="wa-volume"><div class="wa-volume-thumb"></div></div>' +
      '<div class="wa-balance"><div class="wa-balance-thumb"></div></div>' +
      '<button type="button" class="wa-btn wa-eq-toggle" data-action="toggle-eq" aria-label="Toggle equalizer"></button>' +
      '<button type="button" class="wa-btn wa-pl-toggle" data-action="toggle-pl" aria-label="Toggle playlist"></button>' +
      '<div class="wa-posbar"><div class="wa-pos-thumb"></div></div>' +
      '<button type="button" class="wa-btn wa-cb wa-prev" data-action="previous" aria-label="Previous track"></button>' +
      '<button type="button" class="wa-btn wa-cb wa-play" data-action="play" aria-label="Play"></button>' +
      '<button type="button" class="wa-btn wa-cb wa-pause" data-action="pause" aria-label="Pause"></button>' +
      '<button type="button" class="wa-btn wa-cb wa-stop" data-action="stop" aria-label="Stop (pauses Spotify)"></button>' +
      '<button type="button" class="wa-btn wa-cb wa-next" data-action="next" aria-label="Next track"></button>' +
      '<button type="button" class="wa-btn wa-eject" data-action="eject" aria-label="Search artist or playlist"></button>' +
      '<div class="wa-shuffle"></div><div class="wa-repeat"></div>' +
    '</div>';

  function eqHtml() {
    var html = '<div class="wa-window wa-eq wa-drag" data-window="eq">' +
      '<div class="wa-eq-title wa-drag"></div>' +
      '<button type="button" class="wa-btn wa-eq-close" data-action="toggle-eq" aria-label="Close equalizer"></button>' +
      '<button type="button" class="wa-btn wa-eq-on" data-action="eq-on" aria-label="Equalizer on"></button>' +
      '<button type="button" class="wa-btn wa-eq-auto" data-action="eq-auto" aria-label="Automatic equalizer preset per track"></button>' +
      '<canvas class="wa-eq-graph" width="113" height="19"></canvas>' +
      '<button type="button" class="wa-btn wa-eq-presets" data-action="eq-preset" aria-label="Next equalizer preset"></button>' +
      '<div class="wa-band" data-band="-1" style="left:21px" aria-label="Preamp"><div class="wa-band-thumb"></div></div>';
    for (var i = 0; i < 10; i++) {
      html += '<div class="wa-band" data-band="' + i + '" style="left:' + (78 + i * 18) + 'px" aria-label="' + EQ_BAND_LABELS[i] + '"><div class="wa-band-thumb"></div></div>';
    }
    return html + '</div>';
  }

  var PL_HTML =
    '<div class="wa-window wa-pl" data-window="pl">' +
      '<div class="wa-drag wa-pl-top wa-pl-tl"></div>' +
      '<div class="wa-drag wa-pl-top wa-pl-fill" style="left:25px"></div><div class="wa-drag wa-pl-top wa-pl-fill" style="left:50px"></div><div class="wa-drag wa-pl-top wa-pl-fill" style="left:75px;width:12px"></div>' +
      '<div class="wa-drag wa-pl-top wa-pl-title"></div>' +
      '<div class="wa-drag wa-pl-top wa-pl-fill" style="left:187px"></div><div class="wa-drag wa-pl-top wa-pl-fill" style="left:212px"></div><div class="wa-drag wa-pl-top wa-pl-fill" style="left:237px;width:13px"></div>' +
      '<div class="wa-drag wa-pl-top wa-pl-tr"></div>' +
      '<div class="wa-drag wa-pl-left" style="top:20px"></div><div class="wa-drag wa-pl-left" style="top:49px"></div>' +
      '<div class="wa-drag wa-pl-right" style="top:20px"></div><div class="wa-drag wa-pl-right" style="top:49px"></div>' +
      '<div class="wa-drag wa-pl-handle"></div>' +
      '<div class="wa-pl-list"></div>' +
      '<div class="wa-drag wa-pl-bl"></div><div class="wa-drag wa-pl-br"></div>' +
      '<button type="button" class="wa-btn wa-pl-close" data-action="toggle-pl" aria-label="Close playlist"></button>' +
      '<button type="button" class="wa-btn wa-pl-add" data-action="eject" aria-label="Search artist or playlist"></button>' +
      '<div class="wa-pl-running"></div>' +
      '<button type="button" class="wa-btn wa-pl-mini" style="left:128px" data-action="previous" aria-label="Previous track"></button>' +
      '<button type="button" class="wa-btn wa-pl-mini" style="left:138px" data-action="play" aria-label="Play"></button>' +
      '<button type="button" class="wa-btn wa-pl-mini" style="left:148px" data-action="pause" aria-label="Pause"></button>' +
      '<button type="button" class="wa-btn wa-pl-mini" style="left:158px" data-action="stop" aria-label="Stop (pauses Spotify)"></button>' +
      '<button type="button" class="wa-btn wa-pl-mini" style="left:168px" data-action="next" aria-label="Next track"></button>' +
      '<button type="button" class="wa-btn wa-pl-mini" style="left:178px" data-action="eject" aria-label="Search artist or playlist"></button>' +
      '<div class="wa-pl-minitime"></div>' +
    '</div>';

  var MD_HTML =
    '<div class="wa-window wa-md" data-window="md">' +
      '<div class="wa-drag wa-md-top"></div>' +
      '<div class="wa-drag wa-md-left"></div><div class="wa-drag wa-md-left-bottom"></div>' +
      '<div class="wa-drag wa-md-right"></div><div class="wa-drag wa-md-right-bottom"></div>' +
      '<canvas class="wa-md-canvas"></canvas>' +
      '<div class="wa-drag wa-md-bottom"></div>' +
      '<button type="button" class="wa-btn wa-md-close" data-action="toggle-md" aria-label="Close Milkdrop"></button>' +
    '</div>';

  // Main menu, modelled on Webamp's main context menu.
  var MENU_HTML =
    '<ul class="wa-menu hidden">' +
      '<li data-action="eject">Search artist/playlist...</li>' +
      '<li class="wa-hr"><hr></li>' +
      '<li data-action="toggle-eq" data-check="eq">Equalizer</li>' +
      '<li data-action="toggle-pl" data-check="pl">Playlist Editor</li>' +
      '<li data-action="toggle-md" data-check="md">Milkdrop</li>' +
      '<li class="wa-hr"><hr></li>' +
      '<li class="wa-menu-file">Set background...<input type="file" accept="image/*" aria-label="Set background image"></li>' +
      '<li data-action="clear-background" data-show="background">Remove background</li>' +
      '<li class="wa-hr"><hr></li>' +
      '<li class="wa-parent" data-action="submenu">Options<ul>' +
        '<li data-action="time-elapsed" data-check="elapsed">Time elapsed</li>' +
        '<li data-action="time-remaining" data-check="remaining">Time remaining</li>' +
        '<li class="wa-hr"><hr></li>' +
        '<li data-action="vis-analyzer" data-check="vis-analyzer">Spectrum analyzer</li>' +
        '<li data-action="vis-oscilloscope" data-check="vis-oscilloscope">Oscilloscope</li>' +
        '<li data-action="vis-off" data-check="vis-off">Visualization off</li>' +
        '<li class="wa-hr"><hr></li>' +
        '<li data-action="reset-layout">Reset window positions</li>' +
      '</ul></li>' +
      '<li class="wa-hr"><hr></li>' +
      '<li data-action="exit">Exit</li>' +
    '</ul>';

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function glyphHtml(text) {
    var g = textGlyphs(text), html = '';
    for (var i = 0; i < g.length; i++) html += '<i style="background-position:-' + (g[i][1] * 5) + 'px -' + (g[i][0] * 6) + 'px"></i>';
    return html;
  }
  function hasClass(el, cls) { return (' ' + el.className + ' ').indexOf(' ' + cls + ' ') !== -1; }
  function setClass(el, cls, on) {
    var has = hasClass(el, cls);
    if (on && !has) el.className += ' ' + cls;
    else if (!on && has) el.className = (' ' + el.className + ' ').replace(' ' + cls + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }
  function defaultSettings() {
    return { eq: { on: true, auto: false, preamp: 50, bands: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50], preset: 0 },
      open: { eq: true, pl: true, md: true }, vis: 'analyzer', remaining: false, positions: null };
  }
  function loadSettings(storage) {
    var s = defaultSettings();
    try {
      var saved = storage && JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.eq && saved.eq.bands && saved.eq.bands.length === 10) s.eq = saved.eq;
      if (saved && saved.open) s.open = { eq: !!saved.open.eq, pl: !!saved.open.pl, md: !!saved.open.md };
      if (saved && /^(analyzer|oscilloscope|off)$/.test(saved.vis)) s.vis = saved.vis;
      if (saved) s.remaining = !!saved.remaining;
      if (saved && saved.positions && typeof saved.positions === 'object') {
        s.positions = {};
        for (var n = 0; n < WINDOW_NAMES.length; n++) {
          var p = saved.positions[WINDOW_NAMES[n]];
          if (p && isFinite(p.x) && isFinite(p.y)) s.positions[WINDOW_NAMES[n]] = { x: Math.round(p.x), y: Math.round(p.y) };
        }
      }
    } catch (e) {}
    return s;
  }

  function create(opts) {
    var root = opts.root, win = opts.window || window, doc = win.document, storage = opts.storage;
    var settings = loadSettings(storage);
    var state = fromSpotify(null, Date.now()), profile = trackProfile(''), history = [];
    var active = false, loopHandle = null, loopIsFrame = false, frame = 0;
    var levels = new Array(VIS_BARS), peaks = new Array(VIS_BARS), milkLevels = new Array(MILK_BINS), wave = new Array(76);
    var lastVisTime = 0, lastClockKey = '', lastMarquee = '', marqueeStart = 0, flash = null, milk = null, milkSize = '';
    var i;
    for (i = 0; i < VIS_BARS; i++) peaks[i] = 0;

    root.innerHTML = '<div class="wa-stage">' + MAIN_HTML + eqHtml() + PL_HTML + MD_HTML + MENU_HTML + '</div>';
    function q(cls) { return root.querySelector('.' + cls); }
    var stage = q('wa-stage'), el = {
      main: q('wa-main'), eq: q('wa-eq'), pl: q('wa-pl'), md: q('wa-md'),
      digits: [q('wa-d0'), q('wa-d1'), q('wa-d2'), q('wa-d3')], vis: q('wa-vis'),
      marquee: q('wa-marquee-text'), kbps: q('wa-kbps'), khz: q('wa-khz'), posThumb: q('wa-pos-thumb'),
      eqGraph: q('wa-eq-graph'), plList: q('wa-pl-list'), plRunning: q('wa-pl-running'), plMini: q('wa-pl-minitime'),
      mdCanvas: q('wa-md-canvas'), menu: q('wa-menu')
    };
    var fileInput = el.menu.querySelector('input'), menuItems = el.menu.getElementsByTagName('li');
    // Window positions in unscaled Winamp pixels on a stage that covers the whole screen.
    var pos = {}, view = { scale: 1, width: WINDOW_W, height: WINDOW_H, mdHeight: WINDOW_H }, zTop = 1, background = null;
    var bands = root.querySelectorAll('.wa-band');
    el.kbps.innerHTML = glyphHtml('320');
    el.khz.innerHTML = glyphHtml('44');
    var visCtx = el.vis.getContext ? el.vis.getContext('2d') : null;
    var eqCtx = el.eqGraph.getContext ? el.eqGraph.getContext('2d') : null;
    var visBg = null, barImg = null;
    if (visCtx) {
      visBg = doc.createElement('canvas'); visBg.width = 76; visBg.height = 16;
      var bctx = visBg.getContext('2d');
      bctx.fillStyle = VIS_COLORS[0]; bctx.fillRect(0, 0, 76, 16);
      bctx.fillStyle = VIS_COLORS[1];
      for (var gx = 0; gx < 76; gx += 2) for (var gy = 1; gy < 16; gy += 2) bctx.fillRect(gx, gy, 1, 1);
      barImg = doc.createElement('canvas'); barImg.width = 1; barImg.height = 16;
      var barCtx = barImg.getContext('2d');
      for (var by = 0; by < 16; by++) { barCtx.fillStyle = VIS_COLORS[2 + by]; barCtx.fillRect(0, by, 1, 1); }
    }

    function save() {
      try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
    }
    function flashText(text) { flash = { text: text, until: Date.now() + FLASH_MS }; }

    // ---- rendering of static-ish parts
    function renderStatus() {
      setClass(root, 'wa-playing', state.status === 'playing');
      setClass(root, 'wa-paused', state.status === 'paused');
      setClass(root, 'wa-stopped', state.status === 'stopped');
      setClass(root, 'wa-remaining', settings.remaining);
      setClass(root, 'wa-eq-open', settings.open.eq);
      setClass(root, 'wa-pl-open', settings.open.pl);
      setClass(root, 'wa-md-open', settings.open.md);
      setClass(root, 'wa-eq-on', settings.eq.on);
      setClass(root, 'wa-eq-autoon', settings.eq.auto);
      setClass(root, 'wa-vis-off', settings.vis === 'off');
    }
    function renderEq() {
      for (var b = 0; b < bands.length; b++) {
        var idx = parseInt(bands[b].getAttribute('data-band'), 10);
        var v = idx < 0 ? settings.eq.preamp : settings.eq.bands[idx];
        var sprite = Math.round(v / 100 * 27);
        bands[b].style.backgroundPosition = '-' + (13 + (sprite % 14) * 15) + 'px -' + (164 + Math.floor(sprite / 14) * 65) + 'px';
        bands[b].firstChild.style.top = Math.round((1 - v / 100) * 51) + 'px';
      }
      if (!eqCtx) return;
      eqCtx.clearRect(0, 0, 113, 19);
      eqCtx.fillStyle = EQ_PREAMP_COLOR;
      eqCtx.fillRect(0, Math.round((1 - settings.eq.preamp / 100) * 18), 113, 1);
      // Catmull-Rom through the ten band points, 12 px apart, drawn as 1 px columns like Winamp.
      var ys = [];
      for (var k = 0; k < 10; k++) ys.push((1 - settings.eq.bands[k] / 100) * 18);
      var lastY = Math.round(ys[0]);
      for (var x = 0; x <= 108; x++) {
        var seg = Math.min(8, Math.floor(x / 12)), t = x / 12 - seg;
        var p0 = ys[Math.max(0, seg - 1)], p1 = ys[seg], p2 = ys[seg + 1], p3 = ys[Math.min(9, seg + 2)];
        var y = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        y = clamp(Math.round(y), 0, 18);
        for (var yy = Math.min(y, lastY); yy <= Math.max(y, lastY); yy++) {
          eqCtx.fillStyle = EQ_LINE_COLORS[yy];
          eqCtx.fillRect(2 + x, yy, 1, 1);
        }
        lastY = y;
      }
    }
    function renderPlaylist() {
      var html = '', total = 0, start = Math.max(0, history.length - 4);
      for (var h = 0; h < history.length; h++) total += history[h].durationMs;
      for (var r = start; r < history.length; r++) {
        var cur = r === history.length - 1 && state.status !== 'stopped';
        html += '<div class="wa-pl-row' + (cur ? ' wa-pl-current' : '') + '"><span class="wa-pl-dur">' + formatTime(history[r].durationMs) +
          '</span><span class="wa-pl-name">' + (r + 1) + '. ' + escapeHtml(history[r].artist + ' - ' + history[r].title) + '</span></div>';
      }
      el.plList.innerHTML = html;
      el.plRunning.innerHTML = glyphHtml(formatTime(state.durationMs) + '/' + formatTime(total));
    }
    function visible(name) { return name === 'main' || !!settings.open[name]; }
    function box(name) {
      return { key: name, x: pos[name].x, y: pos[name].y, width: WINDOW_W, height: name === 'md' ? view.mdHeight : WINDOW_H };
    }
    function placeWindow(name) {
      el[name].style.display = visible(name) ? 'block' : 'none';
      el[name].style.left = pos[name].x + 'px';
      el[name].style.top = pos[name].y + 'px';
    }
    function layout() {
      var vw = win.innerWidth || doc.documentElement.clientWidth, vh = win.innerHeight || doc.documentElement.clientHeight;
      // Scale for the default docked layout, so opening/closing windows never rescales the others.
      var l = computeLayout({ eq: true, pl: true, md: true }, vw, vh);
      view.scale = l.scale;
      view.width = vw / l.scale;
      view.height = vh / l.scale;
      view.mdHeight = l.pos.md.h;
      stage.style.width = view.width + 'px'; stage.style.height = view.height + 'px';
      var tf = 'scale(' + l.scale + ')';
      stage.style.webkitTransform = tf; stage.style.transform = tf;
      for (var n = 0; n < WINDOW_NAMES.length; n++) {
        var name = WINDOW_NAMES[n], saved = settings.positions && settings.positions[name];
        var p = saved || { x: Math.round(l.pos[name].x + l.left / l.scale), y: Math.round(l.pos[name].y + l.top / l.scale) };
        var b0 = { width: WINDOW_W, height: name === 'md' ? view.mdHeight : WINDOW_H };
        // Keep windows on screen after rotation/resizing, like Webamp.
        pos[name] = { x: Math.max(0, Math.min(p.x, Math.floor(view.width - b0.width))), y: Math.max(0, Math.min(p.y, Math.floor(view.height - b0.height))) };
        placeWindow(name);
      }
      el.md.style.height = view.mdHeight + 'px';
      var cw = WINDOW_W - 19, ch = view.mdHeight - 34, key = cw + 'x' + ch;
      if (key !== milkSize) {
        milkSize = key;
        if (milk) milk.resize(cw, ch);
        else { el.mdCanvas.width = cw; el.mdCanvas.height = ch; }
      }
    }

    // ---- per-frame rendering
    function renderClock(now) {
      var pos = positionMs(state, now), shown = settings.remaining ? state.durationMs - pos : pos;
      var d = clockDigits(shown), pct = state.durationMs ? pos / state.durationMs : 0;
      var key = d.join('') + '|' + Math.round(pct * POS_TRACK) + '|' + state.status;
      if (key === lastClockKey) return;
      lastClockKey = key;
      for (var k = 0; k < 4; k++) el.digits[k].style.backgroundPosition = '-' + (d[k] * 9) + 'px 0';
      el.posThumb.style.left = Math.round(pct * POS_TRACK) + 'px';
      el.plMini.innerHTML = glyphHtml(state.status === 'stopped' ? '' : (settings.remaining ? '-' : '') + formatTime(shown));
      if (settings.open.pl) el.plRunning.innerHTML = glyphHtml(formatTime(state.durationMs) + '/' + formatTime(runningTotal()));
    }
    function runningTotal() { var s = 0; for (var h = 0; h < history.length; h++) s += history[h].durationMs; return s; }
    function renderMarquee(now) {
      var text = flash && now < flash.until ? flash.text : marqueeText(state);
      if (flash && now >= flash.until) flash = null;
      var scrolling = !flash && text.length * 5 > 154;
      var full = scrolling ? text + '  ***  ' : text;
      if (full !== lastMarquee) {
        lastMarquee = full;
        marqueeStart = now;
        el.marquee.innerHTML = glyphHtml(scrolling ? full + full : full);
        el.marquee.style.left = '0px';
      }
      if (scrolling) {
        var steps = Math.floor((now - marqueeStart) / MARQUEE_STEP_MS) % full.length;
        el.marquee.style.left = '-' + (steps * 5) + 'px';
      }
    }
    function renderVis(tSec, now) {
      if (!visCtx || settings.vis === 'off') return;
      var dt = lastVisTime ? Math.min(0.1, (now - lastVisTime) / 1000) : 0;
      lastVisTime = now;
      var ab = win.getAudioAnalysisBands ? win.getAudioAnalysisBands() : null;
      var usedReal = !!(ab && ab.trackId === state.trackId && realBands(ab.frequencies, settings.eq, levels));
      if (!usedReal) spectrum(profile, tSec, state.durationMs / 1000, settings.eq, levels);
      visCtx.drawImage(visBg, 0, 0);
      if (settings.vis === 'oscilloscope') {
        waveform(profile, tSec, levels, wave);
        var last = null;
        for (var x = 0; x < 76; x++) {
          var y = clamp(Math.round(8 - wave[x] * 7.5), 0, 15), from = last === null ? y : last;
          visCtx.fillStyle = VIS_COLORS[18 + Math.min(4, Math.floor(Math.abs(y - 8) / 2))];
          visCtx.fillRect(x, Math.min(y, from), 1, Math.abs(y - from) + 1);
          last = y;
        }
        return;
      }
      for (var b = 0; b < VIS_BARS; b++) {
        var h = Math.round(levels[b] * 16);
        peaks[b] = Math.max(h, peaks[b] - dt * 12);
        if (h > 0) visCtx.drawImage(barImg, 0, 16 - h, 1, h, b * 4, 16 - h, 3, h);
        var p = Math.round(peaks[b]);
        if (p > 0) { visCtx.fillStyle = VIS_COLORS[23]; visCtx.fillRect(b * 4, 16 - p, 3, 1); }
      }
    }
    function renderMilk(tSec) {
      if (!settings.open.md) return;
      if (!milk && win.OldMilk) {
        try { milk = win.OldMilk.createVisualizer(el.mdCanvas, { width: el.mdCanvas.width, height: el.mdCanvas.height }); }
        catch (e) { milk = null; }
        if (milk) milk.loadPreset(PRESET_NAMES[profile.preset]);
      }
      if (!milk) return;

      // VisMap integration: use pre-calculated beat-locked bands if available
      var progressMs = Math.round(tSec * 1000);
      if (currentVisMap && currentVisMap.type === 'bpm_grid' && currentVisMapTrackId === state.trackId) {
        var interval = currentVisMap.interval_ms;
        var index = Math.floor(progressMs / interval);
        if (index >= currentVisMap.frames.length) index = currentVisMap.frames.length - 1;
        if (index >= 0) {
          var frame = currentVisMap.frames[index];
          var bass = frame[1], mid = frame[2], treble = frame[3], isBeat = frame[4];
          // Expand 4 values to 48 bins: bass→0-15, mid→16-31, treble→32-47, beat injects to low bins
          for (var b = 0; b < MILK_BINS; b++) {
            var v = 0;
            if (b < 16) v = bass;
            else if (b < 32) v = mid;
            else v = treble;
            // Beat impulse on first few bins for kick detection
            if (isBeat && b < 3) v = Math.min(1, v + 0.6);
            milkLevels[b] = v;
          }
          milk.setBands(milkLevels);
          milk.render(tSec);
          return;
        }
      }

      var mb = win.getAudioAnalysisBands ? win.getAudioAnalysisBands() : null;
      if (mb && mb.trackId === state.trackId && realBands(mb.frequencies, settings.eq, milkLevels)) {
        milk.setBands(milkLevels);
        milk.render(tSec);
        return;
      }
      // Fallback to deterministic pseudo-spectrum
      spectrum(profile, tSec, state.durationMs / 1000, settings.eq, milkLevels);
      milk.setBands(milkLevels);
      milk.render(tSec);
    }

    // Single owner of all animation: rAF while playing, a slow timer for the marquee otherwise.
    function tick() {
      loopHandle = null;
      if (!active) return;
      var now = Date.now(), tSec = positionMs(state, now) / 1000;
      renderClock(now);
      renderMarquee(now);
      if (state.status === 'playing') {
        frame++;
        renderVis(tSec, now);
        if (frame % 2 === 0) renderMilk(tSec); // ~30 fps keeps WebGL affordable on an iPad 2
      } else {
        lastVisTime = 0;
      }
      schedule();
    }
    function stopLoop() {
      if (loopHandle === null) return;
      if (loopIsFrame) (win.cancelAnimationFrame || win.clearTimeout)(loopHandle);
      else win.clearTimeout(loopHandle);
      loopHandle = null;
    }
    function schedule() {
      stopLoop();
      if (!active || doc.hidden) return;
      loopIsFrame = state.status === 'playing' && !!win.requestAnimationFrame;
      loopHandle = loopIsFrame ? win.requestAnimationFrame(tick) : win.setTimeout(tick, MARQUEE_STEP_MS);
    }

    // ---- state
    function fetchVisMap(trackId) {
      if (visMapCache[trackId]) {
        // Update LRU order
        var idx = visMapCacheOrder.indexOf(trackId);
        if (idx >= 0) visMapCacheOrder.splice(idx, 1);
        visMapCacheOrder.push(trackId);
        if (currentVisMapTrackId === trackId) {
          currentVisMap = visMapCache[trackId];
        }
        return;
      }
      if (isFetchingVisMap[trackId]) return;
      isFetchingVisMap[trackId] = true;
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/vis-map?track_id=' + encodeURIComponent(trackId), true);
      xhr.timeout = 5000;
      xhr.onload = function() {
        isFetchingVisMap[trackId] = false;
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            if (data.type === 'bpm_grid' && data.frames && data.frames.length > 0) {
              // Enforce cache size limit
              if (visMapCacheOrder.length >= visMapCacheMax) {
                var oldest = visMapCacheOrder.shift();
                delete visMapCache[oldest];
              }
              visMapCache[trackId] = data;
              visMapCacheOrder.push(trackId);
              // Only apply if this is still the current track
              if (currentVisMapTrackId === trackId) {
                currentVisMap = data;
              }
            }
          } catch (e) {
            console.error('Failed to parse VisMap JSON:', e);
          }
        }
      };
      xhr.onerror = function() {
        isFetchingVisMap[trackId] = false;
      };
      xhr.ontimeout = function() {
        isFetchingVisMap[trackId] = false;
      };
      xhr.send();
    }
    function setState(next) {
      var changed = next.trackId !== state.trackId;
      state = next;
      if (changed && next.trackId) {
        profile = trackProfile(next.trackId);
        for (var k = 0; k < VIS_BARS; k++) peaks[k] = 0;
        if (milk) milk.loadPreset(PRESET_NAMES[profile.preset]);
        if (settings.eq.auto) applyPreset(profile.autoEq, false);
        // Clear map for previous track and reset current reference
        currentVisMapTrackId = next.trackId;
        currentVisMap = null;
        // Cancel any pending fetch for previous track is implicit via guard
        fetchVisMap(next.trackId);
        var last = history[history.length - 1];
        if (!last || last.trackId !== next.trackId) {
          history.push({ trackId: next.trackId, artist: next.artist, title: next.title, durationMs: next.durationMs });
          if (history.length > 100) history.shift();
        }
      }
      lastClockKey = '';
      renderStatus();
      renderPlaylist();
      if (active) schedule();
    }
    function applyPreset(index, announce) {
      var p = EQ_PRESETS[index];
      settings.eq.preset = index;
      settings.eq.preamp = dbToSlider(p.preamp);
      for (var k = 0; k < 10; k++) settings.eq.bands[k] = dbToSlider(p.bands[k]);
      if (announce) flashText('EQ preset: ' + p.name);
      renderEq(); save();
    }
    function optimistic(status) {
      if (state.status === 'stopped') return;
      var now = Date.now();
      setState({ status: status, trackId: state.trackId, title: state.title, artist: state.artist, album: state.album,
        durationMs: state.durationMs, progressMs: positionMs(state, now), fetchedAt: now });
    }

    // ---- input
    function actionFor(target) {
      while (target && target !== root) {
        if (target.getAttribute && target.getAttribute('data-action')) return target.getAttribute('data-action');
        target = target.parentNode;
      }
      return null;
    }
    function focusWindow(target) {
      while (target && target !== root && !(target.getAttribute && target.getAttribute('data-window'))) target = target.parentNode;
      if (!target || target === root) return;
      var names = ['main', 'eq', 'pl', 'md'];
      for (var n = 0; n < names.length; n++) setClass(el[names[n]], 'wa-focused', el[names[n]] === target);
      target.style.zIndex = ++zTop;
    }
    // A window that is opened comes to the front, so it can't reappear hidden behind another one.
    function raise(name) { if (visible(name)) focusWindow(el[name]); }
    function send(action) { if (opts.onCommand) opts.onCommand(action); }
    function handle(action) {
      switch (action) {
        case 'previous': case 'next': send(action); break;
        case 'play': optimistic('playing'); send('play'); break;
        // Winamp's pause button toggles; Spotify has no stop, so stop pauses.
        case 'pause': if (state.status === 'paused') { optimistic('playing'); send('play'); } else { optimistic('paused'); send('pause'); } break;
        case 'stop': optimistic('paused'); send('pause'); break;
        case 'eject': if (opts.onEject) opts.onEject(); break;
        case 'exit': if (opts.onExit) opts.onExit(); break;
        case 'toggle-eq': settings.open.eq = !settings.open.eq; save(); renderStatus(); layout(); raise('eq'); break;
        case 'toggle-pl': settings.open.pl = !settings.open.pl; save(); renderStatus(); layout(); renderPlaylist(); raise('pl'); break;
        case 'toggle-md':
          settings.open.md = !settings.open.md; save(); renderStatus(); layout(); raise('md');
          if (!settings.open.md && milk) milk.clear();
          break;
        case 'toggle-time': settings.remaining = !settings.remaining; lastClockKey = ''; save(); renderStatus(); renderClock(Date.now()); break;
        case 'cycle-vis':
          settings.vis = settings.vis === 'analyzer' ? 'oscilloscope' : (settings.vis === 'oscilloscope' ? 'off' : 'analyzer');
          save(); renderStatus();
          if (visCtx) visCtx.drawImage(visBg, 0, 0);
          break;
        case 'eq-on': settings.eq.on = !settings.eq.on; save(); renderStatus(); break;
        case 'eq-auto':
          settings.eq.auto = !settings.eq.auto; save(); renderStatus();
          if (settings.eq.auto && state.trackId) applyPreset(profile.autoEq, true);
          break;
        case 'eq-preset': applyPreset((settings.eq.preset + 1) % EQ_PRESETS.length, true); break;
        case 'menu': if (menuOpen()) closeMenu(); else openMenu(); break;
        case 'time-elapsed': case 'time-remaining':
          settings.remaining = action === 'time-remaining'; lastClockKey = ''; save(); renderStatus(); renderClock(Date.now()); break;
        case 'vis-analyzer': case 'vis-oscilloscope': case 'vis-off':
          settings.vis = action.substring(4); save(); renderStatus();
          if (visCtx) visCtx.drawImage(visBg, 0, 0);
          break;
        case 'reset-layout': settings.positions = null; save(); layout(); break;
        case 'clear-background':
          try { if (storage) storage.removeItem(BACKGROUND_KEY); } catch (e) {}
          applyBackground(null);
          break;
      }
    }

    // ---- main menu
    function menuOpen() { return !hasClass(el.menu, 'hidden'); }
    function closeMenu() {
      setClass(el.menu, 'hidden', true);
      var parents = el.menu.querySelectorAll('.wa-parent');
      for (var k = 0; k < parents.length; k++) setClass(parents[k], 'wa-open', false);
    }
    function openMenu() {
      var checks = { eq: settings.open.eq, pl: settings.open.pl, md: settings.open.md, elapsed: !settings.remaining,
        remaining: settings.remaining, 'vis-analyzer': settings.vis === 'analyzer', 'vis-oscilloscope': settings.vis === 'oscilloscope',
        'vis-off': settings.vis === 'off' };
      for (var k = 0; k < menuItems.length; k++) {
        var c = menuItems[k].getAttribute('data-check'), show = menuItems[k].getAttribute('data-show');
        if (c) setClass(menuItems[k], 'wa-checked', !!checks[c]);
        if (show) menuItems[k].style.display = background ? '' : 'none';
      }
      setClass(el.menu, 'hidden', false);
      el.menu.style.zIndex = ++zTop + 1000;
      // Drops down from the options button, kept inside the screen.
      var x = pos.main.x + 6, y = pos.main.y + 12;
      el.menu.style.left = Math.max(0, Math.min(x, view.width - el.menu.offsetWidth)) + 'px';
      el.menu.style.top = Math.max(0, Math.min(y, view.height - el.menu.offsetHeight)) + 'px';
    }
    // Opens the submenu to the left and/or moves it up when it would leave the screen.
    function placeSubmenu(parent) {
      var sub = parent.getElementsByTagName('ul')[0];
      if (!sub) return;
      sub.style.top = '';
      setClass(sub, 'wa-flip', false);
      var left = el.menu.offsetLeft + parent.offsetLeft, top = el.menu.offsetTop + parent.offsetTop + sub.offsetTop;
      if (left + parent.offsetWidth + sub.offsetWidth > view.width) setClass(sub, 'wa-flip', true);
      var over = top + sub.offsetHeight - view.height;
      if (over > 0) sub.style.top = (sub.offsetTop - Math.min(over, top)) + 'px';
    }
    function inMenu(target) {
      while (target && target !== root) { if (target === el.menu) return true; target = target.parentNode; }
      return false;
    }
    root.onclick = function (e) {
      var action = actionFor(e.target), insideMenu = inMenu(e.target);
      if (menuOpen() && !insideMenu && action !== 'menu') { closeMenu(); return; }
      if (insideMenu) {
        if (action === 'submenu') {
          var parent = e.target;
          while (parent && !hasClass(parent, 'wa-parent')) parent = parent.parentNode;
          if (parent === e.target) {
            setClass(parent, 'wa-open', !hasClass(parent, 'wa-open'));
            if (hasClass(parent, 'wa-open')) placeSubmenu(parent);
          }
          return;
        }
        if (!action) return;
        closeMenu();
      } else {
        focusWindow(e.target);
      }
      if (action) handle(action);
    };

    // ---- background image (stored as a base64 data URL in localStorage)
    function applyBackground(url) {
      background = url || null;
      root.style.backgroundImage = background ? 'url(' + background + ')' : '';
      setClass(root, 'wa-has-background', !!background);
    }
    function encodeBackground(img) {
      var sw = (win.screen && Math.max(win.screen.width, win.screen.height)) || 1024;
      var max = Math.min(2048, Math.round(sw * (win.devicePixelRatio || 1)));
      var attempts = [[max, 0.82], [1024, 0.72], [640, 0.6]], url = null;
      try { if (storage) storage.removeItem(BACKGROUND_KEY); } catch (e) {}
      for (var k = 0; k < attempts.length; k++) {
        var size = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, attempts[k][0]);
        var c = doc.createElement('canvas');
        c.width = size.width; c.height = size.height;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#101211';
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(img, 0, 0, size.width, size.height);
        try { url = c.toDataURL('image/jpeg', attempts[k][1]); } catch (e) { url = null; }
        if (!url) continue;
        try {
          if (!storage) break;
          storage.setItem(BACKGROUND_KEY, url);
          applyBackground(url);
          flashText('Background saved');
          return;
        } catch (e2) {}
      }
      if (url) { applyBackground(url); flashText('Background too large to save on this device'); }
      else flashText('Could not use that image');
    }
    fileInput.onchange = function () {
      var file = fileInput.files && fileInput.files[0];
      closeMenu();
      if (!file) return;
      if (file.type && !/^image\//.test(file.type)) { flashText('Not an image file'); fileInput.value = ''; return; }
      var reader = new win.FileReader();
      reader.onload = function () {
        var img = new win.Image();
        img.onload = function () { encodeBackground(img); };
        img.onerror = function () { flashText('Could not read that image'); };
        img.src = reader.result;
      };
      reader.onerror = function () { flashText('Could not read that image'); };
      reader.readAsDataURL(file);
      fileInput.value = '';
    };
    try { applyBackground(storage && storage.getItem(BACKGROUND_KEY)); } catch (e) { applyBackground(null); }

    var drag = null, windowDrag = null;
    function point(e) {
      if (e.touches && e.touches.length) return e.touches[0];
      if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0];
      return e;
    }
    function setBandFromY(band, clientY) {
      var rect = band.getBoundingClientRect(), px = (clientY - rect.top) / rect.height * 63 - 5.5;
      var v = Math.round((1 - clamp(px / 51, 0, 1)) * 100), idx = parseInt(band.getAttribute('data-band'), 10);
      if (Math.abs(v - 50) <= 2) v = 50; // Winamp's sliders snap to 0 dB
      if (idx < 0) settings.eq.preamp = v; else settings.eq.bands[idx] = v;
      var db = sliderToDb(v);
      flashText('EQ: ' + (idx < 0 ? 'PREAMP' : EQ_BAND_LABELS[idx]) + ': ' + (db >= 0 ? '+' : '') + db.toFixed(1) + ' DB');
      renderEq();
      renderMarquee(Date.now());
    }
    function bandStart(e) {
      drag = this;
      focusWindow(this);
      setBandFromY(drag, point(e).clientY);
      if (e.preventDefault) e.preventDefault();
    }
    // Windows are dragged by their frame (the wa-drag elements), as in Webamp; the main window drags the
    // windows docked to it along.
    function windowStart(e) {
      var target = e.target;
      if (drag || !target || !hasClass(target, 'wa-drag') || (e.button && e.button !== 0)) return;
      var w = target;
      while (w && w !== root && !(w.getAttribute && w.getAttribute('data-window'))) w = w.parentNode;
      if (!w || w === root) return;
      var name = w.getAttribute('data-window'), boxes = [], start = null, moving, stationary = [], k;
      closeMenu();
      focusWindow(w);
      for (k = 0; k < WINDOW_NAMES.length; k++) {
        if (!visible(WINDOW_NAMES[k])) continue;
        boxes.push(box(WINDOW_NAMES[k]));
        if (WINDOW_NAMES[k] === name) start = boxes[boxes.length - 1];
      }
      moving = name === 'main' ? connectedWindows(boxes, start) : [start];
      for (k = 0; k < boxes.length; k++) if (moving.indexOf(boxes[k]) === -1) stationary.push(boxes[k]);
      var p = point(e);
      windowDrag = { moving: moving, stationary: stationary, x: p.clientX, y: p.clientY, moved: false };
      if (e.preventDefault) e.preventDefault();
    }
    function pointerMove(e) {
      if (drag) { setBandFromY(drag, point(e).clientY); if (e.preventDefault) e.preventDefault(); return; }
      if (!windowDrag) return;
      var p = point(e), proposed = { x: (p.clientX - windowDrag.x) / view.scale, y: (p.clientY - windowDrag.y) / view.scale };
      var off = dragOffset(windowDrag.moving, windowDrag.stationary, proposed, view.width, view.height);
      // Unlike desktop Webamp, keep the dragged windows fully on screen: a window lost off the edge of a
      // tablet cannot be grabbed back.
      var bb = boundingBox(windowDrag.moving);
      off.x = Math.round(clamp(off.x, -bb.x, view.width - bb.x - bb.width));
      off.y = Math.round(clamp(off.y, -bb.y, view.height - bb.y - bb.height));
      for (var k = 0; k < windowDrag.moving.length; k++) {
        var m = windowDrag.moving[k];
        pos[m.key] = { x: m.x + off.x, y: m.y + off.y };
        placeWindow(m.key);
      }
      windowDrag.moved = true;
      if (e.preventDefault) e.preventDefault();
    }
    function pointerEnd() {
      if (drag) { drag = null; save(); }
      if (windowDrag) {
        if (windowDrag.moved) {
          settings.positions = {};
          for (var k = 0; k < WINDOW_NAMES.length; k++) settings.positions[WINDOW_NAMES[k]] = { x: pos[WINDOW_NAMES[k]].x, y: pos[WINDOW_NAMES[k]].y };
          save();
        }
        windowDrag = null;
      }
    }
    for (i = 0; i < bands.length; i++) {
      bands[i].addEventListener('touchstart', bandStart, false);
      bands[i].addEventListener('mousedown', bandStart, false);
    }
    root.addEventListener('touchstart', windowStart, false);
    root.addEventListener('mousedown', windowStart, false);
    doc.addEventListener('touchmove', pointerMove, false);
    doc.addEventListener('mousemove', pointerMove, false);
    doc.addEventListener('touchend', pointerEnd, false);
    doc.addEventListener('touchcancel', pointerEnd, false);
    doc.addEventListener('mouseup', pointerEnd, false);
    // Lets :active pressed-button sprites show on iOS.
    root.addEventListener('touchstart', function () {}, false);
    win.addEventListener('resize', function () { if (active) layout(); }, false);
    win.addEventListener('orientationchange', function () { if (active) layout(); }, false);
    doc.addEventListener('visibilitychange', function () { if (active) schedule(); }, false);

    renderStatus();
    renderEq();
    renderPlaylist();
    setClass(el.main, 'wa-focused', true);

    return {
      update: function (data) { setState(fromSpotify(data, Date.now())); },
      show: function () {
        active = true;
        setClass(root, 'hidden', false);
        layout();
        lastClockKey = ''; lastMarquee = '';
        schedule();
      },
      hide: function () {
        active = false;
        closeMenu();
        pointerEnd();
        stopLoop();
        setClass(root, 'hidden', true);
      },
      isActive: function () { return active; }
    };
  }

  return {
    create: create,
    fromSpotify: fromSpotify,
    positionMs: positionMs,
    trackProfile: trackProfile,
    spectrum: spectrum,
    realBands: realBands,
    waveform: waveform,
    eqGainDb: eqGainDb,
    sliderToDb: sliderToDb,
    dbToSlider: dbToSlider,
    textGlyphs: textGlyphs,
    clockDigits: clockDigits,
    marqueeText: marqueeText,
    computeLayout: computeLayout,
    snapBox: snapBox,
    snapWithin: snapWithin,
    connectedWindows: connectedWindows,
    dragOffset: dragOffset,
    fitWithin: fitWithin,
    loadSettings: loadSettings,
    EQ_PRESETS: EQ_PRESETS,
    PRESET_NAMES: PRESET_NAMES
  };
}));
