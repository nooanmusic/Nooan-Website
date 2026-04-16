/*
 * NOAN PORTFOLIO — app.js
 * ════════════════════════
 * Architecture:
 *   - STATE:        Single global object holding runtime data, open windows, audio context.
 *   - DATA:         All content loaded from data.json (videos, games, social, theme, sounds).
 *   - WINDOWS:      Draggable window-frame elements managed via openWindow/closeWindowById.
 *                   Each gets a stacking z-index; topmost tracked in windowStack[].
 *   - HOME PANEL:   Special non-window card with flip animation (front=portrait, back=about).
 *   - SOUND:        MP3s preloaded into AudioBuffers on first interaction.
 *                   Keys defined in data.json soundEffects — see _soundEffectsGuide there.
 *   - HOW-TO:       Welcome window shown on load; "how to" button appears when dismissed.
 *   - PFP GALLERY:  Flip-through profile photos in the about section (probes assets/pfps/N.webp).
 */

/* ====== STATE ====== */
const state = {
  data: null,
  openWindows: new Set(),
  windowStack: [],       // ordered by focus, last = topmost
  nextZIndex: 100,
  audioCtx: null,
  soundBuffers: {},   // preloaded MP3 buffers
  mapRendered: false,
  hasHover: window.matchMedia('(hover: hover)').matches,
  homeOpen: true,
};

/* ====== ASSET PATHS (derived from id, dirs from data.json) ====== */
function thumbPath(id) {
  const dir = state.data?.assets?.thumbnailDir || 'assets/thumbnails';
  return `${dir}/${id}.png`;
}
function videoPath(id) {
  const dir = state.data?.assets?.videoDir || 'assets/videos';
  return `${dir}/${id}.webm`;
}
function mapIconPath(icon) {
  const dir = state.data?.assets?.mapIconDir || 'assets/icons/map';
  return `${dir}/${icon}.png`;
}

/* ====== DOM REFS ====== */
const dom = {};

function cacheDom() {
  dom.homeScreen = document.getElementById('home-screen');
  dom.homePanel = document.getElementById('home-panel');
  dom.reopenBtn = document.getElementById('reopen-btn');
  dom.closeHome = document.getElementById('close-home');
  dom.btnVideos = document.getElementById('btn-videos');
  dom.btnGames = document.getElementById('btn-games');
  dom.btnMap = document.getElementById('btn-map');
  dom.portraitImg = document.getElementById('portrait-img');
  dom.portraitArea = document.getElementById('portrait-area');
  dom.aboutBio = document.getElementById('about-bio');
  dom.flipBackBtn = document.getElementById('flip-back-btn');
  dom.closeHomeBack = document.getElementById('close-home-back');
  dom.windowVideos = document.getElementById('window-videos');
  dom.windowGames = document.getElementById('window-games');
  dom.windowMap = document.getElementById('window-map');
  dom.videosContent = document.getElementById('videos-content');
  dom.gamesContent = document.getElementById('games-content');
  dom.mapContent = document.getElementById('map-content');
  dom.howtoBtn = document.getElementById('howto-btn');
  dom.welcomeWindow = document.getElementById('welcome-window');
  dom.welcomeDismiss = document.getElementById('welcome-dismiss');
  dom.pfpGallery = document.getElementById('pfp-gallery');
}

/* ====== INIT ====== */
document.addEventListener('DOMContentLoaded', async () => {
  cacheDom();
  await loadData();
  if (!state.data) return;
  applyTheme();
  renderHome();
  bindEvents();
  initDrag();
  initHowTo();
  initPfpGallery();
});

/* ====== HOW-TO / WELCOME ====== */
function showWelcomeWindow() {
  const win = dom.welcomeWindow;
  win.hidden = false;
  // Clear any prior inline position so the browser can measure the real size
  win.style.left = '';
  win.style.top = '';
  win.classList.add('dragged', 'open');
  // Register in window system so Escape / click-to-focus work
  state.openWindows.add('welcome-window');
  bringToFront('welcome-window');
  // Measure after layout, then center based on actual rendered size
  const rect = win.getBoundingClientRect();
  win.style.left = Math.max(8, (window.innerWidth - rect.width) / 2) + 'px';
  win.style.top = Math.max(8, (window.innerHeight - rect.height) / 2) + 'px';
}

