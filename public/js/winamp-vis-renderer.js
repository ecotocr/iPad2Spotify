/* Winamp audio-analysis visualizer bridge - strict ES5, Safari iOS 9.
 *
 * The Winamp module (winamp.js) owns the spectrum analyzer + Milkdrop canvases
 * and drives its own render loop. This bridge only:
 *   - registers lifecycle hooks (winampVisStart/Stop) that winamp.js/app.js use
 *     to signal when to prefer real Spotify audio-analysis data, and
 *   - keeps a back-compatible window.updateVisualizer() sink.
 *
 * The real rendering is done by winamp.js, which polls
 * window.getAudioAnalysisBands() (provided by audio-analysis-engine.js) and
 * prefers those bands over its deterministic pseudo-spectrum. No separate
 * canvas or animation loop lives here, so nothing is destroyed when
 * WinampMode.create() rewrites the #winamp innerHTML, and the render loop is
 * started/stopped exactly once by the Winamp module itself.
 */
(function () {
  'use strict';
  var active = false;

  // winamp.js polls this to decide whether to render real analysis bands.
  window.winampVisActive = function () { return active; };

  window.winampVisStart = function () {
    active = true;
    // Ensure the engine has data for the current track before the loop shows it.
    if (window.requestAudioAnalysis) window.requestAudioAnalysis();
  };

  window.winampVisStop = function () {
    active = false;
  };

  // Back-compat: callers may pass an analysis sample. The real rendering happens
  // in winamp.js via getAudioAnalysisBands(); this is an intentional no-op so
  // old callers do not crash.
  window.updateVisualizer = function (/* data */) {
    return;
  };
})();
