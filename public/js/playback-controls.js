(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.playbackControls = factory();
}(this, function () {
  function previousAction(playback, now) {
    var elapsed = playback.progress_ms || 0;
    if (playback.is_playing && typeof playback.fetched_at === 'number') elapsed += Math.max(0, now - playback.fetched_at);
    return elapsed > 3000 ? 'restart' : 'previous';
  }
  return { previousAction: previousAction };
}));
