/* ============================================================
 *  SPOOKY AI PHOTO BOOTH — frontend
 *  Flow: Intro → PIN → Character (no timer) → One-shot camera (10 s countdown) →
 *        AI brewing → Pick frame → Result (QR · Print 5R · Save)
 * ============================================================ */
(() => {
  'use strict';
  const CFG = window.BOOTH_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const API_READY = /^https:\/\/script\.google\.com\/macros\/s\/(?!PASTE)/.test(CFG.API_URL);

  const state = {
    token: null, characters: CFG.CHARACTERS.slice(),
    character: null, photoB64: null, images: [], layoutId: CFG.LAYOUTS[0].id,
    finalDataUrl: null, shareCode: null, stream: null, timers: new Set()
  };
  const frames = {};   // layoutId → HTMLImageElement
  const ALL_LAYOUTS = CFG.LAYOUTS.slice();   // the Settings tab can hide or reorder these
  const framesReady = Promise.all(CFG.LAYOUTS.map(L => new Promise(res => {
    const i = new Image(); i.onload = () => { frames[L.id] = i; res(); }; i.onerror = res; i.src = L.src;
  })));

  /* ---------------- utilities ---------------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), ms); }
  function clearTimers() { state.timers.forEach(id => { clearTimeout(id); clearInterval(id); cancelAnimationFrame(id); }); state.timers.clear(); }
  function later(fn, ms) { const id = setTimeout(() => { state.timers.delete(id); fn(); }, ms); state.timers.add(id); return id; }

  function show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
    FX.mode(name === 'intro' ? 'intro' : 'calm');
    // Install banner lives on the opening screen only so it never covers booth buttons.
    if (name !== 'intro') $('#installSheet').hidden = true;
    else if (!seen() && !isStandalone()) setTimeout(openInstall, 1500);
  }

  /* ---------------- API ---------------- */
  async function api(action, data = {}, timeoutMs = 60000) {
    if (!API_READY) return mockApi(action, data);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(CFG.API_URL, {
        method: 'POST', redirect: 'follow', signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // "simple" request → no CORS preflight
        body: JSON.stringify(Object.assign({ action }, data))
      });
      return await r.json();
    } catch (e) {
      return { ok: false, retry: true, error: e.name === 'AbortError' ? 'The spell took too long. Please try again.' : 'Connection lost. Check the internet and try again.' };
    } finally { clearTimeout(t); }
  }
  async function apiGet(params) {
    if (!API_READY) return { ok: false };
    try { const r = await fetch(CFG.API_URL + '?' + new URLSearchParams(params), { redirect: 'follow' }); return await r.json(); }
    catch (e) { return { ok: false, error: 'offline' }; }
  }
  // Offline mode (API_URL not set): the demo PIN runs with stand-in images.
  async function mockApi(action, d) {
    await sleep(action === 'generate' ? 3500 : 400);
    if (action === 'validatePin') return { ok: false, error: 'PIN not found. Please check your PIN Slip or ask the booth counter.' };
    if (action === 'generate') {
      const ch = state.characters.find(c => c.id === d.characterId) || state.characters[0];
      return { ok: true, step: 1, image: await fakeAI(d.photo, ch), characterId: ch.id };
    }
    if (action === 'animate') return { ok: true, step: 2, image: await fakeAnimated(d.image) };
    if (action === 'save') return { ok: true, shareCode: 'DEMO' };
    if (action === 'printOrder') {
      if (d.staffCode !== CFG.DEMO_STAFF_CODE) return { ok: false, error: `Wrong staff code. (Demo code: ${CFG.DEMO_STAFF_CODE})` };
      const total = d.items.reduce((a, i) => a + i.copies, 0);
      return { ok: true, orderId: 'DEMO-' + String(Date.now()).slice(-5), total, amount: total * pricing.price, currency: pricing.currency };
    }
    return { ok: true };
  }

  /* ---------------- offline stand-ins ----------------
   * Used ONLY when API_URL is not set (e.g. the design preview), because there is no server to reach.
   * On the real booth every PIN — including the demo PIN — goes to the backend and OpenAI. */
  // Stand-in for step 1: the photo colour-graded in the character's palette (nothing drawn on it).
  async function fakeAI(b64, ch) {
    const img = await loadImg('data:image/jpeg;base64,' + b64);
    const S = 1024, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.drawImage(img, 0, 0, S, S);
    g.globalCompositeOperation = 'overlay';
    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, ch.color || '#7c3aed'); grad.addColorStop(1, '#2e1065');
    g.globalAlpha = .55; g.fillStyle = grad; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const v = g.createRadialGradient(S / 2, S / 2, S * .3, S / 2, S / 2, S * .75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,2,20,.75)'); g.fillStyle = v; g.fillRect(0, 0, S, S);
    return c.toDataURL('image/jpeg', .9);
  }
  // Stand-in for step 2: posterised, saturated "cartoon" look of the step-1 picture.
  async function fakeAnimated(src) {
    const img = await loadImg(src), S = 1024;
    const small = document.createElement('canvas'); small.width = small.height = 160;
    small.getContext('2d').drawImage(img, 0, 0, 160, 160);
    const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high'; g.drawImage(small, 0, 0, S, S);         // soft, smooth shapes
    const d = g.getImageData(0, 0, S, S), px = d.data, L = 6;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], gg = px[i + 1], b = px[i + 2], m = (r + gg + b) / 3;
      px[i] = Math.round(Math.min(255, m + (r - m) * 1.5) / 255 * L) / L * 255;
      px[i + 1] = Math.round(Math.min(255, m + (gg - m) * 1.5) / 255 * L) / L * 255;
      px[i + 2] = Math.round(Math.min(255, m + (b - m) * 1.5) / 255 * L) / L * 255;
    }
    g.putImageData(d, 0, 0);
    const glow = g.createRadialGradient(S * .5, S * .35, 0, S * .5, S * .35, S * .7);
    glow.addColorStop(0, 'rgba(255,220,150,.25)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = glow; g.fillRect(0, 0, S, S);
    return c.toDataURL('image/jpeg', .9);
  }
  // A drawn sample "guest" photo for when no camera is available.
  function samplePhoto() {
    const S = 1024, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, S); bg.addColorStop(0, '#8b6f5a'); bg.addColorStop(1, '#3f2e24'); g.fillStyle = bg; g.fillRect(0, 0, S, S);
    const people = [{ x: 360, skin: '#c68863', hair: '#1f1410', shirt: '#2563eb', long: false }, { x: 680, skin: '#8d5a3b', hair: '#2b1a12', shirt: '#db2777', long: true }];
    people.forEach(p => {
      g.fillStyle = p.shirt; g.beginPath(); g.ellipse(p.x, 1000, 210, 260, 0, 0, 7); g.fill();
      g.fillStyle = p.skin; g.fillRect(p.x - 45, 600, 90, 110);
      if (p.long) { g.fillStyle = p.hair; g.beginPath(); g.ellipse(p.x, 560, 170, 230, 0, 0, 7); g.fill(); }
      g.fillStyle = p.skin; g.beginPath(); g.ellipse(p.x, 480, 130, 160, 0, 0, 7); g.fill();
      g.fillStyle = p.hair; g.beginPath(); g.ellipse(p.x, 370, 140, 85, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#1a1a1a'; [-48, 48].forEach(dx => { g.beginPath(); g.arc(p.x + dx, 470, 12, 0, 7); g.fill(); });
      g.strokeStyle = '#5a2a1a'; g.lineWidth = 8; g.beginPath(); g.arc(p.x, 525, 45, .2 * Math.PI, .8 * Math.PI); g.stroke();
    });
    return c.toDataURL('image/jpeg', .9);
  }

  /* ---------------- sound (tiny WebAudio, no files) ---------------- */
  const Sound = (() => {
    let ctx;
    const ac = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
    function tone(freq, dur = .15, type = 'sine', vol = .15, when = 0) {
      try {
        const c = ac(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime + when;
        o.type = type; o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur);
      } catch (e) {}
    }
    return {
      unlock() { try { ac().resume(); } catch (e) {} },
      spooky() { [220, 261.6, 311.1, 392].forEach((f, i) => tone(f, 1.4, 'triangle', .07, i * .12)); },
      tick() { tone(880, .09, 'square', .06); },
      tap() { tone(520, .06, 'sine', .08); },
      shutter() {
        try { const c = ac(), n = c.sampleRate * .18, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
          for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
          const s = c.createBufferSource(), g = c.createGain(); g.gain.value = .35; s.buffer = b; s.connect(g).connect(c.destination); s.start(); } catch (e) {}
      },
      magic() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .35, 'sine', .07, i * .08)); }
    };
  })();

  /* ---------------- ambient FX: bats, embers, leaves, lightning ---------------- */
  const FX = (() => {
    const cv = $('#fx'), ctx = cv.getContext('2d');
    let W, H, dpr, parts = [], bats = [], m = 'intro';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function resize() { dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function bat(fromMoon) {
      const mx = W * .8, my = H * .18;
      return { x: fromMoon ? mx : -40, y: fromMoon ? my : H * (.1 + Math.random() * .4), s: 10 + Math.random() * 16,
        vx: fromMoon ? (Math.random() - .5) * 7 : 1.5 + Math.random() * 2.5, vy: fromMoon ? (Math.random() - .8) * 4 : (Math.random() - .5) * .6,
        p: Math.random() * 6, f: .25 + Math.random() * .2 };
    }
    function particle() {
      const leaf = Math.random() < .35;
      return { leaf, x: Math.random() * W, y: leaf ? -20 : H + 10, r: leaf ? 6 + Math.random() * 6 : 1 + Math.random() * 2.2,
        vx: (Math.random() - .5) * .6, vy: leaf ? .6 + Math.random() * .9 : -(.3 + Math.random() * .8),
        a: Math.random() * 6, va: (Math.random() - .5) * .05, hue: leaf ? [24, 32, 12, 280][Math.floor(Math.random() * 4)] : 38 + Math.random() * 10 };
    }
    function drawBat(b) {
      const flap = Math.sin(b.p) * .9;
      ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.s / 20, b.s / 20); ctx.fillStyle = '#0a0412';
      ctx.beginPath(); ctx.ellipse(0, 0, 4, 7, 0, 0, 7); ctx.fill();
      [-1, 1].forEach(side => {
        ctx.beginPath(); ctx.moveTo(0, -2);
        ctx.quadraticCurveTo(side * 12, -10 * flap - 6, side * 22, -6 * flap);
        ctx.quadraticCurveTo(side * 16, 2, side * 12, 3 - 2 * flap);
        ctx.quadraticCurveTo(side * 8, 0, side * 5, 5); ctx.closePath(); ctx.fill();
      });
      ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(-2, -10); ctx.lineTo(0, -6); ctx.lineTo(2, -10); ctx.lineTo(3, -5); ctx.fill();
      ctx.restore();
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      const want = m === 'intro' ? 70 : 34;
      while (parts.length < want) parts.push(particle());
      parts = parts.filter(p => p.y > -40 && p.y < H + 40 && p.x > -40 && p.x < W + 40);
      for (const p of parts) {
        p.x += p.vx + Math.sin(p.a) * (p.leaf ? .8 : .2); p.y += p.vy; p.a += p.va + .01;
        if (p.leaf) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = `hsla(${p.hue},90%,50%,.8)`;
          ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * .45, 0, 0, 7); ctx.fill(); ctx.restore();
        } else {
          ctx.fillStyle = `hsla(${p.hue},100%,60%,.8)`; ctx.shadowColor = '#f97316'; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        }
      }
      if (Math.random() < (m === 'intro' ? .03 : .006) && bats.length < 14) bats.push(bat(false));
      bats = bats.filter(b => b.x > -80 && b.x < W + 80 && b.y > -80 && b.y < H + 80);
      for (const b of bats) { b.x += b.vx; b.y += b.vy + Math.sin(b.p * .5) * .6; b.p += b.f; drawBat(b); }
      requestAnimationFrame(frame);
    }
    function lightning() {
      const el = $('.lightning'); el.classList.remove('strike'); void el.offsetWidth; el.classList.add('strike');
      setTimeout(lightning, 14000 + Math.random() * 16000);
    }
    return {
      start() { resize(); addEventListener('resize', resize); if (!reduce) { requestAnimationFrame(frame); setTimeout(lightning, 4000); } },
      mode(x) { m = x; },
      swarm(n = 18) { for (let i = 0; i < n; i++) bats.push(bat(true)); }
    };
  })();

  /* ---------------- INTRO ---------------- */
  function buildTitle() {
    const el = $('#introTitle'); el.innerHTML = '';
    let d = .3;
    String(CFG.THEME_TITLE || 'Happy Halloween').trim().split(/\s+/).forEach(word => {
      const w = document.createElement('span'); w.className = 'word';
      [...word].forEach((ch, i) => {
        const s = document.createElement('span'); s.className = 'ch' + (i % 3 === 1 ? ' lit' : ''); s.textContent = ch;
        s.style.animationDelay = d + 's' + (s.classList.contains('lit') ? `, ${2.5 + Math.random() * 2}s` : ''); d += .07;
        w.appendChild(s);
      });
      el.appendChild(w);
    });
  }
  function goIntro() {
    resetSession(); buildTitle();
    ['.subtitle', '.intro-cast', '#startBtn', '.fine'].forEach(s => { const e = $(s); e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; });
    show('intro'); setTimeout(() => FX.swarm(20), 900);
  }
  $('#startBtn').addEventListener('click', () => {
    Sound.unlock(); Sound.spooky(); FX.swarm(10);
    if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    goPin();
  });

  /* ---------------- PIN ---------------- */
  const PIN_LEN = 6; let pin = '';
  function renderPin() {
    const box = $('#pinBoxes'); box.innerHTML = '';
    for (let i = 0; i < PIN_LEN; i++) { const s = document.createElement('span'); s.textContent = pin[i] ? '•' : ''; if (i === pin.length) s.className = 'on'; box.appendChild(s); }
    $('#pinSubmit').disabled = pin.length !== PIN_LEN;
  }
  function pinKey(k) {
    $('#pinError').textContent = '';
    if (k === '⌫') pin = pin.slice(0, -1);
    else if (k === 'C') pin = '';
    else if (/\d/.test(k) && pin.length < PIN_LEN) pin += k;
    Sound.tap(); renderPin();
    if (pin.length === PIN_LEN) setTimeout(submitPin, 200);
  }
  (function buildKeypad() {
    const kp = $('#keypad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].forEach(k => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = k; b.onclick = () => pinKey(k); kp.appendChild(b);
    });
  })();
  document.addEventListener('keydown', e => {
    if (!$('[data-screen="pin"]').classList.contains('active')) return;
    if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') pinKey('⌫'); else if (e.key === 'Enter' && pin.length === PIN_LEN) submitPin();
  });
  $('#pinSubmit').addEventListener('click', submitPin);
  function goPin() { pin = ''; renderPin(); show('pin'); }

  let pinBusy = false;
  async function submitPin() {
    if (pinBusy || pin.length !== PIN_LEN) return;
    if (!API_READY && CFG.DEMO_PIN && pin === CFG.DEMO_PIN) {   // offline preview only — no server to reach
      state.demo = true; state.token = 'demo'; Sound.magic();
      toast('Offline preview: no server set, so pictures are stand-ins.', 3200);
      return goCharacter();
    }
    pinBusy = true; $('#pinSubmit').disabled = true; $('#pinSubmit').textContent = 'Checking the spirits…';
    const res = await api('validatePin', { pin });
    pinBusy = false; $('#pinSubmit').textContent = 'Unlock the Magic';
    if (!res.ok) {
      $('#pinError').textContent = res.error || 'Invalid PIN.'; const b = $('#pinBoxes'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      pin = ''; renderPin(); return;
    }
    state.token = res.token; state.demo = !!res.demo; Sound.magic();
    if (res.demo) toast('Demo session · real AI · not charged to a PIN', 3200);
    if (res.stage === 'generated' || res.stage === 'step1') {   // resume after a reload
      state.character = state.characters.find(c => c.id === res.characterId) || state.characters[0];
      await useImages(res.images.map(toUrl));
      if (res.stage === 'step1') { $('#shotPreview').src = state.images[0].src; return runStep(2); }
      return goLayout();
    }
    if (res.stage === 'done') return resumeDone(res.shareCode);
    goCharacter();
  }

  /* ---------------- CHARACTER (no timer — guests take their time) ---------------- */
  function goCharacter() {
    clearTimers(); state.character = null;
    const grid = $('#charGrid'); grid.innerHTML = '';
    state.characters.forEach((c, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'char'; b.style.setProperty('--c', c.color || '#7c3aed');
      b.style.animationDelay = (i * .05) + 's';
      b.innerHTML = `<span class="em">${c.emoji}</span><b>${c.name}</b><small>${c.tagline || ''}</small>`;
      b.onclick = () => { state.character = c; Sound.tap(); grid.querySelectorAll('.char').forEach(x => x.classList.toggle('sel', x === b)); $('#charGo').disabled = false; };
      grid.appendChild(b);
    });
    $('#charGo').disabled = true; show('character');
  }
  $('#charGo').addEventListener('click', () => { if (state.character) { clearTimers(); goCamera(); } });

  function runRing(ringSel, numSel, seconds, done) {
    const ring = $(ringSel), prog = ring.querySelector('.prog'), num = $(numSel), C = 276.5, start = performance.now();
    ring.classList.remove('hurry'); let lastSec = seconds + 1;
    const step = now => {
      const left = Math.max(0, seconds - (now - start) / 1000), s = Math.ceil(left);
      prog.style.strokeDashoffset = C * (1 - left / seconds);
      if (s !== lastSec) { num.textContent = s; lastSec = s; if (s <= 3 && s > 0) { ring.classList.add('hurry'); Sound.tick(); } }
      if (left <= 0) return done();
      const id = requestAnimationFrame(step); state.timers.add(id);
    };
    state.timers.add(requestAnimationFrame(step));
  }

  /* ---------------- CAMERA (one shot) ---------------- */
  const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', capture: 'user', hidden: true });
  document.body.appendChild(fileInput);
  let shooting = false, cameraFailed = false;

  async function goCamera() {
    const c = state.character;
    $('#camBadge').innerHTML = `${c.emoji} <span>${c.name}</span>`;
    $('#camTitle').textContent = 'Strike a Pose!';
    $('#shootBtn').disabled = true; $('#shootBtn').textContent = "I'm Ready!"; $('#camMsg').textContent = 'Starting camera…';
    $('#countdown').textContent = ''; shooting = false; cameraFailed = false; $('#sampleBtn').hidden = true;
    show('camera');
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } } });
      const v = $('#video'); v.srcObject = state.stream; await v.play();
      $('#camMsg').textContent = `Tap “I'm Ready” — you get ${CFG.CAMERA_COUNTDOWN} seconds to pose.`;
      $('#shootBtn').disabled = false;
    } catch (e) {
      cameraFailed = true;
      $('#camMsg').textContent = 'Camera unavailable — allow camera access, or upload a photo.';
      $('#shootBtn').disabled = false; $('#shootBtn').textContent = '📷 Upload a Photo';
      $('#sampleBtn').hidden = API_READY;   // live booth: use the camera or upload a real photo
    }
  }
  $('#shootBtn').addEventListener('click', () => cameraFailed ? fileInput.click() : startCountdown());
  $('#sampleBtn').addEventListener('click', () => { Sound.shutter(); finishShot(samplePhoto()); });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0]; if (!f) return;
    const img = await loadImg(URL.createObjectURL(f));
    finishShot(squareCrop(img, img.naturalWidth, img.naturalHeight, false));
  });

  async function startCountdown() {
    if (shooting) return; shooting = true; clearTimers();
    $('#shootBtn').disabled = true; $('#camMsg').textContent = '';
    const cd = $('#countdown');
    for (let n = CFG.CAMERA_COUNTDOWN; n > 0; n--) {
      cd.textContent = n; cd.classList.remove('tick'); void cd.offsetWidth; cd.classList.add('tick'); Sound.tick();
      await sleep(1000);
    }
    cd.textContent = ''; Sound.shutter();
    const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    const v = $('#video');
    const data = squareCrop(v, v.videoWidth, v.videoHeight, CFG.MIRROR_OUTPUT);
    await sleep(500);
    finishShot(data);
  }
  function squareCrop(src, w, h, mirror) {
    const side = Math.min(w, h), out = 1024, c = document.createElement('canvas'); c.width = c.height = out;
    const g = c.getContext('2d');
    if (mirror) { g.translate(out, 0); g.scale(-1, 1); }
    g.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
    return c.toDataURL('image/jpeg', .9);
  }
  function stopCamera() { if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; } }
  function finishShot(dataUrl) { stopCamera(); state.photoB64 = dataUrl.split(',')[1]; $('#shotPreview').src = dataUrl; generate(); }

  /* ---------------- GENERATING (2 steps) ----------------
   * Step 1: guest photo → photoreal character   (frame window 1)
   * Step 2: step-1 picture → 3D animated version (frame window 2) */
  const STEP_MSGS = [
    ['Summoning costumes from the spirit world', 'Stirring the cauldron', 'Keeping your face exactly you', 'Asking the bats for lighting tips', 'Sprinkling moon dust'],
    ['Turning you into an animated movie star', 'Rendering in glorious 3D', 'Adding big expressive eyes', 'Polishing every pixel', 'Rolling the cameras…']
  ];
  const toUrl = b => b.startsWith('data:') ? b : 'data:image/jpeg;base64,' + b;
  let genStep = 1;

  async function runStep(step) {
    genStep = step; show('generating'); clearTimers();
    $('#genError').textContent = ''; $('#genRetry').hidden = true;
    $('#genTitle').textContent = step === 1 ? 'Brewing Your Photo…' : 'Animating Your Photo…';
    $('#genStep').textContent = `Step ${step} of 2 · ${step === 1 ? 'Character photo' : '3D animated version'}`;
    const bar = $('#genBar'), base = step === 1 ? 0 : 50, t0 = Date.now(); let mi = 0;
    const msgs = STEP_MSGS[step - 1];
    bar.style.width = (base + 2) + '%'; $('#genMsg').textContent = msgs[0];
    const iv = setInterval(() => {
      const t = (Date.now() - t0) / 1000; bar.style.width = (base + Math.min(47, 50 * (1 - Math.exp(-t / 25)))) + '%';
      if (Math.floor(t) % 5 === 0) $('#genMsg').textContent = msgs[mi = (mi + 1) % msgs.length];
    }, 1000); state.timers.add(iv);

    const res = step === 1
      ? await api('generate', { token: state.token, characterId: state.character.id, photo: state.photoB64 }, 170000)
      : await api('animate', Object.assign({ token: state.token },          // the server re-reads step 1 from Drive;
          !API_READY ? { image: state.images[0].src } : {}), 170000);   // only the offline preview needs it here
    clearInterval(iv);
    if (!res.ok) {
      $('#genTitle').textContent = 'The Spell Fizzled';
      $('#genError').textContent = res.error || 'Something went wrong.';
      $('#genRetry').hidden = !res.retry; bar.style.width = base + '%';
      return;
    }
    bar.style.width = (base + 50) + '%'; Sound.magic();
    const img = await loadImg(toUrl(res.image));
    if (step === 1) {
      state.images = [img];
      $('#shotPreview').src = img.src;           // show the character photo while step 2 runs
      return runStep(2);
    }
    state.images = [state.images[0], img];
    goLayout();
  }
  function generate() { return runStep(1); }
  $('#genRetry').addEventListener('click', () => runStep(genStep));   // same photo — still one shot
  async function useImages(urls) { state.images = await Promise.all(urls.map(loadImg)); }

  /* ---------------- COMPOSITE ---------------- */
  function composite(layout, imgs, scale) {
    const c = document.createElement('canvas'); c.width = Math.round(layout.width * scale); c.height = Math.round(layout.height * scale);
    const g = c.getContext('2d'); g.fillStyle = '#12061f'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    layout.slots.forEach((s, i) => {
      const img = imgs[i % imgs.length]; if (!img) return;
      const W = (s.w + 30) * scale, H = (s.h + 30) * scale;   // overscan; the frame art hides the edges
      g.save(); g.translate(s.cx * scale, s.cy * scale); g.rotate(s.angle * Math.PI / 180);
      g.beginPath(); g.rect(-W / 2, -H / 2, W, H); g.clip();
      const r = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      g.drawImage(img, -img.naturalWidth * r / 2, -img.naturalHeight * r / 2, img.naturalWidth * r, img.naturalHeight * r);
      g.restore();
    });
    g.drawImage(frames[layout.id], 0, 0, c.width, c.height);
    return c;
  }

  /* ---------------- LAYOUT (your frames) ---------------- */
  async function goLayout() {
    clearTimers(); await framesReady;
    const grid = $('#layoutGrid'); grid.innerHTML = '';
    CFG.LAYOUTS.forEach(L => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'layout-opt' + (L.id === state.layoutId ? ' sel' : '');
      b.appendChild(composite(L, state.images, .5));
      const tag = document.createElement('span'); tag.textContent = L.name; b.appendChild(tag);
      b.onclick = () => { state.layoutId = L.id; Sound.tap(); grid.querySelectorAll('.layout-opt').forEach(x => x.classList.toggle('sel', x === b)); };
      grid.appendChild(b);
    });
    show('layout');
  }
  $('#layoutGo').addEventListener('click', finalize);

  /* ---------------- RESULT ---------------- */
  async function finalize() {
    clearTimers();
    const L = CFG.LAYOUTS.find(l => l.id === state.layoutId) || CFG.LAYOUTS[0];
    state.finalDataUrl = composite(L, state.images, CFG.FRAME_SCALE).toDataURL('image/jpeg', .92);
    showResult();
    await uploadFinal(L.id);
  }
  async function uploadFinal(layoutId) {
    $('#qr').innerHTML = '<span class="muted small">Saving…</span>'; $('#qrNote').textContent = '';
    const res = await api('save', { token: state.token, layoutId, image: state.finalDataUrl.split(',')[1] }, 90000);
    if (!res.ok) {
      $('#qr').innerHTML = '<span class="muted small">Not saved</span>';
      $('#qrNote').innerHTML = `${res.error || 'Upload failed.'} <button class="btn btn-ghost sm" id="retrySave">Retry</button>`;
      $('#retrySave').onclick = () => uploadFinal(layoutId); return;
    }
    state.shareCode = res.shareCode; renderQR();
  }
  function renderQR() {
    const url = new URL('download.html?c=' + encodeURIComponent(state.shareCode), location.href).href;
    const el = $('#qr'); el.innerHTML = '';
    if (window.QRCode) new QRCode(el, { text: url, width: 240, height: 240, colorDark: '#12061f', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    else el.textContent = state.shareCode;
    const days = 7;
    $('#qrNote').textContent = API_READY ? `Photo code: ${state.shareCode} · available for ${days} days${state.demo ? ' · demo' : ''}` : 'Offline preview — QR is a sample';
  }
  function showResult() {
    $('#finalImg').src = state.finalDataUrl; show('result'); FX.swarm(14); startIdle();
  }
  async function resumeDone(code) {
    state.shareCode = code; show('generating'); $('#genTitle').textContent = 'Welcome Back!'; $('#genMsg').textContent = 'Fetching your photo…';
    const r = await apiGet({ action: 'photo', c: code });
    if (!r.ok) { $('#genError').textContent = r.error || 'Could not load your photo.'; return; }
    state.finalDataUrl = r.dataUrl;
    if (r.photos) state.photos = r.photos.map(p => ({ id: p.id, label: p.label, src: p.dataUrl }));
    showResult(); renderQR();
  }

  // Idle reset for kiosk use
  let idleT, idleLeft;
  function startIdle() {
    clearInterval(idleT); idleLeft = CFG.RESULT_IDLE_SECONDS;
    idleT = setInterval(() => {
      idleLeft--; $('#idleNote').textContent = idleLeft <= 30 ? `Returning to start in ${idleLeft}s…` : '';
      if (idleLeft <= 0) { clearInterval(idleT); goIntro(); }
    }, 1000);
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (idleT && $('[data-screen="result"]').classList.contains('active')) idleLeft = CFG.RESULT_IDLE_SECONDS; }));

  /* ---------------- THE 3 PHOTOS ---------------- */
  const PHOTO_LABELS = { collage: 'Photo collage', photo1: 'Character photo', photo2: '3D animated photo' };
  function photoList() {
    if (state.photos && state.photos.length) return state.photos;
    return [
      { id: 'collage', label: PHOTO_LABELS.collage, src: state.finalDataUrl },
      { id: 'photo1', label: PHOTO_LABELS.photo1, src: state.images[0] && state.images[0].src },
      { id: 'photo2', label: PHOTO_LABELS.photo2, src: state.images[1] && state.images[1].src }
    ].filter(p => p.src);
  }
  const money = n => `${pricing.currency}${n.toLocaleString()}`;
  const pricing = { price: CFG.PRINT_PRICE, currency: CFG.CURRENCY, maxCopies: CFG.MAX_COPIES };
  function applyPricing() {
    document.querySelectorAll('.price-each, #priceEach').forEach(e => e.textContent = money(pricing.price));
    document.querySelectorAll('.pin-price').forEach(e => e.textContent = pricing.currency + Number(CFG.PIN_PRICE).toFixed(2));
    $('#printBtn').hidden = pricing.enabled === false;
  }

  /* Settings tab in the Google Sheet → this booth (texts, prices, timers, layouts). */
  function applySettings(st) {
    if (!st) return;
    const num = (v, d) => (isFinite(+v) && +v > 0 ? +v : d);
    if (st.BOOTH_NAME) { CFG.BOOTH_NAME = st.BOOTH_NAME; document.title = st.BOOTH_NAME; $('#installTitle').textContent = 'Install ' + st.BOOTH_NAME; }
    if (st.THEME_TITLE) { CFG.THEME_TITLE = st.THEME_TITLE; $('#introTitle').setAttribute('aria-label', st.THEME_TITLE); }
    if (st.SUBTITLE != null) $('.subtitle').textContent = st.SUBTITLE;
    if (st.TAGLINE != null) $('.fine').textContent = st.TAGLINE;
    if (st.CURRENCY) { CFG.CURRENCY = st.CURRENCY; pricing.currency = st.CURRENCY; }
    CFG.PIN_PRICE = num(st.PIN_PRICE, CFG.PIN_PRICE);
    if (st.DEMO_PIN !== undefined) CFG.DEMO_PIN = String(st.DEMO_PIN || '');
    CFG.CAMERA_COUNTDOWN = Math.round(num(st.CAMERA_COUNTDOWN, CFG.CAMERA_COUNTDOWN));
    CFG.RESULT_IDLE_SECONDS = Math.round(num(st.RESULT_IDLE_SECONDS, CFG.RESULT_IDLE_SECONDS));
    if (typeof st.MIRROR_OUTPUT === 'boolean') CFG.MIRROR_OUTPUT = st.MIRROR_OUTPUT;
    if (st.LAYOUTS) {
      const want = String(st.LAYOUTS).split(/[\s,]+/).filter(Boolean);
      const picked = want.map(id => ALL_LAYOUTS.find(l => l.id === id)).filter(Boolean);
      if (picked.length) { CFG.LAYOUTS = picked; if (!picked.some(l => l.id === state.layoutId)) state.layoutId = picked[0].id; }
    }
    applyPricing();
    if ($('[data-screen="intro"]').classList.contains('active')) buildTitle();
  }

  /* ---------------- SAVE (3 downloads) ---------------- */
  async function saveFile(p) {
    const name = `spooky-booth-${state.shareCode || Date.now()}-${p.id}.jpg`;
    const blob = await (await fetch(p.src)).blob();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    return new File([blob], name, { type: 'image/jpeg' });
  }
  $('#downloadBtn').addEventListener('click', () => {
    const grid = $('#saveGrid'); grid.innerHTML = '';
    photoList().forEach(p => {
      const card = document.createElement('div'); card.className = 'pick';
      card.innerHTML = `<div class="thumb"><img alt=""></div><b>${p.label}</b>`;
      card.querySelector('img').src = p.src;
      const btn = document.createElement('button'); btn.className = 'btn btn-ghost sm'; btn.textContent = '⬇️ Save';
      btn.onclick = () => CFG.CAN_DOWNLOAD === false ? blockedNote() : saveFile(p);
      card.appendChild(btn); grid.appendChild(card);
    });
    $('#saveNote').textContent = ''; $('#saveModal').hidden = false;
  });
  function blockedNote() { $('#saveNote').textContent = 'Saving is blocked in this preview. On the booth or the QR page each button downloads that photo. Here you can right-click or long-press a picture to save it.'; }
  $('#saveAll').addEventListener('click', async () => {
    if (CFG.CAN_DOWNLOAD === false) return blockedNote();
    const list = photoList();
    if (navigator.canShare && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      const files = await Promise.all(list.map(async p => new File([await (await fetch(p.src)).blob()], `spooky-booth-${p.id}.jpg`, { type: 'image/jpeg' })));
      if (navigator.canShare({ files })) { try { await navigator.share({ files, title: 'My Halloween photos' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    }
    for (const p of list) { await saveFile(p); await sleep(400); }
  });
  $('#saveClose').addEventListener('click', () => { $('#saveModal').hidden = true; });

  /* ---------------- PAID PRINTS (5R = 5 × 7 in) ---------------- */
  const order = {};
  function make5R(srcImg) {
    const dpi = CFG.PRINT_DPI, PW = 5 * dpi, PH = 7 * dpi;
    const c = document.createElement('canvas'); c.width = PW; c.height = PH; const g = c.getContext('2d');
    if (CFG.PRINT_FIT === 'cover') {
      const r = Math.max(PW / srcImg.width, PH / srcImg.height);
      g.drawImage(srcImg, (PW - srcImg.width * r) / 2, (PH - srcImg.height * r) / 2, srcImg.width * r, srcImg.height * r);
    } else {
      // blurred, darkened fill behind the whole picture (no ctx.filter needed, works everywhere)
      const t = document.createElement('canvas'); t.width = 24; t.height = 34; t.getContext('2d').drawImage(srcImg, 0, 0, 24, 34);
      g.imageSmoothingEnabled = true; g.drawImage(t, -40, -40, PW + 80, PH + 80);
      g.fillStyle = 'rgba(10,4,20,.35)'; g.fillRect(0, 0, PW, PH);
      const r = Math.min(PW / srcImg.width, PH / srcImg.height), w = srcImg.width * r, h = srcImg.height * r;
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 40;
      g.drawImage(srcImg, (PW - w) / 2, (PH - h) / 2, w, h);
    }
    return c.toDataURL('image/jpeg', .95);
  }
  const pages5R = {};   // photo id → 5R page data URL (cached)
  async function page5R(p) { return pages5R[p.id] || (pages5R[p.id] = make5R(await loadImg(p.src))); }

  function renderOrder() {
    const total = Object.values(order).reduce((a, n) => a + n, 0), amount = total * pricing.price;
    const parts = photoList().filter(p => order[p.id]).map(p => `${order[p.id]}× ${p.label}`);
    $('#orderSummary').textContent = total ? `${parts.join(' · ')}  (${total} × ${money(pricing.price)})` : 'No photos selected';
    $('#orderTotal').textContent = money(amount); $('#payAmount').textContent = money(amount);
    $('#payStep').hidden = !total;
    $('#demoCodeHint').hidden = API_READY;
    document.querySelectorAll('#printGrid .pick').forEach(card => {
      const n = order[card.dataset.id] || 0; card.classList.toggle('on', n > 0);
      card.querySelector('output').textContent = n;
      card.querySelector('.minus').disabled = n === 0; card.querySelector('.plus').disabled = n >= pricing.maxCopies;
    });
  }
  $('#printBtn').addEventListener('click', async () => {
    Object.keys(order).forEach(k => delete order[k]);
    const grid = $('#printGrid'); grid.innerHTML = '';
    for (const p of photoList()) {
      const card = document.createElement('div'); card.className = 'pick'; card.dataset.id = p.id;
      card.innerHTML = `<div class="thumb"><img alt=""></div><b>${p.label}</b>
        <div class="stepper"><button type="button" class="minus" aria-label="Fewer">−</button><output>0</output><button type="button" class="plus" aria-label="More">+</button></div>`;
      grid.appendChild(card);
      page5R(p).then(u => card.querySelector('img').src = u);          // thumbnail shows the real 5R page
      card.querySelector('.thumb').onclick = () => { order[p.id] = order[p.id] ? 0 : 1; Sound.tap(); renderOrder(); };
      card.querySelector('.minus').onclick = () => { order[p.id] = Math.max(0, (order[p.id] || 0) - 1); Sound.tap(); renderOrder(); };
      card.querySelector('.plus').onclick = () => { order[p.id] = Math.min(pricing.maxCopies, (order[p.id] || 0) + 1); Sound.tap(); renderOrder(); };
    }
    $('#staffCode').value = ''; $('#printError').textContent = '';
    $('#printPick').hidden = false; $('#printDone').hidden = true; $('#printModal').hidden = false;
    renderOrder();
  });
  $('#printClose').addEventListener('click', () => { $('#printModal').hidden = true; });
  $('#printDoneClose').addEventListener('click', () => { $('#printModal').hidden = true; });
  $('#staffCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#payConfirm').click(); });

  let paying = false;
  $('#payConfirm').addEventListener('click', async () => {
    if (paying) return;
    const items = Object.entries(order).filter(([, n]) => n > 0).map(([id, copies]) => ({ id, copies }));
    if (!items.length) return;
    const staffCode = $('#staffCode').value.trim();
    if (!staffCode) { $('#printError').textContent = 'Staff: enter the code after taking payment.'; return; }
    paying = true; $('#payConfirm').disabled = true; $('#payConfirm').textContent = 'Checking…'; $('#printError').textContent = '';
    const res = await api('printOrder', { token: state.token, items, staffCode });
    paying = false; $('#payConfirm').disabled = false; $('#payConfirm').textContent = 'Confirm & Print';
    if (!res.ok) { $('#printError').textContent = res.error || 'Could not confirm payment.'; $('#staffCode').select(); return; }

    // Build the print job: one 5R page per copy.
    const pages = [];
    for (const p of photoList()) for (let i = 0; i < (order[p.id] || 0); i++) pages.push(await page5R(p));
    const area = $('#printArea'); area.innerHTML = '';
    pages.forEach(u => { const im = new Image(); im.src = u; area.appendChild(im); });
    const strip = $('#printStrip'); strip.innerHTML = '';
    pages.forEach(u => { const im = new Image(); im.src = u; im.alt = '5R print'; strip.appendChild(im); });
    $('#printDoneMsg').textContent = `Order ${res.orderId} · ${res.total} print${res.total > 1 ? 's' : ''} · ${money(res.amount)} paid`;
    $('#printAgain').hidden = CFG.CAN_PRINT === false;
    $('#printNote').textContent = CFG.CAN_PRINT === false
      ? 'Printing is switched off in this preview. On the booth the print dialog opens with these pages at 5×7 in.'
      : 'In the print dialog choose 5×7 in (127×178 mm) paper, scale 100%, borderless.';
    $('#printPick').hidden = true; $('#printDone').hidden = false; Sound.magic();
    if (CFG.CAN_PRINT !== false) setTimeout(() => window.print(), 400);
  });
  $('#printAgain').addEventListener('click', () => window.print());   // reprints the same paid job (e.g. paper jam)

  $('#finishBtn').addEventListener('click', goIntro);

  function resetSession() {
    clearTimers(); clearInterval(idleT); idleT = null; stopCamera();
    Object.keys(pages5R).forEach(k => delete pages5R[k]);
    ['#saveModal', '#printModal'].forEach(m => $(m).hidden = true); $('#printArea').innerHTML = '';
    Object.assign(state, { demo: false, photos: null, token: null, character: null, photoB64: null, images: [], layoutId: CFG.LAYOUTS[0].id, finalDataUrl: null, shareCode: null });
    $('#shotPreview').removeAttribute('src'); $('#qr').innerHTML = ''; $('#idleNote').textContent = '';
  }

  /* ---------------- PWA: service worker + first-open install banner ---------------- */
  let deferredPrompt = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const seen = () => { try { return localStorage.getItem('installSeen') === '1'; } catch (e) { return false; } };
  const markSeen = () => { try { localStorage.setItem('installSeen', '1'); } catch (e) {} };

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if (!seen()) openInstall(); });
  addEventListener('appinstalled', () => { markSeen(); $('#installSheet').hidden = true; toast('🎃 Installed! Open it from your home screen.'); });
  function openInstall() {
    if (isStandalone() || seen() || !$('[data-screen="intro"]').classList.contains('active')) return;
    const sh = $('#installSheet'), btn = $('#installBtn'), hint = $('#installHint');
    if (deferredPrompt) { hint.textContent = 'Add it to your home screen for full-screen magic.'; btn.hidden = false; }
    else if (isIOS) { hint.innerHTML = 'Tap <b>Share</b> <span aria-hidden="true">⬆️</span> then <b>Add to Home Screen</b>.'; btn.hidden = true; }
    else { hint.textContent = 'Use your browser menu → "Install app" / "Add to Home screen".'; btn.hidden = true; }
    sh.hidden = false;
  }
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return; deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; markSeen(); $('#installSheet').hidden = true;
  });
  $('#installClose').addEventListener('click', () => { markSeen(); $('#installSheet').hidden = true; });

  if ('serviceWorker' in navigator && !CFG.EMBED) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

  /* ---------------- BOOT ---------------- */
  async function boot() {
    FX.start(); applyPricing(); goIntro();
    if (!API_READY) console.warn('[Booth] API_URL not set — running in DEMO mode (PIN 000000).');
    const conf = await apiGet({ action: 'config' });
    if (conf.ok && conf.print) Object.assign(pricing, conf.print);
    if (conf.ok) applySettings(conf.settings || {});
    if (conf.ok && conf.characters && conf.characters.length) {
      state.characters = conf.characters;
    }
  }
  boot();
})();
