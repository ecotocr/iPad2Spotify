var lib = require('../_lib');
var paths = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'], restart: ['PUT', '/me/player/seek?position_ms=0'] };
function idFrom(body, key) {
  return body && typeof body[key] === 'string' && /^[A-Za-z0-9]{10,30}$/.test(body[key]) ? body[key] : null;
}
function spotifyErrorMessage(data) {
  var err = data && data.error;
  if (!err) return 'Spotify request failed.';
  var reason = (typeof err === 'string' ? err : err.reason) || '';
  if (reason === 'NO_ACTIVE_DEVICE') return 'Open Spotify on a phone, computer, or speaker first, then try again.';
  if (typeof err === 'string') return err;
  return err.message || err.reason || 'Spotify request failed.';
}
// Spotify requires a target device for playback commands; look one up so we can pin the
// command to it even when nothing is currently marked "active" (a common cause of 404s).
function findDeviceId(accessToken, callback) {
  lib.request('https://api.spotify.com/v1/me/player/devices', { headers: { Authorization: 'Bearer ' + accessToken } }, function (apiErr, status, data) {
    if (apiErr || status !== 200 || !data || !Array.isArray(data.devices) || !data.devices.length) return callback(null);
    var active = data.devices.filter(function (d) { return d.is_active; })[0];
    callback((active || data.devices[0]).id);
  });
}
module.exports = function (req, res) {
  if ((req.method || '').toUpperCase() !== 'POST') return lib.json(res, 405, { error: 'Expected POST but received ' + req.method + '.' });
  if (!lib.cookie(req, 'spotify_session')) return lib.json(res, 401, { error: 'Pair this fullscreen app first.' });
  if (lib.memoryRateLimit(req, 'command', 60, 60)) return lib.json(res, 429, { error: 'Too many playback commands. Try again shortly.' });
  lib.readBody(req, function (raw) { var body; try { body = JSON.parse(raw); } catch (e) {}
    var isArtist = body && body.action === 'play_artist';
    var isPlaylist = body && body.action === 'play_playlist';
    var isPlaylistTrack = body && body.action === 'play_playlist_track';
    var isTrack = body && body.action === 'play_track';
    var trackUri = isTrack && typeof body.track_uri === 'string' && /^spotify:track:[A-Za-z0-9]{10,30}$/.test(body.track_uri) ? body.track_uri : null;
    var isPlaylistContext = isPlaylist || isPlaylistTrack;
    var isSeek = body && body.action === 'seek';
    var isDeviceTransfer = body && body.action === 'transfer_device';
    var isVolume = body && body.action === 'volume';
    var volumeDeviceId = isVolume && typeof body.device_id === 'string' && /^[^\u0000-\u001f\u007f]{1,256}$/.test(body.device_id) ? body.device_id : null;
    var transferDeviceId = isDeviceTransfer && typeof body.device_id === 'string' && /^[^\u0000-\u001f\u007f]{1,256}$/.test(body.device_id) ? body.device_id : null;
    var requestedDeviceId = body && typeof body.device_id === 'string' && /^[^\u0000-\u001f\u007f]{1,256}$/.test(body.device_id) ? body.device_id : null;
    var playlistPosition = isPlaylistTrack && Number.isInteger(body.position) && body.position >= 0 && body.position <= 100000 ? body.position : null;
    if (isSeek && (!Number.isInteger(body.position_ms) || body.position_ms < 0 || body.position_ms > 86400000)) return lib.json(res, 400, { error: 'Seek position must be a whole number between 0 and 86400000 milliseconds.' });
    if (isVolume && (typeof body.volume_percent !== 'number' || body.volume_percent % 1 !== 0 || body.volume_percent < 0 || body.volume_percent > 100)) return lib.json(res, 400, { error: 'Volume must be a whole number between 0 and 100 percent.' });
    if (isVolume && body.device_id !== undefined && !volumeDeviceId) return lib.json(res, 400, { error: 'A valid Spotify device ID is required.' });
    if (body && body.device_id !== undefined && !requestedDeviceId) return lib.json(res, 400, { error: 'A valid Spotify device ID is required.' });
    var target = isSeek ? ['PUT', '/me/player/seek?position_ms=' + body.position_ms] : isVolume ? ['PUT', '/me/player/volume?volume_percent=' + body.volume_percent] : isDeviceTransfer ? ['PUT', '/me/player'] : (!isArtist && !isPlaylistContext && paths[body && body.action]);
    var actionId = (isArtist ? idFrom(body, 'artist_id') : isPlaylistContext ? idFrom(body, 'playlist_id') : null);
    if ((isArtist || isPlaylistContext) && !actionId) return lib.json(res, 400, { error: 'Unknown ' + (isArtist ? 'artist' : 'playlist') + '.' });
    if (isPlaylistTrack && playlistPosition === null) return lib.json(res, 400, { error: 'Choose a valid playlist track position.' });
    if (isTrack && !trackUri) return lib.json(res, 400, { error: 'Choose a valid Spotify track.' });
    if (isDeviceTransfer && !transferDeviceId) return lib.json(res, 400, { error: 'A valid Spotify device ID is required.' });
    if (!isArtist && !isPlaylistContext && !isTrack && !target) return lib.json(res, 400, { error: 'Unknown playback command.' });
    lib.getSession(req, res, function (err, session) { if (err || !session) return lib.json(res, 401, { error: 'Session expired. Pair again.' }); var cfg = lib.config(req); lib.spotifyToken(cfg, 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refresh_token), function (tokenErr, tokenStatus, token) { if (tokenErr || tokenStatus !== 200 || !token || !token.access_token) return lib.json(res, 401, { error: 'Spotify authorization expired.' });
      lib.updateRefreshToken(res, session, token, function (saveErr) {
      if (saveErr) return lib.json(res, 503, { error: 'Could not save refreshed Spotify profile credentials.' });
      function sendCommand(deviceId) {
        var method = (isArtist || isPlaylistContext || isTrack) ? 'PUT' : target[0];
        var path = (isArtist || isPlaylistContext || isTrack) ? '/me/player/play' : target[1];
        if (deviceId) path += (path.indexOf('?') === -1 ? '?' : '&') + 'device_id=' + encodeURIComponent(deviceId);
        var payload = isArtist ? JSON.stringify({ context_uri: 'spotify:artist:' + actionId }) : isPlaylistTrack ? JSON.stringify({ context_uri: 'spotify:playlist:' + actionId, offset: { position: playlistPosition } }) : isPlaylist ? JSON.stringify({ context_uri: 'spotify:playlist:' + actionId }) : isTrack ? JSON.stringify({ uris: [trackUri] }) : isDeviceTransfer ? JSON.stringify({ device_ids: [transferDeviceId], play: true }) : null;
        var headers = { Authorization: 'Bearer ' + token.access_token };
        if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); } else { headers['Content-Length'] = 0; }
        lib.request('https://api.spotify.com/v1' + path, { method: method, headers: headers, body: payload }, function (apiErr, status, data) {
          if (apiErr) return lib.json(res, 502, { error: 'Spotify request failed.' });
          if (status === 200 || status === 204) return lib.json(res, 200, { device_id: deviceId || null });
          var spotifyError = data && data.error;
          var errorText = typeof spotifyError === 'string' ? spotifyError : spotifyError && (spotifyError.message || spotifyError.reason);
          if (isVolume && typeof errorText === 'string' && /cannot control device volume/i.test(errorText)) {
            return lib.json(res, 409, { error: 'Spotify does not allow this device’s volume to be changed from the app. Use the device’s own volume controls.', code: 'DEVICE_VOLUME_UNSUPPORTED', device_id: deviceId || null });
          }
          lib.json(res, status, { error: spotifyErrorMessage(data) });
        });
      }
      if (isDeviceTransfer) sendCommand(null);
      else if (requestedDeviceId) sendCommand(requestedDeviceId);
      else findDeviceId(token.access_token, sendCommand);
      });
    }); });
  });
};
