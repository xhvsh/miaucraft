// Fullscreen gallery viewer for waypoint screenshots. Opens over whatever is
// on screen and lets the user page through a whole waypoint's images: arrow
// buttons + arrow keys + click/drag on desktop, horizontal swipe on touch
// (arrows are hidden there by CSS). The set is laid out three times in a
// sliding track (prev | middle | next copy), so swiping past either end just
// keeps going instead of hitting a wall: once the strip settles on a copy,
// it's yanked back to the identical middle-copy position with no animation,
// which reads as an infinite loop. A strip of thumbnails lets you jump
// straight to any shot. A bar over the image credits who added the shot and
// when. With a single image (or no metadata) it degrades back to the old
// plain lightbox: no arrows, no bar, no thumbs.
//
// The viewer markup only exists on the map page; other pages pull this module
// in indirectly through waypoint-ui, so without the markup everything below
// degrades to no-ops instead of killing the importing page.

const root = document.getElementById("imageLightbox");
const trackEl = document.getElementById("galleryViewerTrack");
const thumbsEl = document.getElementById("galleryViewerThumbs");
const barEl = document.getElementById("galleryViewerBar");
const captionEl = document.getElementById("galleryViewerCaption");
const creditEl = document.getElementById("galleryViewerCredit");
const counterEl = document.getElementById("galleryViewerCounter");
const prevBtn = document.getElementById("galleryViewerPrev");
const nextBtn = document.getElementById("galleryViewerNext");
const closeBtn = document.getElementById("galleryViewerClose");

const ready = Boolean(root && trackEl && thumbsEl && barEl && captionEl && creditEl && counterEl && prevBtn && nextBtn && closeBtn);

const state = { images: [], index: 0, pos: 0 };

// Set while a swipe/drag is in progress so the click event fired on release
// (drag ending off the container lands on the backdrop) doesn't close it.
let suppressNextClick = false;

let lastFocused = null;

// When a loop-step lands on a clone slide (one past either end) we wait for
// the transition to finish and then snap the strip back, no animation, to the
// identical-looking real slide (the "middle copy"). Kept as a single handler
// so repeated opens never stack listeners.
let snapHandler = null;

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function makeSlide(image) {
  const slide = document.createElement("div");
  slide.className = "gallery-viewer-slide";
  const img = document.createElement("img");
  img.src = image.url;
  img.alt = image.caption || image.alt || "Waypoint screenshot";
  img.draggable = false;
  slide.appendChild(img);
  return slide;
}

function buildSlides() {
  const many = state.images.length > 1;
  const frag = document.createDocumentFragment();
  if (many) {
    frag.appendChild(makeSlide(state.images[state.images.length - 1]));
  }
  for (const image of state.images) {
    frag.appendChild(makeSlide(image));
  }
  if (many) {
    frag.appendChild(makeSlide(state.images[0]));
  }
  trackEl.innerHTML = "";
  trackEl.appendChild(frag);
}

function buildThumbs() {
  const many = state.images.length > 1;
  thumbsEl.hidden = !many;
  thumbsEl.innerHTML = "";
  if (!many) return;
  const frag = document.createDocumentFragment();
  state.images.forEach((image, i) => {
    const thumb = document.createElement("div");
    thumb.className = "gallery-viewer-thumb";
    thumb.dataset.index = String(i);
    const img = document.createElement("img");
    img.src = image.url;
    img.alt = "";
    img.draggable = false;
    img.loading = "lazy";
    thumb.appendChild(img);
    thumb.addEventListener("click", () => jumpTo(i));
    frag.appendChild(thumb);
  });
  thumbsEl.appendChild(frag);
}

function updateThumbPos() {
  if (!thumbsEl || thumbsEl.hidden) return;
  for (const t of thumbsEl.children) {
    t.classList.toggle("active", Number(t.dataset.index) === state.index);
  }
  const active = thumbsEl.children[state.index];
  if (active && active.scrollIntoView) {
    try {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* older engines - ignore */
    }
  }
}

