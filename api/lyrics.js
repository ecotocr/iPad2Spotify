var lib = require('./_lib');

module.exports = function (req, res) {
  if ((req.method || '').toUpperCase() !== 'GET') return lib.json(res, 405, { error: 'Expected GET but received ' + req.method + '.' });
  if (lib.memoryRateLimit(req, 'lyrics', 10, 60)) return lib.json(res, 429, { error: 'Too many lyrics requests. Try again shortly.' });

  var query = new URL(req.url, 'https://localhost').searchParams;
  var artist = (query.get('artist') || '').trim();
  var title = (query.get('title') || '').trim();
  if (!artist || !title || artist.length > 120 || title.length > 120 || /[\u0000-\u001f\u007f]/.test(artist + title)) {
    return lib.json(res, 400, { error: 'A valid artist and track title are required.' });
  }
  if (!lib.cookie(req, 'spotify_session')) return lib.json(res, 401, { error: 'Pair this fullscreen app first.' });

  lib.getSession(req, res, function (err, session) {
    if (err || !session) return lib.json(res, 401, { error: 'Session expired. Pair again.' });
    var url = 'https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title);
    lib.request(url, { timeout: 8000 }, function (apiErr, status, data) {
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
};