function dismissWelcome() {
  const win = dom.welcomeWindow;
  win.classList.remove('open');
  win.classList.add('closing');
  state.openWindows.delete('welcome-window');
  const idx = state.windowStack.indexOf('welcome-window');
  if (idx !== -1) state.windowStack.splice(idx, 1);
  setTimeout(() => { win.hidden = true; win.classList.remove('closing'); }, ANIM_MS);
  dom.howtoBtn.hidden = false;
}

function initHowTo() {
  // Show on first load
  showWelcomeWindow();

  dom.welcomeDismiss.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissWelcome();
  });

  // Make welcome window titlebar draggable
  makeDraggable(dom.welcomeWindow.querySelector('.window-titlebar'), dom.welcomeWindow);

  // Howto button reopens the welcome window
  dom.howtoBtn.addEventListener('click', () => {
    if (dom.welcomeWindow.hidden) {
      dom.howtoBtn.hidden = true;
      showWelcomeWindow();
    } else {
      dom.welcomeWindow.style.zIndex = state.nextZIndex++;
    }
  });
}

/* ====== PFP GALLERY (flip-through images) ====== */
function initPfpGallery() {
  const container = dom.pfpGallery;
  if (!container) return;

  // Probe for sequential images: 1.webp, 2.webp, ...
  const images = [];
  let idx = 0;

  function buildGallery() {
    if (images.length === 0) { container.style.display = 'none'; return; }

    container.innerHTML = `
      <div class="pfp-flipper">
        <div class="pfp-face pfp-front"><img src="${images[0]}" alt="Profile photo"></div>
        <div class="pfp-face pfp-back"><img src="" alt="Profile photo"></div>
      </div>`;

    const flipper = container.querySelector('.pfp-flipper');
    const frontImg = container.querySelector('.pfp-front img');
    const backImg = container.querySelector('.pfp-back img');
    let flipped = false;

    container.addEventListener('click', () => {
      if (images.length <= 1) return;
      const nextIdx = (idx + 1) % images.length;
      // Flip direction: forward (Y+180) for sequential images,
      // reverse (Y-180) when wrapping back to the first image,
      // so the card always appears to spin in the logical direction.
      const goingForward = nextIdx !== 0;

      // Load next image on the hidden face
      if (flipped) {
        frontImg.src = images[nextIdx];
      } else {
        backImg.src = images[nextIdx];
      }

      // Toggle flip direction
      flipped = !flipped;
      if (goingForward) {
        flipper.classList.remove('flip-reverse');
        flipper.classList.toggle('flipped', flipped);
      } else {
        // Reverse animation when going back to first
        flipper.classList.add('flip-reverse');
        flipper.classList.toggle('flipped', flipped);
      }

      idx = nextIdx;
      playSound(goingForward ? 'flipPfpForward' : 'flipPfpBack');
    });
  }

  function probe(n) {
    const img = new Image();
    img.onload = () => {
      images.push(`assets/pfps/${n}.webp`);
      probe(n + 1);
    };
    img.onerror = () => buildGallery();
    img.src = `assets/pfps/${n}.webp`;
  }

  probe(1);
}

/* ====== DATA LOADING ====== */
async function loadData() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (e) {
    console.error('Failed to load data.json', e);
    document.body.innerHTML = '<p style="padding:2rem;text-align:center;font-family:system-ui;color:#3d3532">Failed to load. Please refresh.</p>';
  }
}

/* ====== THEME FROM DATA ====== */
const THEME_MAP = {
  bg:'--bg', panelBg:'--panel-bg', accent:'--accent', accentLight:'--accent-light',
  accentDark:'--accent-dark', accentPale:'--accent-pale', mapLand:'--map-land',
  mapSea:'--map-sea', textDark:'--text-dark', textLight:'--text-light', shadow:'--shadow',
  playerBg:'--player-bg'
};

