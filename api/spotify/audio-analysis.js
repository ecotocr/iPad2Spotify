var lib = require('../_lib');
var crypto = require('crypto');

// Strip and compress Spotify audio analysis payload
function sanitizeAnalysis(data) {
  var safe = {
    tatums: [],
    beats: [],
    bars: [],
    sections: [],
    segments: []
  };
  var normalizeObj = function(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    var result = {};
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = normalizeObj(obj[key]);
      }
    }
    return result;
  };
  var sanitizeArr = function(arr) {
    if (!Array.isArray(arr)) return arr;
    var result = [];
    for (var i = 0; i < arr.length; i++) {
      if (typeof arr[i] === 'object' && arr[i] !== null) {
        result[i] = {};
        for (var j in arr[i]) {
          var val = arr[i][j];
          if (['start', 'duration', 'liveness', 'energy', 'mode', 'key'].indexOf(j) >= 0 || typeof val === 'number') {
            result[i][j] = val;
          }
        }
      } else {
        result[i] = arr[i];
      }
    }
    return result;
  };
  if (data && data.tatums) safe.tatums = sanitizeArr(data.tatums.map(function(t) { return { start: t.start, duration: t.duration }; }));
  if (data && data.beats) safe.beats = sanitizeArr(data.beats.map(function(b) { return { start: b.start, duration: b.duration }; }));
  if (data && data.bars) safe.bars = sanitizeArr(data.bars.map(function(b) { return { start: b.start, duration: b.duration }; }));
  if (data && data.sections) safe.sections = sanitizeArr(data.sections.map(function(s) { return { start: s.start, duration: s.duration }; }));
  if (data && data.segments) safe.segments = sanitizeArr(data.segments.map(function(s) {
    var seg = {};
    if (typeof s.start === 'number') seg.start = s.start;
    if (typeof s.duration === 'number') seg.duration = s.duration;
    if (typeof s.loudness_start === 'number') seg.loudness_start = s.loudness_start;
    if (typeof s.loudness_max === 'number') seg.loudness_max = s.loudness_max;
    if (typeof s.loudness_max_time === 'number') seg.loudness_max_time = s.loudness_max_time;
    // pitches: 12 pitch classes - preserve for visualization
    if (s.pitches && Array.isArray(s.pitches)) {
      var p = [];
      for (var k = 0; k < 12 && k < s.pitches.length; k++) {
        if (typeof s.pitches[k] === 'number') p[k] = s.pitches[k];
      }
      seg.pitches = p;
    }
    // timbre: 12 timbre vectors - preserve for visualization
    if (s.timbre && Array.isArray(s.timbre)) {
      var t = [];
      for (var k = 0; k < 12 && k < s.timbre.length; k++) {
        if (typeof s.timbre[k] === 'number') t[k] = s.timbre[k];
      }
      seg.timbre = t;
    }
    return seg;
  }));

  return safe;
}

// Progressively reduce an over-budget sanitized payload while always returning a
// valid analysis object (never a warning). Shed the most redundant arrays first:
// tatums/beats (duplicated by bars/sections timing), then timbre, then coarsen
// the segment list. pitches + segments stay as long as possible (they drive the
// spectrum), only dropping fields of later segments if still too large.
function shrink(payload) {
  var p = {
    tatums: payload.tatums || [],
    beats: payload.beats || [],
    bars: payload.bars || [],
    sections: payload.sections || [],
    segments: payload.segments || []
  };
  var budget = 20000;
  if (JSON.stringify(p).length <= budget) return p;

  // 1) Drop tatums + beats (timing is already in bars/sections).
  p.tatums = [];
  p.beats = [];
  if (JSON.stringify(p).length <= budget) return p;

  // 2) Coarsen segments: keep every second one, then every fourth, etc.
  var segments = p.segments;
  for (var step = 2; step <= 16; step *= 2) {
    var kept = [];
    for (var i = 0; i < segments.length; i += step) kept.push(segments[i]);
    p.segments = kept;
    if (JSON.stringify(p).length <= budget) return p;
  }

  // 3) Keep only the smallest set of segment fields.
  p.segments = segments.filter ? (function () {
    var out = [];
    for (var i = 0; i < segments.length; i += 16) {
      var s = segments[i] || {};
      out.push({ start: s.start, duration: s.duration, loudness_max: s.loudness_max, pitches: s.pitches || [] });
    }
    return out;
  })() : [];
  p.bars = [];
  p.sections = [];
  return p;
}

module.exports = function(req, res) {
  var trackId = req.query.trackId;
  if (!trackId) return lib.json(res, 400, { error: 'trackId required' });
  lib.getSession(req, res, function(err, session) {
    if (err || !session) return lib.json(res, 401, { error: 'Pair this fullscreen app first.' });
    var cfg = lib.config(req);

    lib.spotifyToken(cfg, 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refresh_token), function(tokenErr, tokenStatus, token) {
      if (tokenErr || tokenStatus !== 200 || !token.access_token) return lib.json(res, 401, { error: 'Spotify authorization expired. Pair again.' });
      lib.updateRefreshToken(res, session, token);
      var cacheKey = 'analyze:' + crypto.createHash('md5').update('spotify-analysis-' + trackId).digest('hex');
      lib.kvGet(cacheKey, function(cacheErr, cached) {
        if (!cacheErr && cached) {
          res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
          return lib.json(res, 200, cached);
        }
        lib.request('https://api.spotify.com/v1/audio-analysis/' + trackId, { headers: { Authorization: 'Bearer ' + token.access_token } }, function(apiErr, status, data) {
          if (apiErr) return lib.json(res, 502, { error: 'Spotify Audio Analysis fetch failed.' });
          if (status !== 200) return lib.json(res, status, data || { error: 'Spotify request failed.' });
          var payload = sanitizeAnalysis(data);
          // If the sanitized payload is too large, progressively shed redundant
          // arrays so we always cache a *valid* (never a warning) payload.
          if (JSON.stringify(payload).length > 20000) payload = shrink(payload, data);
          lib.kvSet(cacheKey, payload, 86400, function(saveErr) {
            if (saveErr) console.log('Analysis cache save failed:', saveErr.message);
            res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
            lib.json(res, 200, payload);
          });
        });
      });
    });
  });
};