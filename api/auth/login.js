var lib = require('../_lib');
module.exports = function (req, res) {
  lib.rateLimit(req, 'login', 10, 600, function (limitErr, limited) {
  if (limitErr) return lib.json(res, 503, { error: 'Rate-limit storage is unavailable.' });
  if (limited) return lib.json(res, 429, { error: 'Too many login attempts. Try again in a few minutes.' });
  var cfg = lib.config(req);
  if (!cfg.id || !cfg.secret) return lib.json(res, 500, { error: 'Vercel Spotify environment variables are not configured.' });
  var state = lib.random(18);
  lib.setCookie(res, 'spotify_oauth_state', state, 600, !lib.isLocalHost(req));
  lib.redirect(res, 'https://accounts.spotify.com/authorize?' + [
    'response_type=code', 'client_id=' + encodeURIComponent(cfg.id), 'scope=' + encodeURIComponent('user-read-private user-read-currently-playing user-read-playback-state user-modify-playback-state user-read-recently-played playlist-read-private playlist-read-collaborative'), 'redirect_uri=' + encodeURIComponent(cfg.redirect), 'state=' + encodeURIComponent(state), 'show_dialog=true'
  ].join('&'));
  });
};