function applyTheme() {
  const t = state.data.theme;
  if (!t) return;
  const root = document.documentElement.style;
  for (const [key, prop] of Object.entries(THEME_MAP)) {
    if (t[key]) root.setProperty(prop, t[key]);
  }
}

/* ====== HOME RENDERING ====== */
function renderHome() {
  const d = state.data;
  dom.portraitImg.src = d.about.portrait;
  dom.portraitImg.alt = d.about.name;
  renderAboutBio(d.about.bio);

  // Set nav button icons from data.json
  const nav = d.assets?.navButtons;
  if (nav) {
    const btns = { videos: dom.btnVideos, games: dom.btnGames, map: dom.btnMap };
    for (const [key, el] of Object.entries(btns)) {
      if (!nav[key] || !el) continue;
      const icon = el.querySelector('.btn-icon');
      const iconHover = el.querySelector('.btn-icon-hover');
      if (icon) icon.src = nav[key].icon;
      if (iconHover) iconHover.src = nav[key].iconHover;
    }
  }

  // Set map background from data.json
  if (d.assets?.mapBackground) {
    const mapBg = document.querySelector('.map-bg');
    if (mapBg) mapBg.src = d.assets.mapBackground;
  }
}

/* ====== ABOUT BIO RENDERING ====== */
const BIO_LINK_MAP = {
  'showreels': { window: 'window-videos', label: 'showreels' },
  'game jams': { window: 'window-games', label: 'game jams' },
  'map':       { window: 'window-map',   label: 'map' },
};

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderAboutBio(bioText) {
  const paragraphs = bioText.split('\n\n');
  const html = paragraphs.map(p => {
    // Replace {email:...} markers
    let safe = escapeHTML(p);
    safe = safe.replace(/\{email:([^}]+)\}/g, (_, addr) =>
      `<a class="bio-link" href="mailto:${escapeHTML(addr)}">${escapeHTML(addr)}</a>`
    );
    // Replace {name} markers for window links
    safe = safe.replace(/\{([^}]+)\}/g, (_, key) => {
      const entry = BIO_LINK_MAP[key];
      if (!entry) return key;
      return `<a class="bio-link bio-nav" href="#" data-open="${entry.window}">${escapeHTML(entry.label)}</a>`;
    });
    return `<p>${safe}</p>`;
  }).join('');
  dom.aboutBio.innerHTML = html;
}

/* ====== HOME PANEL OPEN/CLOSE ====== */
function closeHome() {
  dom.homePanel.classList.add('hidden');
  dom.reopenBtn.hidden = false;
  state.homeOpen = false;
  playSound('closeHome');
}

function openHome() {
  dom.reopenBtn.hidden = true;
  dom.homePanel.classList.remove('hidden', 'flipped');
  // Reset position if it was dragged
  dom.homePanel.style.position = '';
  dom.homePanel.style.left = '';
  dom.homePanel.style.top = '';
  dom.homePanel.classList.remove('dragged');
  state.homeOpen = true;
  bringHomeFront();
  playSound('openHome');
}

/*
 * ====== WINDOW SYSTEM ======
 * Windows use a monotonically increasing z-index (state.nextZIndex++) so the most
 * recently focused window is always on top. windowStack[] tracks order for Escape-to-close.
 * ANIM_MS must match the CSS pop-in/pop-out animation duration (0.15s).
 */
const ANIM_MS = 150;

function bringToFront(id) {
  const idx = state.windowStack.indexOf(id);
  if (idx !== -1) state.windowStack.splice(idx, 1);
  state.windowStack.push(id);
  const win = document.getElementById(id);
  if (win) win.style.zIndex = state.nextZIndex++;
}

function bringHomeFront() {
  dom.homePanel.style.zIndex = state.nextZIndex++;
}

const CASCADE_GAP = 30;
let lastWindowPos = null; // {x, y} of last used window

