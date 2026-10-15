/**
 * LUXE — Scroll-Driven Hero Frame Animation
 * Canvas-based, zero-dependency, fully responsive.
 *
 * Strategy
 * ─────────
 * • Canvas always fills the full viewport (100 vw × 100 vh), exactly like
 *   CSS `object-fit: cover`.  Frames are 16:9 source images; we compute
 *   cover-crop offsets on every resize so the image always fills the
 *   canvas without distortion or black bars.
 *
 * • Frames load in 3 passes:
 *     1. First frame   → paint immediately so the canvas is never blank.
 *     2. Priority batch (every 4th frame) → interactive in < 1 s.
 *     3. Full set      → fills in gaps in the background.
 *
 * • Scroll progress is mapped to a floating-point frame index.
 * • requestAnimationFrame drives rendering; scroll events only update
 *   the target index — never call drawImage directly in a scroll handler.
 * • The hero <section> is as tall as SCROLL_MULTIPLIER × viewport so
 *   CSS `position:sticky` pins the canvas while the user scrolls through
 *   the full animation before the page continues.
 */

(function () {
  "use strict";

  /* ─── Config ──────────────────────────────────────────────── */
  const TOTAL_FRAMES      = 144;
  const SCROLL_MULTIPLIER = 5;       // hero section height = 5× viewport
  const LERP_FACTOR       = 0.12;    // easing — tune to taste
  const FRAME_PATH        = (n) =>
    `assets/hero-frames/frame-${String(n).padStart(4, "0")}.webp`;

  /* ─── DOM refs ────────────────────────────────────────────── */
  const heroSection = document.getElementById("hero");
  const canvas      = document.getElementById("hero-canvas");
  const ctx         = canvas.getContext("2d", { alpha: false });

  /* ─── State ───────────────────────────────────────────────── */
  const images       = new Array(TOTAL_FRAMES).fill(null);
  let   currentIndex = 0;     // floating-point frame index (0-based)
  let   targetIndex  = 0;
  let   rafId        = null;

  // Cover-crop geometry — recomputed on resize
  let srcNativeW = 0;
  let srcNativeH = 0;
  let coverSx = 0, coverSy = 0, coverSw = 0, coverSh = 0;  // source rect
  let coverDx = 0, coverDy = 0, coverDw = 0, coverDh = 0;  // dest rect

  /* ─── Compute cover-crop rects ───────────────────────────── */
  /**
   * Given the source image's intrinsic size and the current canvas
   * CSS / backing-store dimensions, compute the drawImage rects that
   * replicate CSS object-fit:cover (fill canvas, no distortion, crop
   * excess from edges centred).
   *
   * We draw to the full backing-store rectangle (0,0,backW,backH) so
   * DPR is already handled — no need to scale the ctx.
   */
  function computeCoverRects(backW, backH) {
    if (!srcNativeW || !srcNativeH) return false;

    const srcAspect  = srcNativeW / srcNativeH;
    const destAspect = backW / backH;

    let sw, sh, sx, sy;

    if (destAspect >= srcAspect) {
      // Canvas is wider (or same) → fit width, crop top/bottom of source
      sw = srcNativeW;
      sh = Math.round(srcNativeW / destAspect);
      sx = 0;
      sy = Math.round((srcNativeH - sh) / 2);
    } else {
      // Canvas is taller → fit height, crop left/right of source
      sh = srcNativeH;
      sw = Math.round(srcNativeH * destAspect);
      sy = 0;
      sx = Math.round((srcNativeW - sw) / 2);
    }

    coverSx = sx;  coverSy = sy;  coverSw = sw;  coverSh = sh;
    coverDx = 0;   coverDy = 0;   coverDw = backW; coverDh = backH;
    return true;
  }

  /* ─── Resize canvas ───────────────────────────────────────── */
  function resizeCanvas() {
    const dpr  = window.devicePixelRatio || 1;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;

    // Reset transform to identity BEFORE re-scaling to avoid accumulation
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Size the canvas backing store to the full viewport at native resolution
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    // CSS box: also full viewport
    canvas.style.width  = cssW + "px";
    canvas.style.height = cssH + "px";

    // Apply DPR scale once so drawImage coords are in CSS pixels — but since
    // we pass explicit pixel rects to drawImage we skip this and work in
    // raw backing-store pixels directly.  (No ctx.scale call needed.)

    computeCoverRects(canvas.width, canvas.height);
    drawFrame(Math.round(currentIndex));
  }

  /* ─── Draw a specific loaded frame using cover crop ──────── */
  function drawFrame(idx) {
    const img = images[idx];
    if (!img) return;

    if (!coverSw) {
      // Rects not yet computed (first frame just loaded): compute now
      computeCoverRects(canvas.width, canvas.height);
    }

    ctx.drawImage(
      img,
      coverSx, coverSy, coverSw, coverSh,   // source rect (crop)
      coverDx, coverDy, coverDw, coverDh    // dest  rect (full canvas)
    );
  }

  /* ─── Find nearest loaded frame ──────────────────────────── */
  function nearestLoaded(idx) {
    const floored = Math.floor(idx);
    for (let d = 0; d < TOTAL_FRAMES; d++) {
      const lo = floored - d;
      const hi = floored + d;
      if (lo >= 0              && images[lo]) return lo;
      if (hi < TOTAL_FRAMES   && images[hi]) return hi;
    }
    return 0;
  }

  /* ─── rAF render loop ─────────────────────────────────────── */
  function tick() {
    rafId = requestAnimationFrame(tick);

    const delta = targetIndex - currentIndex;
    if (Math.abs(delta) < 0.001) return;  // nothing to do

    currentIndex += delta * LERP_FACTOR;

    const frameIdx = Math.min(
      TOTAL_FRAMES - 1,
      Math.max(0, Math.round(currentIndex))
    );

    if (images[frameIdx]) {
      drawFrame(frameIdx);
    } else {
      drawFrame(nearestLoaded(currentIndex));
    }
  }

  /* ─── Scroll handler ──────────────────────────────────────── */
  function onScroll() {
    const scrolled  = window.scrollY;                              // px from top of page
    const maxScroll = heroSection.offsetHeight - window.innerHeight;
    const progress  = Math.min(1, Math.max(0, scrolled / maxScroll));
    targetIndex     = progress * (TOTAL_FRAMES - 1);
  }

  /* ─── Image loading ───────────────────────────────────────── */
  function loadImage(n) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        images[n] = img;
        // Capture native dimensions from first frame
        if (n === 0) {
          srcNativeW = img.naturalWidth;
          srcNativeH = img.naturalHeight;
        }
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = FRAME_PATH(n + 1);    // n is 0-based; filenames are 1-based
    });
  }

  async function loadFrames() {
    /* Pass 1 — first frame: paint immediately */
    await loadImage(0);
    resizeCanvas();      // now srcNativeW/H are set → cover rects computed
    drawFrame(0);

    /* Pass 2 — every 4th frame for quick scrubability */
    const priorityFrames = [];
    for (let i = 4; i < TOTAL_FRAMES; i += 4) priorityFrames.push(i);

    const BATCH = 8;
    for (let b = 0; b < priorityFrames.length; b += BATCH) {
      await Promise.all(priorityFrames.slice(b, b + BATCH).map(loadImage));
    }

    /* Pass 3 — remaining frames in background */
    const remaining = [];
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      if (!images[i]) remaining.push(i);
    }
    for (let b = 0; b < remaining.length; b += BATCH) {
      await new Promise((r) => setTimeout(r, 0));
      await Promise.all(remaining.slice(b, b + BATCH).map(loadImage));
    }
  }

  /* ─── Hero section height ─────────────────────────────────── */
  function setHeroHeight() {
    heroSection.style.height = SCROLL_MULTIPLIER * window.innerHeight + "px";
  }

  /* ─── Init ────────────────────────────────────────────────── */
  function init() {
    setHeroHeight();
    resizeCanvas();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => {
      setHeroHeight();
      resizeCanvas();
    }, { passive: true });

    rafId = requestAnimationFrame(tick);
    loadFrames();
  }

  /* Start after DOM is ready */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
