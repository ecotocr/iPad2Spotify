var lib = require('../_lib');
var URL = require('url').URL;
function playlistIdFromContext(context) {
  if (!context || typeof context.uri !== 'string') return null;
  var match = context.uri.match(/^spotify:playlist:([A-Za-z0-9]{10,30})$/) ||
    context.uri.match(/^spotify:user:[A-Za-z0-9._-]{1,64}:playlist:([A-Za-z0-9]{10,30})$/);
  return match ? match[1] : null;
}
function trackDetails(track, position, playable) {
  if (!track || !track.uri) return null;
  var artists = Array.isArray(track.artists) ? track.artists.map(function (artist) {
    return artist && typeof artist.name === 'string' ? artist.name.slice(0, 100) : '';
  }).filter(Boolean) : [];
  var album = track.album || {};
  var images = Array.isArray(album.images) ? album.images.filter(function (image) {
    return image && lib.isSpotifyImageUrl(image.url);
  }).map(function (image) {
    return { url: image.url };
  }) : [];
  return {
    position: position,
    id: typeof track.id === 'string' ? track.id : track.uri.split(':').pop(),
    uri: track.uri,
    name: typeof track.name === 'string' ? track.name.slice(0, 200) : 'Unavailable track',
    artists: artists,
    album_name: typeof album.name === 'string' ? album.name.slice(0, 200) : '',
    album_images: images,
    duration_ms: Number.isInteger(track.duration_ms) ? track.duration_ms : 0,
    playable: !!playable && track.type === 'track' && track.is_local !== true && track.uri.indexOf('spotify:track:') === 0
  };
}
function loadPlaylist(accessToken, playback, playlistId, requestedPlaylistId, playlistOffset, res) {
  if (requestedPlaylistId && requestedPlaylistId !== playlistId) {
    return lib.json(res, 409, { error: 'Playback has moved to a different playlist. Refresh the track list.' });
  }
  var headers = { Authorization: 'Bearer ' + accessToken };
  function requestPlaylistItems(endpoint) {
    var playlistUrl = 'https://api.spotify.com/v1/playlists/' + playlistId + '/' + endpoint + '?limit=50&offset=' + playlistOffset;
    lib.request(playlistUrl, { headers: headers }, function (playlistErr, playlistStatus, playlistData) {
      if (playlistStatus === 404 && endpoint === 'items') return requestPlaylistItems('tracks');
      if (playlistStatus === 404 && endpoint === 'tracks') return loadCurrentQueue(accessToken, playback, res);
      if (playlistErr) return lib.json(res, 502, { error: 'Could not load the current playlist tracks.' });
      if (playlistStatus === 403) {
        return lib.json(res, 403, { error: 'Spotify has not granted playlist access to this profile. Use Add profile to authorize this account again with the new playlist permissions.' });
      }
      if (playlistStatus !== 200 || !playlistData || !Array.isArray(playlistData.items)) {
        return lib.json(res, playlistStatus || 502, playlistData || { error: 'Spotify could not load the current playlist tracks.' });
      }
      var items = playlistData.items.map(function (entry, index) {
        var track = entry && (entry.item || entry.track);
        return trackDetails(track, playlistOffset + index, !!entry && !entry.is_local);
      }).filter(Boolean);
      var total = Number.isInteger(playlistData.total) ? playlistData.total : playlistOffset + items.length;
      var nextOffset = playlistOffset + playlistData.items.length;
      lib.json(res, 200, {
        source: 'playlist',
        playlist_id: playlistId,
        items: items,
        total: total,
        current_track_uri: playback.item && playback.item.uri || null,
        device_id: playback.device && playback.device.id || null,
        next_offset: nextOffset < total ? nextOffset : null
      });
    });
  }
  requestPlaylistItems('items');
}
function loadCurrentQueue(accessToken, playback, res) {
  lib.request('https://api.spotify.com/v1/me/player/queue', { headers: { Authorization: 'Bearer ' + accessToken } }, function (queueErr, queueStatus, queueData) {
    if (queueErr) return lib.json(res, 502, { error: 'Could not load the current Spotify queue.' });
    if (queueStatus !== 200 || !queueData) {
      if (queueStatus === 403) return lib.json(res, 403, { error: 'Spotify denied access to the playback queue. Reauthorize this account to refresh its playback permissions.' });
      return lib.json(res, queueStatus || 502, queueData || { error: 'Could not load the current Spotify queue.' });
    }
    var items = [];
    function addTrack(track) {
      var details = trackDetails(track, items.length, true);
      if (details) items.push(details);
    }
    var currentlyPlaying = queueData.currently_playing || (playback && playback.item);
    addTrack(currentlyPlaying);
    if (Array.isArray(queueData.queue)) {
      for (var i = 0; i < queueData.queue.length; i++) addTrack(queueData.queue[i]);
    }
    lib.json(res, 200, {
      source: 'queue',
      playlist_id: null,
      items: items,
      total: items.length,
      current_track_uri: currentlyPlaying && currentlyPlaying.uri || null,
      device_id: playback && playback.device && playback.device.id || null,
      next_offset: null
    });
  });
}
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
          if (playbackErr) return lib.json(res, 502, { error: 'Could not identify the current Spotify playback context.' });
          if (playbackStatus === 204) {
            if (requestedPlaylistId) return lib.json(res, 409, { error: 'Spotify no longer reports the playlist that was open. Close and reopen the track list.' });
            return loadCurrentQueue(token.access_token, null, res);
          }
          if (playbackStatus !== 200 || !playback) return lib.json(res, playbackStatus || 502, playback || { error: 'Could not identify the current Spotify playback context.' });
          var playlistId = playlistIdFromContext(playback.context);
          if (playlistId) return loadPlaylist(token.access_token, playback, playlistId, requestedPlaylistId, playlistOffset, res);
          if (requestedPlaylistId) return lib.json(res, 409, { error: 'Spotify no longer reports the playlist that was open. Close and reopen the track list.' });
          lib.request('https://api.spotify.com/v1/me/player', { headers: { Authorization: 'Bearer ' + token.access_token } }, function (stateErr, stateStatus, state) {
            if (stateErr) return lib.json(res, 502, { error: 'Could not identify the current Spotify playback context.' });
            var statePlaylistId = stateStatus === 200 && state ? playlistIdFromContext(state.context) : null;
            if (statePlaylistId) return loadPlaylist(token.access_token, state, statePlaylistId, null, playlistOffset, res);
            loadCurrentQueue(token.access_token, playback, res);
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
