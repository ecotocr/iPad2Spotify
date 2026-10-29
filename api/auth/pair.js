var lib = require('../_lib');
function listProfiles(req, res) {
  if (lib.memoryRateLimit(req, 'profiles', 30, 60)) return lib.json(res, 429, { error: 'Too many profile requests. Try again shortly.' });
  lib.getSession(req, res, function (sessionErr, session) {
    if (sessionErr) return lib.json(res, 503, { error: 'Could not load the current Spotify session.' });
    lib.ensureProfileStore(req, res, function (storeErr, storeId) {
      if (storeErr) return lib.json(res, 500, { error: 'Could not initialize this installation.' });
      lib.getProfileStore(storeId, function (profileErr, profiles) {
        if (profileErr) return lib.json(res, 503, { error: 'Could not load saved Spotify profiles.' });
        var changed = false;
        if (session && session.refresh_token) {
          var profileId = session.profile_id || lib.createProfileId(session.user_id);
          var matching = null;
          for (var i = 0; i < profiles.length; i++) {
            if (profiles[i].id === profileId || (session.user_id && profiles[i].user_id === session.user_id)) {
              matching = profiles[i];
              break;
            }
          }
          if (!matching) {
            matching = lib.upsertProfile(profiles, {
              id: profileId,
              user_id: session.user_id || null,
              refresh_token: session.refresh_token,
              display_name: session.display_name || null,
              avatar_url: session.avatar_url || null
            });
            changed = true;
          } else {
            profileId = matching.id;
            if (matching.refresh_token !== session.refresh_token) {
              matching.refresh_token = session.refresh_token;
              changed = true;
            }
          }
          session.profile_id = profileId;
          session.profile_store_id = storeId;
          lib.setSession(res, session, !lib.isLocalHost(req));
        }
        function respond() {
          lib.json(res, 200, {
            profiles: profiles.filter(function (profile) {
              return profile && typeof profile.id === 'string' && typeof profile.refresh_token === 'string';
            }).map(lib.publicProfile)
          });
        }
        if (!changed) return respond();
        lib.saveProfileStore(storeId, profiles, function (saveErr) {
          if (saveErr) return lib.json(res, 503, { error: 'Could not save this Spotify profile on the installation.' });
          respond();
        });
      });
    });
  });
}
function selectProfile(req, res, body) {
  if (lib.memoryRateLimit(req, 'select-profile', 30, 60)) return lib.json(res, 429, { error: 'Too many profile selections. Try again shortly.' });
  var id = body && typeof body.profile_id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(body.profile_id) ? body.profile_id : null;
  if (!id) return lib.json(res, 400, { error: 'Choose a valid Spotify profile.' });
  var storeId = lib.profileStoreId(req);
  if (!storeId) return lib.json(res, 401, { error: 'No profiles are saved on this installation.' });
  lib.getProfileStore(storeId, function (profileErr, profiles) {
    if (profileErr) return lib.json(res, 503, { error: 'Could not load saved Spotify profiles.' });
    var selected = null;
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i] && profiles[i].id === id && typeof profiles[i].refresh_token === 'string') {
        selected = profiles[i];
        break;
      }
    }
    if (!selected) return lib.json(res, 404, { error: 'That Spotify profile is no longer available. Refresh profiles and try again.' });
    var session = { refresh_token: selected.refresh_token, profile_id: selected.id, profile_store_id: storeId };
    if (selected.user_id) session.user_id = selected.user_id;
    if (!lib.setSession(res, session, !lib.isLocalHost(req))) return lib.json(res, 500, { error: 'Session encryption is not configured.' });
    lib.json(res, 200, { selected: lib.publicProfile(selected) });
  });
}
function addProfile(req, res, body) {
  var code = body && body.code;
  code = String(code || '').replace(/[^a-z0-9]/ig, '').toUpperCase();
  if (!code || code.length < 6) return lib.json(res, 400, { error: 'Enter the pairing code shown after Spotify login.' });
  lib.kvGet('pair:' + code, function (err, record) {
        if (err) return lib.json(res, 503, { error: 'Could not verify the pairing code.' });
        if (!record || !record.refresh_token || record.expires < new Date().getTime()) return lib.json(res, 401, { error: 'Code is invalid or expired.' });
        lib.getSession(req, res, function (sessionErr, currentSession) {
          if (sessionErr) return lib.json(res, 503, { error: 'Could not load the current Spotify session.' });
          lib.ensureProfileStore(req, res, function (storeErr, storeId) {
            if (storeErr) return lib.json(res, 500, { error: 'Could not initialize this installation.' });
            lib.getProfileStore(storeId, function (profileErr, profiles) {
              if (profileErr) return lib.json(res, 503, { error: 'Could not load saved Spotify profiles.' });
              if (currentSession && currentSession.refresh_token) {
                var existingId = currentSession.profile_id || lib.createProfileId(currentSession.user_id);
                var existingProfile = lib.upsertProfile(profiles, {
                  id: existingId,
                  user_id: currentSession.user_id || null,
                  refresh_token: currentSession.refresh_token,
                  display_name: currentSession.display_name || null,
                  avatar_url: currentSession.avatar_url || null
                });
                currentSession.profile_id = existingProfile.id;
                currentSession.profile_store_id = storeId;
                lib.setSession(res, currentSession, !lib.isLocalHost(req));
              }
              var profile = lib.upsertProfile(profiles, {
                id: record.profile_id || lib.createProfileId(record.user_id),
                user_id: record.user_id || null,
                display_name: record.display_name || null,
                avatar_url: record.avatar_url || null,
                refresh_token: record.refresh_token
              });
              if (currentSession && currentSession.profile_id === profile.id) {
                currentSession.refresh_token = profile.refresh_token;
                lib.setSession(res, currentSession, !lib.isLocalHost(req));
              }
              lib.saveProfileStore(storeId, profiles, function (saveErr) {
                if (saveErr) return lib.json(res, 503, { error: 'Could not save this Spotify profile on the installation.' });
                if (!currentSession) {
                  var firstSession = { refresh_token: profile.refresh_token, profile_id: profile.id, profile_store_id: storeId };
                  if (profile.user_id) firstSession.user_id = profile.user_id;
                  if (!lib.setSession(res, firstSession, !lib.isLocalHost(req))) return lib.json(res, 500, { error: 'Session encryption is not configured.' });
                }
                lib.kvDel('pair:' + code, function (deleteErr) {
                  if (deleteErr) return lib.json(res, 503, { error: 'Profile was saved, but the pairing code could not be retired.' });
                  function respond() {
                    lib.json(res, 200, {
                      connected: true,
                      profiles: profiles.map(lib.publicProfile)
                    });
                  }
                  var badgeId = lib.badgeId(record.user_id);
                  if (!badgeId) return respond();
                  lib.kvGet('badge:' + badgeId, function (badgeErr, badge) {
                    if (badgeErr || !badge) return respond();
                    lib.kvSet('badge:' + badgeId, { refresh_token: record.refresh_token, user_id: record.user_id }, 31536000, function () { respond(); });
                  });
                });
              });
            });
          });
        });
  });
}
module.exports = function (req, res) {
  var method = (req.method || '').toUpperCase();
  if (method === 'GET') return listProfiles(req, res);
  if (method !== 'POST') return lib.json(res, 405, { error: 'Expected GET or POST but received ' + req.method + '.' });
  lib.readBody(req, function (raw) {
    var body;
    try { body = JSON.parse(raw); } catch (e) {}
    if (body && body.profile_id !== undefined) return selectProfile(req, res, body);
    lib.rateLimit(req, 'pair', 12, 600, function (limitErr, limited) {
      if (limitErr) return lib.json(res, 503, { error: 'Rate-limit storage is unavailable.' });
      if (limited) return lib.json(res, 429, { error: 'Too many pairing attempts. Try again later.' });
      addProfile(req, res, body);
    });
  });
};
