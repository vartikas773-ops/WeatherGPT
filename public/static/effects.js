/* Weather scene.
   Picks the sky for the *searched place's* weather and *its* local time (sunrise/sunset come
   from the forecast API in that place's own timezone), then animates layered effects on a
   fixed canvas behind the page: sun glare, moon + stars, soft clouds, fog, rain, snow, lightning.

   Try any look from the browser console:  Sky.preview("rain", "night")
   kinds: clear partly cloudy fog rain heavyrain storm snow   phases: day dawn dusk night */
const Sky = (() => {
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;

  /* ---------- sky gradients [top, bottom] ---------- */
  const SKY = {
    day: {
      clear: ["#2a74cf", "#8cc6f3"], cloudy: ["#5f7790", "#a2b3c4"],
      rain: ["#3f4f63", "#74869c"], storm: ["#262d3b", "#4b5668"],
      snow: ["#7c8da3", "#c3cfdc"], fog: ["#838f9b", "#b9c2ca"],
    },
    dawn: {
      clear: ["#3f4f8d", "#f3a97e"], cloudy: ["#59607b", "#c8a090"],
      rain: ["#3d465a", "#84778a"], storm: ["#292e3e", "#5c5869"],
      snow: ["#66718a", "#cfb4b0"], fog: ["#747e8b", "#c3b2aa"],
    },
    dusk: {
      clear: ["#2b2f6e", "#ee8a5e"], cloudy: ["#484868", "#bf7d71"],
      rain: ["#383a56", "#7a6471"], storm: ["#242637", "#534856"],
      snow: ["#5b6182", "#c29aa0"], fog: ["#696d84", "#b69a9c"],
    },
    night: {
      clear: ["#091024", "#1b2a58"], cloudy: ["#131929", "#29314a"],
      rain: ["#0e131e", "#212b3b"], storm: ["#070a12", "#181f2c"],
      snow: ["#171f2e", "#374357"], fog: ["#191e26", "#343c47"],
    },
  };

  /* ---------- WMO weather code -> look ---------- */
  const RAIN = { 51: .2, 53: .3, 55: .45, 56: .3, 57: .45, 61: .4, 63: .7, 65: 1, 66: .5, 67: .9, 80: .5, 81: .8, 82: 1 };
  const SNOW = { 71: .35, 73: .65, 75: 1, 77: .45, 85: .55, 86: 1 };

  function classify(code) {
    if (code >= 95) return { kind: "storm", intensity: code >= 96 ? 1 : .85, clouds: 1 };
    if (code in SNOW) return { kind: "snow", intensity: SNOW[code], clouds: 1 };
    if (code in RAIN) return { kind: "rain", intensity: RAIN[code], clouds: 1 };
    if (code === 45 || code === 48) return { kind: "fog", intensity: 1, clouds: .3 };
    if (code === 3) return { kind: "cloudy", intensity: 0, clouds: 1 };
    if (code === 2) return { kind: "clear", intensity: 0, clouds: .5 };     // partly cloudy
    if (code === 1) return { kind: "clear", intensity: 0, clouds: .15 };    // mostly clear
    return { kind: "clear", intensity: 0, clouds: 0 };
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const mins = (iso) => { const [h, m] = iso.slice(11, 16).split(":").map(Number); return h * 60 + m; };

  /* Phase of day uses the PLACE's own clock (current.time is local to the searched city).
     Fixed windows:  dawn 05:00-07:30 | day 07:31-16:30 | dusk 16:31-19:30 | night 19:31-04:59 */
  const DAWN = 300, DAY = 451, DUSK = 991, NIGHT = 1171;     // minutes after midnight
  function fromForecast(d) {
    const c = d.current, w = classify(c.code), now = mins(c.time);
    let phase, progress;
    if (now >= NIGHT || now < DAWN) {
      phase = "night";
      const since = now >= NIGHT ? now - NIGHT : now + 1440 - NIGHT;      // minutes into the night
      progress = clamp(since / (1440 - NIGHT + DAWN), 0, 1);
    } else {
      phase = now < DAY ? "dawn" : now < DUSK ? "day" : "dusk";
      progress = clamp((now - DAWN) / (NIGHT - DAWN), 0, 1);               // sun's path across the sky
    }
    const kmh = d.units.wind === "mph" ? c.wind * 1.609 : c.wind;
    const windX = clamp(kmh / 50, 0, 1) * -Math.sin((c.wind_dir || 0) * Math.PI / 180);
    return { ...w, phase, night: phase === "night", progress, windX };
  }

  function applyColours(s) {
    const [a, b] = SKY[s.phase][s.kind === "loading" ? "clear" : s.kind];
    root.style.setProperty("--sky-a", a);
    root.style.setProperty("--sky-b", b);
    root.style.setProperty("--glass", `rgba(8,14,32,${s.night ? .34 : .46})`);
    root.dataset.phase = s.phase; root.dataset.sky = s.kind;
  }

  /* ---------- sprites (drawn once, reused every frame) ---------- */
  function cloudSprite(light, shade, alpha, w = 560, h = 240) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"), n = 26;
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), bump = Math.sin(Math.PI * u);
      puffs.push({
        x: w * (.12 + .76 * u) + rand(-16, 16),
        y: h * .64 - bump * h * .24 * rand(.35, 1),
        r: h * (.15 + .2 * bump) * rand(.75, 1.15),
      });
    }
    const draw = (rgb, a, dy) => puffs.forEach((p) => {
      const gr = g.createRadialGradient(p.x, p.y + dy, 0, p.x, p.y + dy, p.r);
      gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(.55, `rgba(${rgb},${a * .55})`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y + dy, p.r, 0, 7); g.fill();
    });
    draw(shade, alpha * .9, 16);      // darker underside
    draw(light, alpha, -4);           // lit top
    return c;
  }

  const flake = document.createElement("canvas");
  (() => {
    flake.width = flake.height = 32;
    const g = flake.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.45, "rgba(255,255,255,.7)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  })();

  const moon = document.createElement("canvas");
  (() => {
    moon.width = moon.height = 120;
    const m = moon.getContext("2d");
    m.fillStyle = "#f6f2df"; m.beginPath(); m.arc(60, 60, 34, 0, 7); m.fill();
    m.globalCompositeOperation = "destination-out";
    m.beginPath(); m.arc(76, 50, 31, 0, 7); m.fill();
  })();

  function cloudLook(s) {
    const dim = s.kind === "rain" || s.kind === "storm" || s.kind === "snow";
    if (s.night) return dim ? ["58,66,84", "26,31,44", .62] : s.kind === "clear" ? ["120,138,185", "50,62,100", .32] : ["92,102,128", "40,46,64", .52];
    if (s.phase !== "day") return dim ? ["130,115,130", "70,62,80", .66] : s.kind === "clear" ? ["255,224,205", "205,140,140", .55] : ["222,190,185", "125,100,120", .6];
    return dim ? ["150,160,174", "80,90,106", .78] : s.kind === "clear" ? ["255,255,255", "186,208,236", .6] : ["240,244,248", "150,166,184", .72];
  }

  /* ---------- scene state ---------- */
  let W = 0, H = 0, dpr = 1, scene = null, key = "";
  let drops = [], flakes = [], stars = [], clouds = [], fogs = [], sprites = [];
  let t = 0, last = 0, raf = 0, bolt = null, flash = 0, nextBolt = 0, echoAt = 0, shoot = null, nextShoot = 0;

  const RAIN_LAYERS = [
    { v: [480, 620], len: [7, 13], a: .17, w: .8, share: .5 },
    { v: [700, 860], len: [12, 21], a: .3, w: 1.1, share: .33 },
    { v: [960, 1150], len: [18, 30], a: .48, w: 1.5, share: .17 },
  ];
  const SNOW_LAYERS = [
    { r: [1, 1.7], v: [24, 40], a: .5, share: .5 },
    { r: [1.8, 3], v: [45, 70], a: .75, share: .35 },
    { r: [4, 7], v: [90, 130], a: .45, share: .15 },
  ];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    if (reduce) frame(0);
  }
  addEventListener("resize", resize);

  const newDrop = (L, init) => ({
    L, x: rand(-150, W + 150), y: init ? rand(0, H) : rand(-60, -5),
    v: rand(...RAIN_LAYERS[L].v), len: rand(...RAIN_LAYERS[L].len) * (.6 + scene.intensity * .5),
  });

  function build() {
    drops = []; flakes = []; stars = []; clouds = []; fogs = []; sprites = [];
    if (!scene) return;
    const s = scene, area = W * H;

    if (s.kind === "rain" || s.kind === "storm") {
      const n = Math.round(area / 5200 * (.25 + s.intensity));
      RAIN_LAYERS.forEach((L, i) => { for (let k = 0; k < n * L.share; k++) drops.push(newDrop(i, true)); });
    }
    if (s.kind === "snow") {
      const n = Math.round(area / 6500 * (.3 + s.intensity));
      SNOW_LAYERS.forEach((L, i) => {
        for (let k = 0; k < n * L.share; k++)
          flakes.push({ L: i, x: rand(0, W), y: rand(0, H), r: rand(...L.r), v: rand(...L.v), ph: rand(0, 6.28), sw: rand(8, 26) });
      });
    }
    if (s.night && s.kind === "clear") {
      const n = Math.round(area / 3600 * (1 - s.clouds * .9));
      for (let i = 0; i < n; i++)
        stars.push({ x: rand(0, W), y: rand(0, H * .75), r: rand(.4, 1.3), ph: rand(0, 6.28), sp: rand(.7, 2.2), big: Math.random() < .07 });
    }

    const [light, shade, a] = cloudLook(s);
    if (s.clouds > 0) {
      sprites = [0, 1, 2].map(() => cloudSprite(light, shade, a));
      const n = Math.round(s.clouds * 9);
      for (let i = 0; i < n; i++) {
        const far = i % 2 === 0;
        clouds.push({
          img: sprites[i % 3], flip: Math.random() < .5,
          sc: far ? rand(.55, .9) : rand(1.1, 1.8), v: far ? rand(3, 8) : rand(9, 20),
          x: rand(-300, W), y: far ? rand(.04, .3) * H : rand(.0, .42) * H, o: far ? .7 : 1,
        });
      }
    }
    if (s.kind === "fog") {
      const sp = cloudSprite(s.night ? "150,160,175" : "238,242,246", s.night ? "80,90,105" : "190,198,206", s.night ? .2 : .3, 900, 200);
      for (let i = 0; i < 5; i++) fogs.push({ img: sp, x: rand(-300, W), y: rand(.15, .85) * H, w: rand(W * .9, W * 1.5), v: rand(6, 18) * (i % 2 ? 1 : -1) });
    }
  }

  function setScene(s) {
    const k = [s.phase, s.kind, s.clouds, s.intensity].join();
    scene = s;
    if (k === key) return;              // same look: keep particles running smoothly
    key = k; nextBolt = t + rand(1.5, 4); nextShoot = t + rand(5, 12); bolt = null; flash = 0; shoot = null;
    build();
    if (reduce) frame(0); else if (!raf) raf = requestAnimationFrame(loop);
  }

  /* ---------- drawing ---------- */
  function radial(x, y, r, stops) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }

  function drawSun(x, y, k) {
    const R = Math.max(W, H), warm = scene.phase !== "day";
    const rgb = warm ? "255,196,140" : "255,244,214";
    radial(x, y, R * .7, [[0, `rgba(${rgb},${.42 * k})`], [.2, `rgba(${rgb},${.16 * k})`], [1, `rgba(${rgb},0)`]]);
    // thin halo ring, like the sun-dog ring in Apple's sunny scene
    const rr = R * .17 * (1 + .015 * Math.sin(t * .6));
    const g = ctx.createRadialGradient(x, y, rr * .78, x, y, rr * 1.3);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.5, `rgba(255,255,255,${.15 * k})`); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    radial(x, y, R * .09, [[0, `rgba(255,255,255,${k})`], [.35, `rgba(255,252,238,${.85 * k})`], [1, "rgba(255,244,214,0)"]]);
    // faint lens-flare discs toward the middle of the screen
    [[.32, 24], [.52, 46], [.78, 18]].forEach(([f, r]) =>
      radial(x + (W * .5 - x) * f, y + (H * .55 - y) * f, r, [[0, `rgba(255,255,255,${.07 * k})`], [1, "rgba(255,255,255,0)"]]));
  }

  function drawCelestial() {
    const s = scene, p = s.progress;
    if (s.kind !== "clear") return;
    const k = 1 - s.clouds * .6;
    if (!s.night) {
      const x = W * (.14 + .72 * p), y = H * (.36 - .34 * Math.sin(Math.PI * p));
      drawSun(x, y, k);
    } else {
      const x = W * (.14 + .72 * p), y = H * (.34 - .2 * Math.sin(Math.PI * p)), R = Math.min(W, H) * .24;
      radial(x, y, R, [[0, `rgba(200,215,255,${.26 * k})`], [1, "rgba(200,215,255,0)"]]);
      ctx.globalAlpha = k; ctx.drawImage(moon, x - 48, y - 48, 96, 96); ctx.globalAlpha = 1;
    }
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000 || 0, .05); last = now; t += dt;
    ctx.clearRect(0, 0, W, H);
    if (!scene || scene.kind === "loading") return;
    const s = scene, wx = s.windX;

    // stars + the odd shooting star
    for (const st of stars) {
      ctx.globalAlpha = .3 + .7 * Math.abs(Math.sin(t * st.sp + st.ph));
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(st.x, st.y, st.big ? st.r * 1.7 : st.r, 0, 7); ctx.fill();
      if (st.big) { ctx.fillRect(st.x - 6, st.y - .4, 12, .8); ctx.fillRect(st.x - .4, st.y - 6, .8, 12); }
    }
    ctx.globalAlpha = 1;
    if (stars.length && !reduce) {
      if (!shoot && t >= nextShoot) { shoot = { x: rand(.2, .9) * W, y: rand(.03, .3) * H, life: 0 }; nextShoot = t + rand(9, 20); }
      if (shoot) {
        shoot.life += dt; const u = shoot.life / .7;
        if (u >= 1) shoot = null; else {
          const x = shoot.x - u * 220, y = shoot.y + u * 90, g = ctx.createLinearGradient(x, y, x + 70, y - 28);
          g.addColorStop(0, `rgba(255,255,255,${1 - u})`); g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 70, y - 28); ctx.stroke();
        }
      }
    }

    drawCelestial();

    // moody top-down shade for heavy cloud cover
    const shadeK = { rain: .3, storm: .48, snow: .1, cloudy: .1 }[s.kind] || 0;
    if (shadeK) {
      const g = ctx.createLinearGradient(0, 0, 0, H * .75);
      g.addColorStop(0, `rgba(${s.night ? "0,0,0" : "30,38,54"},${shadeK * (s.night ? .6 : 1)})`); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    for (const c of clouds) {
      c.x += (c.v + wx * 24) * dt;
      const cw = 560 * c.sc;
      if (c.x > W + 40) c.x = -cw; else if (c.x < -cw - 40) c.x = W;
      ctx.globalAlpha = c.o;
      if (c.flip) { ctx.save(); ctx.translate(c.x + cw, c.y); ctx.scale(-1, 1); ctx.drawImage(c.img, 0, 0, cw, 240 * c.sc); ctx.restore(); }
      else ctx.drawImage(c.img, c.x, c.y, cw, 240 * c.sc);
    }
    ctx.globalAlpha = 1;

    if (s.kind === "fog") {
      ctx.fillStyle = s.night ? "rgba(150,160,175,.07)" : "rgba(230,236,242,.16)"; ctx.fillRect(0, 0, W, H);
      for (const f of fogs) {
        f.x += f.v * dt;
        if (f.v > 0 && f.x > W) f.x = -f.w; else if (f.v < 0 && f.x < -f.w) f.x = W;
        ctx.drawImage(f.img, f.x, f.y, f.w, f.w * .22);
      }
    }

    if (drops.length) {
      const vx = 50 + wx * 240;
      RAIN_LAYERS.forEach((L, i) => {
        ctx.strokeStyle = (s.night ? "rgba(185,205,240," : "rgba(230,240,255,") + L.a + ")";
        ctx.lineWidth = L.w; ctx.beginPath();
        for (const d of drops) {
          if (d.L !== i) continue;
          d.x += vx * dt; d.y += d.v * dt;
          if (d.y > H) Object.assign(d, newDrop(i, false));
          ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - vx / d.v * d.len, d.y - d.len);
        }
        ctx.stroke();
      });
    }

    if (flakes.length) {
      for (const f of flakes) {
        f.y += f.v * dt; f.x += (Math.sin(t * .9 + f.ph) * f.sw + wx * 60) * dt;
        if (f.y > H + 8) { f.y = -8; f.x = rand(0, W); }
        ctx.globalAlpha = SNOW_LAYERS[f.L].a;
        ctx.drawImage(flake, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
      }
      ctx.globalAlpha = 1;
    }

    if (s.kind === "storm" && !reduce) {
      if (t >= nextBolt) {
        const pts = [[rand(.15, .85) * W, 0]], endY = H * rand(.35, .6);
        while (pts[pts.length - 1][1] < endY) { const [px, py] = pts[pts.length - 1]; pts.push([px + rand(-28, 28), py + rand(20, 50)]); }
        bolt = pts; flash = 1; nextBolt = t + rand(3.5, 9);
        echoAt = Math.random() < .6 ? t + .14 : 0;
      }
      if (echoAt && t >= echoAt) { flash = .7; echoAt = 0; }
      if (flash > 0) {
        ctx.fillStyle = `rgba(225,233,255,${flash * .28})`; ctx.fillRect(0, 0, W, H);
        if (bolt && flash > .3) {
          ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${flash})`; ctx.lineWidth = 2;
          ctx.shadowColor = "#cfe0ff"; ctx.shadowBlur = 14; ctx.beginPath();
          bolt.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.restore();
        }
        flash -= dt * 3.2;
      }
    }
  }

  function loop(now) { frame(now); raf = requestAnimationFrame(loop); }

  /* ---------- public ---------- */
  const PREVIEW = { clear: 0, partly: 2, cloudy: 3, fog: 45, rain: 63, heavyrain: 65, storm: 95, snow: 73 };
  function show(forecast) {
    const s = fromForecast(forecast);
    const q = new URLSearchParams(location.search);          // ?sky=rain&phase=night to force a look
    if (q.has("sky") || q.has("phase")) return preview(q.get("sky") || "clear", q.get("phase") || s.phase);
    applyColours(s); setScene(s);
  }
  function preview(kind = "clear", phase = "day") {
    const s = { ...classify(PREVIEW[kind] ?? 0), phase, night: phase === "night", progress: phase === "night" ? .4 : phase === "day" ? .45 : phase === "dawn" ? .03 : .97, windX: .2 };
    applyColours(s); setScene(s);
  }

  resize();
  // Neutral placeholder until the forecast arrives: browser-clock gradient, no sun/moon/stars,
  // so nothing can show the wrong time of day.
  const h = new Date().getHours();
  const early = { phase: h >= 7 && h < 18 ? "day" : h >= 5 && h < 7 ? "dawn" : h >= 18 && h < 20 ? "dusk" : "night" };
  const boot = { ...early, night: early.phase === "night", kind: "loading", clouds: 0, intensity: 0, progress: .5, windX: 0 };
  applyColours(boot); setScene(boot);

  return { show, preview };
})();