function getNextWindowPos(w, h) {
  let x, y;
  if (lastWindowPos && state.openWindows.size > 0) {
    x = lastWindowPos.x + CASCADE_GAP;
    y = lastWindowPos.y + CASCADE_GAP;
  } else {
    lastWindowPos = null;
    x = (window.innerWidth - w) / 2;
    y = (window.innerHeight - h) / 2;
  }
  // Clamp to viewport so windows don't spawn off-screen on mobile
  x = Math.max(0, Math.min(x, window.innerWidth - 40));
  y = Math.max(0, Math.min(y, window.innerHeight - 40));
  return { x, y };
}

function openWindow(id) {
  const win = document.getElementById(id);
  if (!win) return;

  // Already open? Just bring to front
  if (state.openWindows.has(id)) { bringToFront(id); return; }

  // Position relative to last window, or centered
  const pos = getNextWindowPos(win.offsetWidth || 640, win.offsetHeight || 480);
  win.style.left = pos.x + 'px';
  win.style.top = pos.y + 'px';
  win.classList.add('dragged');
  lastWindowPos = pos;

  win.hidden = false;
  void win.offsetHeight;
  win.classList.add('open');

  state.openWindows.add(id);
  bringToFront(id);

  // Window-specific open sounds
  const openSounds = { 'window-videos': 'openVideos', 'window-games': 'openGames', 'window-map': 'openMap' };
  playSound(openSounds[id]);

  if (id === 'window-videos') renderVideos();
  else if (id === 'window-games') renderGames();
  else if (id === 'window-map' && !state.mapRendered) { renderMap(); state.mapRendered = true; }
}

function closeWindowById(id, withSound = true) {
  if (!state.openWindows.has(id)) return;
  if (id.startsWith('window-player-')) { closePlayerById(id, withSound); return; }
  if (id === 'welcome-window') { dismissWelcome(); return; }

  const win = document.getElementById(id);
  if (!win) return;

  win.classList.remove('open');
  win.classList.add('closing');
  const closeSounds = { 'window-videos': 'closeVideos', 'window-games': 'closeGames', 'window-map': 'closeMap' };
  if (withSound) playSound(closeSounds[id]);

  state.openWindows.delete(id);
  const idx = state.windowStack.indexOf(id);
  if (idx !== -1) state.windowStack.splice(idx, 1);

  setTimeout(() => {
    win.hidden = true;
    win.classList.remove('closing', 'dragged');
    win.style.left = '';
    win.style.top = '';
  }, ANIM_MS);
}

function closeTopWindow(withSound = true) {
  if (state.windowStack.length === 0) return;
  const topId = state.windowStack[state.windowStack.length - 1];
  closeWindowById(topId, withSound);
}

let playerCounter = 0;

function createPlayerWindow(video) {
  const id = `window-player-${++playerCounter}`;

  const tpl = document.getElementById('tpl-player-window');
  const clone = tpl.content.cloneNode(true);
  const frame = clone.querySelector('.window-frame');
  frame.id = id;
  frame.querySelector('.window-title').textContent = video.title;

  document.body.appendChild(clone);
  // Re-query from DOM since clone fragment is emptied after append
  const attached = document.getElementById(id);

  // Bind close button
  attached.querySelector('.close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    closePlayerById(id, true);
  });

  // Bind focus on click
  attached.addEventListener('mousedown', () => {
    if (state.openWindows.has(id)) bringToFront(id);
  });

  // Make titlebar draggable
  makeDraggable(attached.querySelector('.window-titlebar'), attached);

  return { frame: attached, id };
}

