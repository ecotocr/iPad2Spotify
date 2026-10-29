var lib = require('../_lib');
module.exports = function (req, res) {
  lib.rateLimit(req, 'callback', 20, 600, function (limitErr, limited) {
  if (limitErr) return lib.json(res, 503, { error: 'Rate-limit storage is unavailable.' });
  if (limited) return lib.json(res, 429, { error: 'Too many authorization attempts. Try again later.' });
  var q = require('url').parse(req.url, true).query, cfg = lib.config(req), expected = lib.cookie(req, 'spotify_oauth_state');
  if (!q.code || !q.state || !expected || q.state !== expected) return lib.json(res, 400, { error: 'OAuth state mismatch. Start login again.' });
  var body = 'grant_type=authorization_code&code=' + encodeURIComponent(q.code) + '&redirect_uri=' + encodeURIComponent(cfg.redirect);
  lib.spotifyToken(cfg, body, function (err, status, data) {
    if (err || status !== 200 || !data || !data.refresh_token) return lib.json(res, 502, { error: 'Spotify token exchange failed.' });
    lib.spotifyUserProfile(data.access_token, function (profileErr, profile) {
    var pair = lib.pairingCode(8);
    var record = {
      refresh_token: data.refresh_token,
      created: new Date().getTime(),
      expires: new Date().getTime() + 600000,
      profile_metadata_checked: !profileErr && !!profile
    };
    if (profile) {
      record.user_id = profile.user_id;
      record.display_name = profile.display_name;
      record.avatar_url = profile.avatar_url;
    }
    record.profile_id = lib.createProfileId(record.user_id);
    lib.kvSet('pair:' + pair, record, 600, function (kvErr) {
      if (kvErr) return lib.json(res, 503, { error: kvErr.message || 'Pairing storage failed. Check the Vercel KV/Upstash variables and redeploy.' });
      lib.clearCookie(res, 'spotify_oauth_state');
      res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Spotify pairing code</title><style>body{font-family:Arial;background:#101211;color:#f5f1e8;text-align:center;padding:12vh 20px}h1{font-size:24px;font-weight:normal}strong{display:block;color:#b6d64b;font-size:52px;letter-spacing:.15em;margin:35px 0}p{color:#b8c4b6;line-height:1.6}</style><h1>Spotify login complete</h1><strong>' + pair + '</strong><p>Open the iPad2Spotify Home Screen app and enter this code.<br>This code expires in 10 minutes and can be used once.</p>');
    });
    });
  });
  });
};