function render() {
  const image = state.images[state.index];
  if (!image || !image.url) return;

  const many = state.images.length > 1;
  counterEl.hidden = !many;
  if (many) counterEl.textContent = `${state.index + 1} / ${state.images.length}`;
  prevBtn.disabled = !many;
  nextBtn.disabled = !many;

  const caption = (image.caption || "").trim();
  captionEl.hidden = !caption;
  if (caption) captionEl.textContent = caption;

  const who = (image.uploaded_by_username || "").trim();
  const when = formatDate(image.created_at);
  creditEl.hidden = !who && !when;
  creditEl.textContent = "";
  if (who) {
    const label = document.createElement("span");
    label.className = "gallery-viewer-credit-label";
    label.textContent = "Added by";
    creditEl.appendChild(label);
    const name = document.createElement("strong");
    name.textContent = who;
    creditEl.appendChild(name);
  }
  if (when) {
    if (who) creditEl.appendChild(document.createTextNode(" · "));
    creditEl.appendChild(document.createTextNode(when));
  }

  barEl.hidden = !many && !caption && creditEl.hidden;
  updateThumbPos();
}

// Physical position within the track. pos 1..n are the real slides (logical
// index = pos - 1); pos 0 is a clone of the last image and pos n+1 a clone of
// the first, which make the track loop seamlessly past both ends.
function offsetFor(pos) {
  if (state.images.length <= 1) return 0;
  return -pos * trackEl.clientWidth;
}

function applyOffset(offset, animate = true) {
  trackEl.classList.toggle("dragging", !animate);
  trackEl.style.transform = `translateX(${offset}px)`;
}

// If we're parked on a clone (one past an edge), snap back - no animation - to
// the visually identical real slide before taking another step.
function normalizePosition() {
  const n = state.images.length;
  if (state.pos === 0) state.pos = n;
  else if (state.pos > n) state.pos = 1;
  else return false;
  applyOffset(offsetFor(state.pos), false);
  return true;
}

function snapAfterTransition(targetPos) {
  const n = state.images.length;
  if (targetPos !== 0 && targetPos !== n + 1) return;
  const finish = () => {
    if (state.pos === 0) state.pos = n;
    else if (state.pos > n) state.pos = 1;
    applyOffset(offsetFor(state.pos), false);
  };
  // Wait for the transition to that clone to land, then hide the reset.
  // Guard the final position so a stale listener from a previous step can't
  // snap an unrelated transition.
  const onTransformEnd = (e) => {
    if (e.propertyName !== "transform" || state.pos !== targetPos) return;
    trackEl.removeEventListener("transitionend", onTransformEnd);
    if (snapHandler === onTransformEnd) snapHandler = null;
    finish();
  };
  if (snapHandler) trackEl.removeEventListener("transitionend", snapHandler);
  snapHandler = onTransformEnd;
  trackEl.addEventListener("transitionend", onTransformEnd);
}

function clearPendingSnap() {
  if (snapHandler) {
    trackEl.removeEventListener("transitionend", snapHandler);
    snapHandler = null;
  }
}

function go(delta) {
  const n = state.images.length;
  if (n < 2) return;
  normalizePosition();
  let nextPos = state.pos + delta;
  let nextIndex;
  if (nextPos < 1) {
    nextPos = 0;
    nextIndex = n - 1;
  } else if (nextPos > n) {
    nextPos = n + 1;
    nextIndex = 0;
  } else {
    nextIndex = nextPos - 1;
  }
  state.index = nextIndex;
  state.pos = nextPos;
  applyOffset(offsetFor(nextPos), true);
  render();
  snapAfterTransition(nextPos);
}

function jumpTo(index) {
  if (index < 0 || index >= state.images.length || index === state.index) return;
  normalizePosition();
  state.index = index;
  state.pos = index + 1;
  applyOffset(offsetFor(state.pos), true);
  render();
}