function openPlayer(videoId) {
  const video = state.data.videos.find(v => v.id === videoId);
  if (!video) return;

  const { frame, id } = createPlayerWindow(video);
  const content = frame.querySelector('.player-content');

  const vid = document.createElement('video');
  vid.controls = true;
  vid.autoplay = true;
  vid.addEventListener('error', () => {
    vid.style.display = 'none';
    const msg = document.createElement('p');
    msg.className = 'player-error';
    msg.textContent = 'Video not available';
    content.appendChild(msg);
  });
  const src = document.createElement('source');
  const vPath = videoPath(video.id);
  src.src = vPath;
  const ext = vPath.split('.').pop().toLowerCase();
  src.type = ext === 'mp4' ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : 'video/webm';
  vid.appendChild(src);
  content.appendChild(vid);

  // Position relative to last window, or centered
  const pos = getNextWindowPos(800, 500);
  frame.style.left = pos.x + 'px';
  frame.style.top = pos.y + 'px';
  frame.classList.add('dragged');
  lastWindowPos = pos;

  frame.hidden = false;
  void frame.offsetHeight;
  frame.classList.add('open');

  state.openWindows.add(id);
  bringToFront(id);
  playSound('openPlayer');
}

function closePlayerById(id, withSound = true) {
  const frame = document.getElementById(id);
  if (!frame) return;

  const vid = frame.querySelector('video');
  if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); }

  frame.classList.remove('open');
  frame.classList.add('closing');
  if (withSound) playSound('closePlayer');

  state.openWindows.delete(id);
  const idx = state.windowStack.indexOf(id);
  if (idx !== -1) state.windowStack.splice(idx, 1);

  setTimeout(() => {
    frame.remove();
  }, ANIM_MS);
}

/* ====== VIDEOS (grid view) ====== */
function renderVideos() {
  const tpl = document.getElementById('tpl-video-card');
  const grid = document.createElement('div');
  grid.className = 'cards-grid';

  state.data.videos.forEach(v => {
    const clone = tpl.content.cloneNode(true);
    const card = clone.querySelector('.card');
    card.dataset.videoId = v.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Watch: ${v.title}`);
    const img = clone.querySelector('img');
    img.src = thumbPath(v.id);
    img.alt = v.title;
    img.addEventListener('error', () => {
      img.style.display = 'none';
      card.classList.add('thumb-error');
    });
    clone.querySelector('.card-title').textContent = v.title;
    grid.appendChild(clone);
  });

  dom.videosContent.innerHTML = '';
  dom.videosContent.appendChild(grid);
}

/* ====== GAMES (column view) ====== */
function renderGames() {
  const tpl = document.getElementById('tpl-game-card');
  const column = document.createElement('div');
  column.className = 'cards-column';

  state.data.games.forEach(g => {
    const clone = tpl.content.cloneNode(true);
    const card = clone.querySelector('.card');
    card.dataset.gameId = g.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Open: ${g.title}`);
    const img = clone.querySelector('img');
    img.src = thumbPath(g.id);
    img.alt = g.title;
    img.addEventListener('error', () => {
      img.style.display = 'none';
      card.classList.add('thumb-error');
    });
    clone.querySelector('.card-title').textContent = g.title;
    clone.querySelector('.card-desc-gray').textContent = g.description || '';
    const role = clone.querySelector('.card-role');
    if (g.role) role.textContent = g.role;
    else role.remove();
    column.appendChild(clone);
  });

  dom.gamesContent.innerHTML = '';
  dom.gamesContent.appendChild(column);
}

/* ====== DRAGGABLE WINDOWS ====== */
let _dragging = null;
let _dragOffsetX = 0, _dragOffsetY = 0;

function _startDrag(frame, clientX, clientY) {
  _dragging = frame;
  const rect = frame.getBoundingClientRect();
  _dragOffsetX = clientX - rect.left;
  _dragOffsetY = clientY - rect.top;
  frame.classList.add('dragging');
  if (frame.classList.contains('window-frame') && state.openWindows.has(frame.id)) {
    bringToFront(frame.id);
  }
}

function _moveDrag(clientX, clientY) {
  if (!_dragging) return;
  const x = clientX - _dragOffsetX;
  const y = clientY - _dragOffsetY;

  if (_dragging.id === 'home-panel' && _dragging.style.position !== 'fixed') {
    _dragging.style.position = 'fixed';
    _dragging.style.left = _dragging.getBoundingClientRect().left + 'px';
    _dragging.style.top = _dragging.getBoundingClientRect().top + 'px';
    _dragging.style.margin = '0';
    _dragging.style.zIndex = state.nextZIndex++;
  }

  _dragging.style.left = x + 'px';
  _dragging.style.top = y + 'px';

  if (_dragging.classList.contains('window-frame')) {
    _dragging.classList.add('dragged');
  }
}

