// Fit a fixed desktop layout (DESIGN_W x DESIGN_H CSS px) onto phones and tablets.
// Mobile browsers lay the page out at the viewport width we ask for and scale it to the
// screen, so asking for a width big enough for the whole design makes every screen fit.
// Desktop browsers and the Electron app ignore the viewport tag, so nothing changes there.
(function () {
  var DESIGN_W = 1280, DESIGN_H = 720;
  var meta = document.querySelector('meta[name="viewport"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
  function fit() {
    var sw = screen.width, sh = screen.height;
    if (window.matchMedia && window.matchMedia('(orientation: landscape)').matches && sh > sw) { var t = sw; sw = sh; sh = t; }
    if (Math.min(sw, sh) >= 900) { meta.content = 'width=device-width, initial-scale=1'; return; } // tablets / desktops
    var w = Math.ceil(Math.max(DESIGN_W, DESIGN_H * sw / sh));
    meta.content = 'width=' + w + ', user-scalable=no';
  }
  fit();
  window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
})();