export function openGalleryViewer(images, index = 0) {
  if (!ready || !Array.isArray(images) || !images.length) return;
  const start = Math.min(Math.max(index, 0), images.length - 1);
  if (!images[start]?.url) return;
  lastFocused = document.activeElement;
  state.images = images;
  state.index = start;
  state.pos = start + 1;
  clearPendingSnap();
  buildSlides();
  buildThumbs();
  // Unhide first: offsetFor() reads the track's clientWidth, which is 0 while
  // the lightbox is display:none. Laying out every slide one after the other
  // makes the whole strip visible on entry, so position it before any paint.
  root.hidden = false;
  applyOffset(offsetFor(state.pos), false);
  render();
  (window.requestAnimationFrame || ((cb) => setTimeout(cb, 0)))(() => {
    trackEl.classList.remove("dragging");
  });
  closeBtn.focus();
}

export function openSingleImage(src, alt = "") {
  if (!src) return;
  openGalleryViewer([{ url: src, alt, caption: null }], 0);
}

if (ready) {
  function closeViewer() {
    root.hidden = true;
    state.images = [];
    state.index = 0;
    state.pos = 0;
    clearPendingSnap();
    trackEl.innerHTML = "";
    trackEl.style.transform = "";
    trackEl.classList.remove("dragging");
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));
  closeBtn.addEventListener("click", closeViewer);
  root.addEventListener("click", (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    // Clicking the backdrop or the dead space around the image (the slide
    // div that fills the viewport) closes the viewer; clicking the image,
    // the metadata bar, arrows, close button or thumbnails never does.
    if (e.target.closest(".gallery-viewer-slide img, .gallery-viewer-bar, .gallery-viewer-arrow, .gallery-viewer-close, .gallery-viewer-thumbs")) return;
    closeViewer();
  });
  document.addEventListener("keydown", (e) => {
    if (root.hidden) return;
    if (e.key === "Escape") {
      // The viewer sits above other modals (waypoint detail); without this the
      // Escape would close those too, since this listener runs first.
      e.stopImmediatePropagation();
      closeViewer();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "Home" && state.images.length > 1) {
      e.preventDefault();
      jumpTo(0);
    } else if (e.key === "End" && state.images.length > 1) {
      e.preventDefault();
      jumpTo(state.images.length - 1);
    }
  });

  // Horizontal drag/swipe: pointer events cover touch and mouse alike; CSS
  // `touch-action: pan-y` keeps vertical page gestures native while horizontal
  // drags are ours. The whole strip follows the pointer, clamped to one slide
  // width so a swipe never exposes the far end of the looped track.
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragDx = 0;
  let dragMoved = false;

  trackEl.addEventListener("pointerdown", (e) => {
    if (root.hidden || state.images.length < 2) return;
    normalizePosition();
    dragPointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragDx = 0;
    dragMoved = false;
    trackEl.setPointerCapture(e.pointerId);
    trackEl.classList.add("dragging");
  });

  trackEl.addEventListener("pointermove", (e) => {
    if (e.pointerId !== dragPointerId) return;
    const width = trackEl.clientWidth || 1;
    const dx = Math.max(-width, Math.min(width, e.clientX - dragStartX));
    const dy = e.clientY - dragStartY;
    if (!dragMoved && Math.hypot(dx, dy) > 8) dragMoved = true;
    if (dragMoved && Math.abs(dx) > Math.abs(dy)) {
      dragDx = dx;
      applyOffset(offsetFor(state.pos) + dragDx, false);
    }
  });

  const endDrag = (e) => {
    if (e.pointerId !== dragPointerId) return;
    dragPointerId = null;
    trackEl.classList.remove("dragging");
    if (dragMoved) {
      suppressNextClick = true;
      if (Math.abs(dragDx) > 60) go(dragDx < 0 ? 1 : -1);
      else applyOffset(offsetFor(state.pos), true);
    } else {
      applyOffset(offsetFor(state.pos), true);
    }
    dragDx = 0;
    dragMoved = false;
  };
  trackEl.addEventListener("pointerup", endDrag);
  trackEl.addEventListener("pointercancel", endDrag);
}