function _endDrag() {
  if (_dragging) {
    // Update lastWindowPos if this was a window-frame
    if (_dragging.classList.contains('window-frame')) {
      lastWindowPos = { x: _dragging.offsetLeft, y: _dragging.offsetTop };
    }
    _dragging.classList.remove('dragging');
    _dragging = null;
  }
}

function makeDraggable(bar, frame) {
  bar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    _startDrag(frame, e.clientX, e.clientY);
    e.preventDefault();
  });
  bar.addEventListener('touchstart', (e) => {
    if (e.target.closest('button')) return;
    const t = e.touches[0];
    _startDrag(frame, t.clientX, t.clientY);
  }, { passive: true });
}

function initDrag() {
  // Bind existing titlebars
  document.querySelectorAll('.window-titlebar').forEach(bar => {
    const frame = bar.closest('.window-frame') || bar.closest('#home-panel');
    if (frame) makeDraggable(bar, frame);
  });

  // Global move/end listeners registered once on document.
  // They check _dragging and return early when idle, so the overhead is negligible.
  // This avoids add/remove churn on every drag start/end.
  document.addEventListener('mousemove', (e) => _moveDrag(e.clientX, e.clientY));
  document.addEventListener('mouseup', _endDrag);
  document.addEventListener('touchmove', (e) => {
    if (!_dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    _moveDrag(t.clientX, t.clientY);
  }, { passive: false });
  document.addEventListener('touchend', _endDrag);
}

/* ====== MAP ====== */
function renderMap() {
  const tpl = document.getElementById('tpl-map-pin');
  const container = dom.mapContent.querySelector('.map-container');

  state.data.social.forEach(s => {
    const clone = tpl.content.cloneNode(true);
    const pin = clone.querySelector('.map-pin');
    pin.href = s.url;
    pin.setAttribute('aria-label', s.label);
    pin.style.left = s.mapX + '%';
    pin.style.top = s.mapY + '%';
    pin.addEventListener('click', () => playSound('clickPin'));

    // Insert icon from PNG
    const img = document.createElement('img');
    img.src = mapIconPath(s.icon);
    img.alt = s.label;
    img.addEventListener('error', () => { img.style.display = 'none'; });
    pin.insertBefore(img, pin.firstChild);

    clone.querySelector('.map-pin-label').textContent = s.label;
    container.appendChild(clone);
  });
}


/*
 * ====== SOUND EFFECTS ======
 * All sounds are defined in data.json under "soundEffects" as key→path pairs.
 * Keys follow the pattern: action + target (e.g. "openVideos", "hoverMap", "flipPfpForward").
 * Multiple keys can point to the same MP3 file.
 * Sounds are preloaded into AudioBuffers on first user interaction.
 */
function initAudio() {
  if (state.audioCtx) return;
  try {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    preloadSounds();
  } catch (e) { /* no audio support */ }
}

async function preloadSounds() {
  const sfx = state.data && state.data.soundEffects;
  if (!sfx) return;
  const ctx = state.audioCtx;
  for (const [type, path] of Object.entries(sfx)) {
    if (!path) continue;
    try {
      const res = await fetch(path);
      if (!res.ok) {
        console.warn(`Sound '${type}' failed to load (HTTP ${res.status}). Check that the file exists at: ${path}`);
        continue;
      }
      const buf = await res.arrayBuffer();
      state.soundBuffers[type] = await ctx.decodeAudioData(buf);
    } catch (e) {
      console.warn(`Sound '${type}' failed to load. Check that the file exists at: ${path}`, e);
    }
  }
}

function playSound(type) {
  if (!state.audioCtx) return;

  if (!state.soundBuffers[type]) {
    const sfx = state.data?.soundEffects;
    if (sfx && sfx[type]) {
      // Key exists in data.json but buffer wasn't loaded — file issue
      console.warn(`Sound '${type}' is defined in data.json but failed to load. Check: ${sfx[type]}`);
    } else {
      // Key doesn't exist at all — missing from data.json
      console.warn(`Sound '${type}' not found. Add it to soundEffects in data.json.`);
    }
    return;
  }

  try {
    const source = state.audioCtx.createBufferSource();
    source.buffer = state.soundBuffers[type];
    source.connect(state.audioCtx.destination);
    source.start();
  } catch (e) { /* audio context suspended or unavailable */ }
}

/* ====== EVENT BINDING ====== */
function bindEvents() {
  // Init audio early (pointerdown fires before click, giving preload a head start)
  document.addEventListener('pointerdown', () => initAudio(), { once: true });

  // Nav buttons
  dom.btnVideos.addEventListener('click', () => openWindow('window-videos'));
  dom.btnGames.addEventListener('click', () => openWindow('window-games'));
  dom.btnMap.addEventListener('click', () => openWindow('window-map'));

  // Hover sounds (only on pointer devices) — different pitch per button
  if (state.hasHover) {
    dom.btnVideos.addEventListener('mouseenter', () => playSound('hoverVideos'));
    dom.btnGames.addEventListener('mouseenter', () => playSound('hoverGames'));
    dom.btnMap.addEventListener('mouseenter', () => playSound('hoverMap'));
  }

  // Close buttons for window frames
  document.querySelectorAll('.window-frame .close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const frame = btn.closest('.window-frame');
      closeWindowById(frame.id, true);
    });
  });

  // Click on window frame brings it to front
  document.querySelectorAll('.window-frame').forEach(frame => {
    frame.addEventListener('mousedown', () => {
      if (state.openWindows.has(frame.id)) bringToFront(frame.id);
    });
  });

  // Home panel: click to bring to front (but not when clicking nav buttons)
  dom.homePanel.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.nav-btn')) bringHomeFront();
  });

  // Close home panel (both front and back close buttons)
  dom.closeHome.addEventListener('click', (e) => {
    e.stopPropagation();
    closeHome();
  });
  dom.closeHomeBack.addEventListener('click', (e) => {
    e.stopPropagation();
    closeHome();
  });

  // Flip: click portrait to show about
  dom.portraitArea.addEventListener('click', () => {
    dom.homePanel.classList.add('flipped');
    playSound('flipHomeForward');
  });

  // Flip back: click back button to return to front
  dom.flipBackBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.homePanel.classList.remove('flipped');
    playSound('flipHomeBack');
  });

  // Reopen button
  dom.reopenBtn.addEventListener('click', () => {
    openHome();
  });

  // Escape key closes topmost window
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTopWindow(true);
  });

  // Event delegation for video cards (click + keyboard)
  function handleVideoCard(e) {
    const card = e.target.closest('[data-video-id]');
    if (!card) return;
    openPlayer(card.dataset.videoId);
  }
  dom.videosContent.addEventListener('click', handleVideoCard);
  dom.videosContent.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleVideoCard(e); }
  });

  // Event delegation for game cards (click + keyboard)
  function handleGameCard(e) {
    const card = e.target.closest('[data-game-id]');
    if (!card) return;
    playSound('changeView');
    const game = state.data.games.find(g => g.id === card.dataset.gameId);
    if (game && game.itchUrl) {
      window.open(game.itchUrl, '_blank', 'noopener,noreferrer');
    }
  }
  dom.gamesContent.addEventListener('click', handleGameCard);
  dom.gamesContent.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleGameCard(e); }
  });

  // Hover sounds on map pins (delegated via capture)
  if (state.hasHover) {
    dom.mapContent.addEventListener('mouseenter', (e) => {
      if (e.target.closest('.map-pin')) playSound('hoverPin');
    }, true);
  }

  // Bio links → open corresponding windows
  dom.aboutBio.addEventListener('click', (e) => {
    const link = e.target.closest('.bio-link[data-open]');
    if (!link) return;
    e.preventDefault();
    openWindow(link.dataset.open);
    // No extra sound here — openWindow() already plays one
  });

}
