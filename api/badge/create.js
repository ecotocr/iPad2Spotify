var lib = require('../_lib');
// Creates (or refreshes) the account's badge. The URL is derived from the Spotify user ID,
// so it stays the same across re-logins and repeated clicks.
module.exports = function (req, res) {
  if ((req.method || '').toUpperCase() !== 'POST') return lib.json(res, 405, { error: 'Expected POST but received ' + req.method + '.' });
  if (!lib.cookie(req, 'spotify_session')) return lib.json(res, 401, { error: 'Pair this fullscreen app first.' });
  lib.rateLimit(req, 'badge-create', 10, 3600, function (limitErr, limited) {
    if (limitErr) return lib.json(res, 503, { error: 'Rate-limit storage is unavailable.' });
    if (limited) return lib.json(res, 429, { error: 'Too many badge requests. Try again later.' });
    lib.getSession(req, res, function (sessionErr, session) {
      if (sessionErr || !session) return lib.json(res, 401, { error: 'Session expired. Pair again.' });
      function save(userId) {
        var id = lib.badgeId(userId);
        if (!id) return lib.json(res, 502, { error: 'Could not read your Spotify account ID.' });
        lib.kvSet('badge:' + id, { refresh_token: session.refresh_token, user_id: userId }, 31536000, function (err) {
          if (err) return lib.json(res, 503, { error: 'Could not create badge.' });
          lib.json(res, 200, { key: id, url: lib.origin(req) + '/api/badge/' + encodeURIComponent(id) + '.svg' });
        });
      }
      if (lib.badgeId(session.user_id)) return save(session.user_id);
      // Sessions paired before account IDs were recorded: look the ID up once and remember it in the cookie.
      lib.spotifyToken(lib.config(req), 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refresh_token), function (tokenErr, tokenStatus, token) {
        if (tokenErr || tokenStatus !== 200 || !token || !token.access_token) return lib.json(res, 401, { error: 'Spotify authorization expired. Pair again.' });
        lib.updateRefreshToken(res, session, token, function (profileSaveErr) {
        if (profileSaveErr) return lib.json(res, 503, { error: 'Could not save refreshed Spotify profile credentials.' });
        lib.spotifyUserId(token.access_token, function (userId) {
          if (userId) { session.user_id = userId; lib.setSession(res, session); }
          save(userId);
        });
        });
      });
    });
  });
};
