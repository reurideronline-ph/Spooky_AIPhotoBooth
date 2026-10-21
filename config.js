/* ============================================================
 *  BOOTH CONFIG — edit this file, nothing else needs changing.
 * ============================================================ */
window.BOOTH_CONFIG = {
  // Paste your Apps Script Web App URL (Deploy → Web app → URL ending in /exec)
  API_URL: 'https://script.google.com/macros/s/PASTE_YOUR_DEPLOYMENT_ID/exec',

  /* Everything below is a FALLBACK. Once API_URL is set, the "Settings" and
     "Characters" tabs in your Google Sheet override these automatically. */
  BOOTH_NAME: 'Spooky AI Photo Booth',
  THEME_TITLE: 'Happy Halloween',

  // Timers (seconds)
  CAMERA_COUNTDOWN: 10,    // seconds to pose after tapping "I'm Ready" (the only timer)
  RESULT_IDLE_SECONDS: 180,// result screen returns to start after this (kiosk mode)

  // Camera
  MIRROR_OUTPUT: true,     // true = photo looks like the preview (selfie mirror)

  // Output: collage is rendered at FRAME_SCALE × the frame artwork (940×1672)
  FRAME_SCALE: 1.5,

  // PIN Slip sold at the booth counter (shown to guests)
  PIN_PRICE: 150,
  DEMO_PIN: '000000',        // offline fallback only — the live demo PIN is the DEMO_PIN setting in the Sheet

  // Paid prints — the server's PRINT_PRICE / CURRENCY override these when online.
  PRINT_PRICE: 50,
  CURRENCY: '₱',
  MAX_COPIES: 10,
  DEMO_STAFF_CODE: '1234',   // print staff code for the OFFLINE preview only (live booth uses STAFF_CODE in the Sheet)

  // Printing (5R = 5 × 7 inches @ 300 dpi)
  PRINT_DPI: 300,
  PRINT_FIT: 'contain-blur', // 'contain-blur' keeps the whole frame, 'cover' fills the page (crops)

  // Layouts = your uploaded frames. Slots were measured from the artwork.
  // cx,cy,w,h in frame pixels, angle in degrees (clockwise).
  LAYOUTS: [
    { id: 'frame1', name: 'Haunted Hollow', src: 'frames/frame1.png', thumb: 'frames/frame1-thumb.jpg',
      width: 940, height: 1672,
      slots: [ { cx: 451.6, cy: 683.8, w: 413, h: 399, angle: -6.34 },
               { cx: 491.1, cy: 1143.9, w: 466, h: 370, angle: 7.37 } ] },
    { id: 'frame2', name: 'Spellbook Castle', src: 'frames/frame2.png', thumb: 'frames/frame2-thumb.jpg',
      width: 940, height: 1672,
      slots: [ { cx: 454.2, cy: 630.2, w: 406, h: 417, angle: -6.91 },
               { cx: 498.4, cy: 1118.5, w: 399, h: 401, angle: 7.34 } ] }
  ],

  // Fallback characters (used if the server can't be reached for config).
  // The real prompts live on the server so customers can't tamper with them.
  CHARACTERS: [
    { id: 'vampire',  name: 'Vampire Royalty', emoji: '🧛', tagline: 'Velvet capes & candlelight', color: '#b3122e' },
    { id: 'witch',    name: 'Witch & Warlock', emoji: '🧙', tagline: 'Pointy hats & potions',      color: '#6d28d9' },
    { id: 'wizard',   name: 'Spellcaster',     emoji: '🪄', tagline: 'Wands, sparks & spellbooks', color: '#c08a1e' },
    { id: 'werewolf', name: 'Moon Wolf',       emoji: '🐺', tagline: 'Howl at the full moon',      color: '#64748b' },
    { id: 'calavera', name: 'Calavera',        emoji: '💀', tagline: 'Marigolds & bone couture',   color: '#ea580c' },
    { id: 'zombie',   name: 'Zombie Prom',     emoji: '🧟', tagline: 'Dressed to un-kill',         color: '#4d7c0f' },
    { id: 'pumpkin',  name: 'Pumpkin Royalty', emoji: '🎃', tagline: 'Rule the pumpkin patch',     color: '#f97316' },
    { id: 'pirate',   name: 'Ghost Pirate',    emoji: '🏴‍☠️', tagline: 'Haunted high seas',       color: '#0e7490' },
    { id: 'mummy',    name: 'Mummy Explorer',  emoji: '🏺', tagline: 'Secrets of the tomb',        color: '#a16207' }
  ]
};
