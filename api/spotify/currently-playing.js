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
  var playlistRequested = query.get('playlist') === '1';
  var requestedPlaylistId = query.get('playlist_id');
  var playlistOffset = query.get('offset') === null ? 0 : Number(query.get('offset'));
  if (playlistRequested && (requestedPlaylistId && !/^[A-Za-z0-9]{10,30}$/.test(requestedPlaylistId) || !Number.isInteger(playlistOffset) || playlistOffset < 0 || playlistOffset > 100000)) {
    return lib.json(res, 400, { error: 'Choose a valid playlist and track offset.' });
  }
  if (playlistRequested && lib.memoryRateLimit(req, 'playlist-tracks', 10, 60)) return lib.json(res, 429, { error: 'Too many playlist requests. Try again shortly.' });
  if (devicesRequested && lib.memoryRateLimit(req, 'devices', 10, 60)) return lib.json(res, 429, { error: 'Too many device-list requests. Try again shortly.' });
  if (!devicesRequested && lib.memoryRateLimit(req, 'poll', 40, 60)) return lib.json(res, 429, { error: 'Polling too frequently. Try again shortly.' });
  lib.getSession(req, res, function (err, session) {
    if (err || !session) return lib.json(res, 401, { error: 'Session expired. Pair again.' });
    var cfg = lib.config(req);
    lib.spotifyToken(cfg, 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refresh_token), function (tokenErr, tokenStatus, token) {
      if (tokenErr || tokenStatus !== 200 || !token || !token.access_token) return lib.json(res, 401, { error: 'Spotify authorization expired. Pair again.' });
      lib.updateRefreshToken(res, session, token, function (saveErr) {
      if (saveErr) return lib.json(res, 503, { error: 'Could not save refreshed Spotify profile credentials.' });
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
                is_restricted: !!device.is_restricted,
                supports_volume: typeof device.supports_volume === 'boolean' ? device.supports_volume : null,
                volume_percent: typeof device.volume_percent === 'number' ? device.volume_percent : null
              };
            })
          });
        });
        return;
      }
      if (playlistRequested) {
        lib.request('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: 'Bearer ' + token.access_token } }, function (playbackErr, playbackStatus, playback) {
          if (playbackErr) return lib.json(res, 502, { error: 'Could not identify the currently playing playlist.' });
          if (playbackStatus !== 200 || !playback || !playback.context) {
            return lib.json(res, 409, { error: 'Spotify is not currently playing from a playlist.' });
          }
          var contextMatch = typeof playback.context.uri === 'string' && playback.context.uri.match(/^spotify:playlist:([A-Za-z0-9]{10,30})$/);
          if (!contextMatch) return lib.json(res, 409, { error: 'The current playback is not from a Spotify playlist.' });
          var playlistId = contextMatch[1];
          if (requestedPlaylistId && requestedPlaylistId !== playlistId) {
            return lib.json(res, 409, { error: 'Playback has moved to a different playlist. Refresh the track list.' });
          }
          var playlistUrl = 'https://api.spotify.com/v1/playlists/' + playlistId + '/items?limit=50&offset=' + playlistOffset;
          lib.request(playlistUrl, { headers: { Authorization: 'Bearer ' + token.access_token } }, function (playlistErr, playlistStatus, playlistData) {
            if (playlistErr) return lib.json(res, 502, { error: 'Could not load the current playlist tracks.' });
            if (playlistStatus === 403) {
              return lib.json(res, 403, { error: 'Spotify has not granted playlist access to this profile. Use Add profile to authorize this account again with the new playlist permissions.' });
            }
            if (playlistStatus !== 200 || !playlistData || !Array.isArray(playlistData.items)) {
              return lib.json(res, playlistStatus || 502, { error: 'Spotify could not load the current playlist tracks.' });
            }
            var items = playlistData.items.map(function (entry, index) {
              var track = entry && (entry.item || entry.track);
              if (!track) return null;
              var artists = Array.isArray(track.artists) ? track.artists.map(function (artist) {
                return artist && typeof artist.name === 'string' ? artist.name.slice(0, 100) : '';
              }).filter(Boolean) : [];
              return {
                position: playlistOffset + index,
                uri: typeof track.uri === 'string' ? track.uri : null,
                name: typeof track.name === 'string' ? track.name.slice(0, 200) : 'Unavailable track',
                artists: artists,
                playable: !entry.is_local && track.is_local !== true && track.type === 'track' && typeof track.uri === 'string' && track.uri.indexOf('spotify:track:') === 0
              };
            }).filter(Boolean);
            var total = Number.isInteger(playlistData.total) ? playlistData.total : playlistOffset + items.length;
            var nextOffset = playlistOffset + playlistData.items.length;
            lib.json(res, 200, {
              playlist_id: playlistId,
              items: items,
              total: total,
              current_track_uri: playback.item && playback.item.uri || null,
              next_offset: nextOffset < total ? nextOffset : null
            });
          });
        });
        return;
      }
      lib.request('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: 'Bearer ' + token.access_token } }, function (apiErr, status, data) {
        if (apiErr) return lib.json(res, 502, { error: 'Spotify request failed.' });
        if (status === 204) return lib.json(res, 200, { item: null, is_playing: false });
        if (status === 403) {
          return lib.json(res, 403, {
            error: 'Spotify denied access for this account. If this app is in Development mode, add this account under Spotify Developer Dashboard → app Settings → Users Management, then authorize it again.'
          });
        }
        if (status !== 200) return lib.json(res, status, data || { error: 'Spotify request failed.' });
        lib.json(res, 200, data);
      });
      });
    });
  });
};
