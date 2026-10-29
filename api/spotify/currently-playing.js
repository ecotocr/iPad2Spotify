var lib = require('../_lib');
var URL = require('url').URL;
// Hot path: polled every 30-60 s by the paired app, so it must not touch Redis.
module.exports = function (req, res) {
  if ((req.method || '').toUpperCase() !== 'GET') return lib.json(res, 405, { error: 'Expected GET but received ' + req.method + '.' });
  if (!lib.cookie(req, 'spotify_session')) return lib.json(res, 401, { error: 'Pair this fullscreen app first.' });
  var query = new URL(req.url, 'https://localhost').searchParams;
  if (query.get('lyrics') === '1') {
    if (lib.memoryRateLimit(req, 'lyrics', 10, 60)) return lib.json(res, 429, { error: 'Too many lyrics requests. Try again shortly.' });
    var artist = (query.get('artist') || '').trim();
    var title = (query.get('title') || '').trim();
    if (!artist || !title || artist.length > 120 || title.length > 120 || /[\u0000-\u001f\u007f]/.test(artist + title)) {
      return lib.json(res, 400, { error: 'A valid artist and track title are required.' });
    }
    return lib.getSession(req, res, function (err, session) {
      if (err || !session) return lib.json(res, 401, { error: 'Session expired. Pair again.' });
      var lyricsUrl = 'https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title);
      lib.request(lyricsUrl, { timeout: 8000 }, function (apiErr, status, data) {
        if (apiErr) return lib.json(res, 502, { error: 'Lyrics service is unavailable. Try again shortly.' });
        if (status === 404) return lib.json(res, 404, { error: 'Lyrics were not found for this track.' });
        if (status !== 200 || !data || typeof data.lyrics !== 'string') {
          return lib.json(res, 502, { error: 'Lyrics service returned an invalid response.' });
        }
        if (!data.lyrics.trim()) return lib.json(res, 404, { error: 'Lyrics were not found for this track.' });
        res.setHeader('Cache-Control', 'private, no-store');
        lib.json(res, 200, { lyrics: data.lyrics });
      });
    });
  }
  var devicesRequested = query.get('devices') === '1';
  if (devicesRequested && lib.memoryRateLimit(req, 'devices', 10, 60)) return lib.json(res, 429, { error: 'Too many device-list requests. Try again shortly.' });
  if (!devicesRequested && lib.memoryRateLimit(req, 'poll', 40, 60)) return lib.json(res, 429, { error: 'Polling too frequently. Try again shortly.' });
  lib.getSession(req, res, function (err, session) {
    if (err || !session) return lib.json(res, 401, { error: 'Session expired. Pair again.' });
    var cfg = lib.config(req);
    lib.spotifyToken(cfg, 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refresh_token), function (tokenErr, tokenStatus, token) {
      if (tokenErr || tokenStatus !== 200 || !token || !token.access_token) return lib.json(res, 401, { error: 'Spotify authorization expired. Pair again.' });
      lib.updateRefreshToken(res, session, token);
      if (devicesRequested) {
        var headers = { Authorization: 'Bearer ' + token.access_token };
        lib.request('https://api.spotify.com/v1/me/player/devices', { headers: headers }, function (devicesErr, devicesStatus, data) {
          if (devicesErr) return lib.json(res, 502, { error: 'Could not load Spotify playback devices.' });
          if (devicesStatus !== 200) return lib.json(res, devicesStatus, data || { error: 'Could not load Spotify playback devices.' });
          var devices = data && Array.isArray(data.devices) ? data.devices : [];
          lib.json(res, 200, {
            devices: devices.map(function (device) {
              return {
                id: device.id || null,
                name: typeof device.name === 'string' ? device.name : 'Unknown device',
                type: typeof device.type === 'string' ? device.type : 'Device',
                is_active: !!device.is_active,
                is_restricted: !!device.is_restricted
              };
            })
          });
        });
        return;
      }
      lib.request('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: 'Bearer ' + token.access_token } }, function (apiErr, status, data) {
        if (apiErr) return lib.json(res, 502, { error: 'Spotify request failed.' });
        if (status === 204) return lib.json(res, 200, { item: null, is_playing: false });
        if (status !== 200) return lib.json(res, status, data || { error: 'Spotify request failed.' });
        lib.json(res, 200, data);
      });
    });
  });
};
