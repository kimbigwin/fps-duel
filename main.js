import * as THREE from 'three';
import { PLAYER, RULES, MAPS, setMap, eyeHeight, rightOf, POSE, insideSolid, breakBox } from './map.js';
import { GUNS, DEFAULT_LOADOUT, CLASSES, gunBars } from './guns.js';
import { GameRoom } from './game.js';
import { gameNow, pauseClock, isPaused } from './clock.js';
import { Bot } from './bot.js';
import { stepMovement, MOVE, NADE, simNade } from './physics.js';
import {
  renderer, scene, camera, viewScene, composer, vignette, resize,
  tracer, sparks, puff, blood, bulletHole, surfaceAt, updateEffects, flashTex, muzzleTex, flareTex, muzzleFlash, buildMapMeshes, setSky, hideBox, explosion,
} from './world.js';
import { makeGun, makeSoldier, setXray, preloadGuns } from './models.js';
import { loadHuman, humanReady, Human } from './character.js';
import { TIERS, CURSE_COLOR, augText, statsFor, effWeapon, RUN } from './augments.js';
import { GRADES, PARTS, PART_KINDS, partEffect, partName, ARMOR, ITEMS, MAX_ITEMS, cardTitle, cardDesc, cardIcon, newKit } from './loot.js';

// ================= 상태 =================
const me = {
  id: 0, ent: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: true },
  yaw: 0, pitch: 0, hp: RULES.maxHp, maxHp: RULES.maxHp, dead: false,
  augs: [], stats: statsFor([]),
  loadout: [...DEFAULT_LOADOUT], slot: 0, weapon: DEFAULT_LOADOUT[0], ammo: {}, burstLeft: 0,
  reloadStart: 0, reloadUntil: 0, switchUntil: 0, lastFire: 0, ads: false, adsT: 0, boltT: 0, bloom: 0,
  doubleUsed: false, dashReadyAt: 0, dashUntil: 0, dashDir: null, lastShiftTap: 0, streak: 0,
  ghostUntil: 0, invulnUntil: 0,
  nades: { frag: 1, flash: 1 }, blindUntil: 0, blindLen: 1, throwT: 0,
  crT: 0, leanT: 0, slideUntil: 0, slideDir: null, nextSlide: 0,
  kit: newKit(), gold: 0, usingUntil: 0, usingItem: null, usingLen: 1, buffUntil: 0, buffSpeed: 1,
};
// id -> { name, mesh, target, yaw, pitch, w, dead, deadT, speed, augs, flinch, fallSign, ghostUntil, revealUntil, air }
const others = new Map();
let scores = {};
let locked = false, matchOver = false;
const keys = {};
let mouseDown = false, rightDown = false, firedThisClick = false;
let recoilKick = 0, shake = 0, bob = 0, stepAcc = 0, swayX = 0, swayY = 0, killPunch = 0, hurtPulse = 0;
let mode = null, bot = null, botDiff = 'normal';
let gameMode = 'duel', phase = 'waiting', phaseEnd = 0, roundNo = 1, stage = null, winRounds = RULES.winRounds;
let picking = false, lastCount = -1;

const $ = id => document.getElementById(id);
const ui = {
  lobby: $('lobby'), pause: $('pause'), pauseText: $('pauseText'), hud: $('hud'),
  hpfill: $('hpfill'), hptext: $('hptext'), hpbonus: $('hpbonus'), score: $('scoreboard'), status: $('status'),
  feed: $('feed'), center: $('center'), hit: $('hitmarker'), hitdir: $('hitdir'), msg: $('lobbyMsg'),
  ammo: $('ammo'), ammomax: $('ammomax'), wname: $('wname'), reload: $('reloadHint'), scope: $('scope'),
  cross: $('crosshair'), slotBox: $('slots'),
  banner: $('banner'), dmg: $('dmgLayer'), opAugs: $('opAugs'), myAugs: $('myAugs'), cool: $('cooldowns'),
  pick: $('pick'), pickTitle: $('pickTitle'), pickTimer: $('pickTimer').firstElementChild, cards: $('cards'),
  reroll: $('rerollBtn'), pickWait: $('pickWait'), slotPick: $('slotPick'),
  kit: $('kit'), useBar: $('useBar'), killStamp: $('killStamp'), blind: $('blind'), killcam: $('killcamTag'), roundRes: $('roundRes'),
  runEnd: $('runEnd'), runEndTitle: $('runEndTitle'), runEndText: $('runEndText'), runEndAugs: $('runEndAugs'),
};

// 증강 + 그 총이 든 칸의 등급·부착물 반영된 무기 수치
const W = name => effWeapon(name, me.stats, me.kit.mods[me.loadout.indexOf(name)]);

// ================= 1인칭 무기 =================
const viewRoot = new THREE.Group(); viewScene.add(viewRoot);
// 1인칭 팔은 사용자 결정(2026-11-02)으로 빼고 총만 보여 줌
const vGuns = {};
function vGun(id) {
  if (!vGuns[id]) { vGuns[id] = makeGun(id); vGuns[id].visible = false; viewRoot.add(vGuns[id]); }
  return vGuns[id];
}
// 총 종류별 화면 속 위치 (총 기준점 = 총 윗면, 방아쇠 위치)
const HIP = { long: new THREE.Vector3(0.15, -0.088, -0.47), pistol: new THREE.Vector3(0.13, -0.1, -0.5) };
const ADS_Z = { sniper: -0.22, pistol: -0.48, sg: -0.46 };
const hipFor = cls => HIP[cls === 'pistol' ? 'pistol' : 'long'];
// 도트사이트는 눈 가까이 당겨서 창이 넓게 보이게 (총 종류와 상관없이 같은 거리)
const adsZ = ud => ud.opticType === 'dot' ? -0.19 : ADS_Z[ud.cls] ?? (ud.optic ? -0.3 : -0.5);
// 가늠쇠 샷건은 원형 조준점으로 쏘므로 총을 조금 내려 몸통이 시야를 덜 가리게
const adsFor = g => new THREE.Vector3(0, -g.userData.sightHeight - (g.userData.cls === 'sg' && !g.userData.optic ? 0.04 : 0), adsZ(g.userData));

const G = id => GUNS[id] || GUNS[DEFAULT_LOADOUT[0]];
const heavy = id => { const c = G(id).cls; return c === 'sniper' || c === 'sg'; };
// 내 총구 화염: 총구에서 앞으로 뻗는 불꽃 판 2장(십자) + 정면 섬광 + 불꽃 별 모양
const flashAdd = map => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(2.2, 1.6, 1.0), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
const flashGroup = new THREE.Group(); flashGroup.visible = false; flashGroup.renderOrder = 10; viewScene.add(flashGroup);
const flameGeo = new THREE.PlaneGeometry(1, 1); flameGeo.translate(0, 0.5, 0); flameGeo.rotateX(-Math.PI / 2);   // 밑동이 총구, 앞(-Z)으로 뻗음
const flameA = new THREE.Mesh(flameGeo, flashAdd(flashTex)), flameB = new THREE.Mesh(flameGeo, flameA.material); flameB.rotation.z = Math.PI / 2;
const flareS = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(2.4, 1.8, 1.1), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
const starS = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(2.0, 1.4, 0.8), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
flameA.renderOrder = flameB.renderOrder = flareS.renderOrder = starS.renderOrder = 10;
flashGroup.add(flameA, flameB, flareS, starS);
// 총 종류별 화염 길이(m, 1인칭 화면 기준)
const FLAME = { ar: 0.42, br: 0.48, dmr: 0.5, smg: 0.36, pistol: 0.28, sg: 0.6, sniper: 0.65 };
let flashUntil = 0, flashFrames = 0;
// 화면 반동(보이는 것만, 실제 조준은 me.pitch): 쏠 때 위로 튀었다가 빨리 돌아옴
let camKick = 0, camKickYaw = 0, firePunch = 0;
// 연사할 때 좌우로 끌리는 정해진 무늬 (+ = 오른쪽). 처음 몇 발은 거의 위로만
const RECOIL_PAT = {
  ar: [0, 0.1, 0.25, 0.4, 0.3, -0.1, -0.45, -0.6, -0.4, 0.1, 0.5, 0.7, 0.4, -0.2],
  br: [0, 0.2, -0.2, 0.35, -0.35, 0.4, -0.4],
  dmr: [0, 0.3, -0.25, 0.35, -0.3],
  smg: [0, 0.15, -0.15, 0.3, 0.1, -0.3, -0.1, 0.35, 0.2, -0.4, 0.1, 0.45, -0.3, -0.1, 0.4, -0.45],
  pistol: [0, 0.2, -0.15, 0.3, -0.25],
  sg: [0, 0.4, -0.4],
  sniper: [0, 0.3],
};
const KICK = { ar: 0.012, br: 0.02, dmr: 0.028, smg: 0.009, pistol: 0.02, sg: 0.05, sniper: 0.06 };
const SHAKE = { ar: 0.22, br: 0.3, dmr: 0.32, smg: 0.18, pistol: 0.2, sg: 0.55, sniper: 0.6 };
const worldFlash = new THREE.PointLight(0xffb060, 0, 12, 2); scene.add(worldFlash);

// 탄피 (1인칭 화면 안에서 튀어나감)
const shellGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 8);
const shellMat = new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.9, roughness: 0.3 });
const shells = [];
function ejectShell() {
  const m = new THREE.Mesh(shellGeo, shellMat);
  m.position.set(0.04, 0.03, 0.02).applyEuler(viewRoot.rotation).add(viewRoot.position);
  viewScene.add(m);
  shells.push({ m, v: new THREE.Vector3(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.2), spin: new THREE.Vector3(Math.random() * 20, Math.random() * 20, 0), life: 0.6 });
}
function updateShells(dt) {
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.life -= dt; s.v.y -= 6 * dt;
    s.m.position.addScaledVector(s.v, dt);
    s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt;
    if (s.life <= 0) { viewScene.remove(s.m); shells.splice(i, 1); }
  }
}

// ================= 사운드 =================
let audio, master, verb;
const MASTER = 0.8;
// 음소거: M 키 또는 스피커 버튼. 브라우저에 기억
let muted = (() => { try { return localStorage.getItem('fps_mute') === '1'; } catch { return false; } })();
function ac() {
  if (!audio) {
    audio = new AudioContext();
    // 모든 소리 → master → 압축기(크게 해도 찢어지지 않게) → 스피커
    const comp = audio.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.15;
    master = audio.createGain(); master.gain.value = muted ? 0 : MASTER;
    master.connect(comp).connect(audio.destination);
    // 울림(잔향): 총소리 꼬리용. 소음을 지수적으로 줄인 임펄스로 만든 간단한 리버브
    const len = Math.floor(audio.sampleRate * 1.3), ir = audio.createBuffer(2, len, audio.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    verb = audio.createConvolver(); verb.buffer = ir;
    const vg = audio.createGain(); vg.gain.value = 0.5;
    verb.connect(vg).connect(master);
  }
  return audio;
}
function setMuted(v) {
  muted = v;
  try { localStorage.setItem('fps_mute', v ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(v ? 0 : MASTER, audio.currentTime, 0.02);
  document.querySelectorAll('.muteBtn').forEach(b => { b.textContent = v ? '🔇 소리 꺼짐 (M)' : '🔊 소리 켜짐 (M)'; b.classList.toggle('off', v); });
}
document.querySelectorAll('.muteBtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); setMuted(!muted); }));
// ---- 설정: 마우스 감도, 시야(FOV). 브라우저에 기억 ----
const loadNum = (k, d, lo, hi) => { try { const v = parseFloat(localStorage.getItem(k)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; } catch { return d; } };
const settings = { sens: loadNum('fps_sens', 1, 0.2, 3), fov: loadNum('fps_fov', 75, 60, 100) };
function syncSettings() {
  document.querySelectorAll('.sensIn').forEach(i => i.value = settings.sens);
  document.querySelectorAll('.fovIn').forEach(i => i.value = settings.fov);
  document.querySelectorAll('.sensVal').forEach(b => b.textContent = settings.sens.toFixed(2));
  document.querySelectorAll('.fovVal').forEach(b => b.textContent = settings.fov + '°');
}
document.querySelectorAll('.settingsBox').forEach(box => ['click', 'mousedown', 'pointerdown'].forEach(ev => box.addEventListener(ev, e => e.stopPropagation())));
document.querySelectorAll('.sensIn').forEach(i => i.addEventListener('input', () => { settings.sens = +i.value; try { localStorage.setItem('fps_sens', settings.sens); } catch {} syncSettings(); }));
document.querySelectorAll('.fovIn').forEach(i => i.addEventListener('input', () => { settings.fov = +i.value; try { localStorage.setItem('fps_fov', settings.fov); } catch {} syncSettings(); }));
syncSettings();
// ---- 조작 안내 ----
const guide = document.getElementById('guide');
function showGuide() { guide.classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock(); }
document.querySelectorAll('.guideBtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); showGuide(); }));
document.getElementById('guideClose').addEventListener('click', e => { e.stopPropagation(); guide.classList.add('hidden'); try { localStorage.setItem('fps_guide', '1'); } catch {} });
guide.addEventListener('click', e => e.stopPropagation());
function noiseBurst(len, type, freq, gain, decay = 3, when = 0) {
  const a = ac(), t = a.currentTime + when;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * len)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(master); src.start(t);
}
function thump(f0, f1, len, gain, when = 0, send = 0) {
  const a = ac(), t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g).connect(master); o.start(t); o.stop(t + len + 0.02);
  if (send) { const sg = a.createGain(); sg.gain.value = send; g.connect(sg).connect(verb); }
}
function tone(freq, len, gain, when = 0, type = 'triangle') {
  const a = ac(), t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g).connect(master); o.start(t); o.stop(t + len + 0.02);
}
// ---- 녹음된 효과음 (CC0: Free Firearm Sound Library 실총 녹음, Kenney Impact/UI Audio, Kenney Starter Kit FPS) ----
const SAMPLE_SETS = {
  rifle: ['rifle1', 'rifle2'], sniper: ['sniper1', 'sniper2'], ak: ['ak1', 'ak2', 'ak3', 'ak4', 'ak5', 'ak6', 'ak7'], shotgun: ['shotgun1', 'shotgun2'], pistol: ['pistol1', 'pistol2'],
  step: ['step0', 'step1', 'step2', 'step3', 'step4'],
  wall: ['wall0', 'wall1', 'wall2'], metal: ['metal0', 'metal1', 'metal2'], wood: ['wood0', 'wood1', 'wood2'],
  flesh: ['flesh0', 'flesh1', 'flesh2'], fleshh: ['fleshh0', 'fleshh1', 'fleshh2', 'fleshh3', 'fleshh4'], punch: ['punch0', 'punch1', 'punch2', 'punch3', 'punch4'],
  killpunch: ['killpunch', 'killpunch1', 'killpunch2', 'killpunch3', 'killpunch4'], headmetal: ['headmetal', 'headmetal1', 'headmetal2', 'headmetal3', 'headmetal4'],
  wallh: ['wallh0', 'wallh1', 'wallh2', 'wallh3', 'wallh4'], woodh: ['woodh0', 'woodh1', 'woodh2', 'woodh3', 'woodh4'], metalh: ['metalm0', 'metalm1', 'metalm2', 'metalm3', 'metalm4'],
  ui_hover: ['ui_hover'], ui_click: ['ui_click'], ui_switch: ['ui_switch'], swap: ['swap'], land: ['land'], jump: ['jump'],
};
const buffers = {};
let samplesLoading = null;
function loadSamples() {
  if (samplesLoading) return samplesLoading;
  const a = ac();
  const names = [...new Set(Object.values(SAMPLE_SETS).flat())];
  samplesLoading = Promise.all(names.map(n => fetch(`assets/sfx/${n}.mp3`).then(r => { if (!r.ok) throw new Error(n + ' ' + r.status); return r.arrayBuffer(); })
    .then(b => a.decodeAudioData(b)).then(buf => { buffers[n] = buf; }).catch(e => console.warn('효과음 로드 실패', n, e))));
  return samplesLoading;
}
// 샘플 재생. 아직 안 불러왔으면 false (합성음으로 대신)
function play(set, { gain = 1, rate = 1, when = 0, lowpass = 0, send = 0 } = {}) {
  const list = SAMPLE_SETS[set]; if (!list) return false;
  const name = list[Math.floor(Math.random() * list.length)];
  const buf = buffers[name]; if (!buf) return false;
  const a = ac(), t = a.currentTime + when;
  const src = a.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const g = a.createGain(); g.gain.value = gain;
  let node = src;
  if (lowpass) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node = node.connect(f); }
  node.connect(g).connect(master); src.start(t);
  if (send) { const sg = a.createGain(); sg.gain.value = send; g.connect(sg).connect(verb); }
  return true;
}
// 거리에 따라 작아지는 소리 (탄착음 등)
function playAt(set, pos, gain = 1, range = 35) {
  const d = camera.position.distanceTo(pos);
  if (d > range) return;
  play(set, { gain: gain * (1 - d / range) ** 1.5, rate: 0.92 + Math.random() * 0.16 });
}
// 브라우저는 클릭 전에는 소리를 막으므로 첫 입력 때 깨움
['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => { const a = ac(); if (a.state === 'suspended') a.resume(); loadSamples(); }, { passive: true }));

const LOUD = { rifle: 0.95, ak: 0.95, sniper: 1, shotgun: 1, pistol: 0.8 };
// 총소리 겹: [저음 시작Hz, 끝Hz, 길이, 크기, 울림양]. 녹음 위에 '쿵'과 잔향을 얹어 묵직하게
const BODY = { ar: [120, 42, 0.13, 0.75, 0.3], br: [105, 38, 0.17, 0.85, 0.35], dmr: [100, 36, 0.2, 0.9, 0.4], smg: [140, 50, 0.09, 0.55, 0.22], pistol: [150, 55, 0.1, 0.6, 0.25], sg: [85, 30, 0.3, 1.0, 0.45], sniper: [75, 26, 0.38, 1.0, 0.55] };
const sfx = {
  // 총소리: 총마다 녹음 묶음 + 재생 속도가 다름. far = 상대가 쏜 소리 (작고 먹먹하게)
  // quiet = 소음기: 작고 둔한 소리, 공기 터짐 없음
  gun(id, far, quiet) {
    const W = G(id), set = W.snd, r = W.rate * (0.97 + Math.random() * 0.06), L = (LOUD[set] || 0.9) * (quiet ? (far ? 0.3 : 0.5) : 1);
    const B = BODY[W.cls] || BODY.ar;
    if (play(set, far || quiet ? { gain: L * (far ? 0.42 : 1), rate: r, lowpass: quiet ? 1100 : set === 'sniper' ? 1800 : 2200, send: B[4] * (quiet ? 0.5 : 1.4) } : { gain: L, rate: r, send: B[4] })) {
      thump(B[0], B[1], B[2], B[3] * (far ? 0.35 : 1) * (quiet ? 0.6 : 1), 0, B[4]);
      if (!far && !quiet) noiseBurst(0.035, 'highpass', 2800, 0.35, 5);   // 총구 앞 '딱' 하는 공기 터짐
      return;
    }
    const k = far ? 0.35 : 1;
    if (set === 'sniper' || set === 'shotgun') { noiseBurst(0.6, 'lowpass', 1800, 0.9 * k, 5); thump(90, 28, 0.3, k); }
    else { noiseBurst(0.14, 'lowpass', 3200, 0.7 * k, 4); thump(150, 40, 0.09, 0.8 * k); }
  },
  bolt(len = 0.9) { noiseBurst(0.04, 'highpass', 2500, 0.3, 3, len * 0.39); noiseBurst(0.04, 'highpass', 3200, 0.3, 3, len * 0.67); },
  empty() { noiseBurst(0.03, 'highpass', 4000, 0.4); },
  reload(t) { noiseBurst(0.05, 'highpass', 2200, 0.35, 3, 0.15); noiseBurst(0.06, 'bandpass', 1500, 0.4, 3, t * 0.55); noiseBurst(0.05, 'highpass', 3000, 0.4, 3, t * 0.88); },
  // 맞혔을 때: 몸통은 묵직한 '퍽', 헤드샷은 쨍한 '팅'
  hit(head) {
    // 히트마커 소리(합성) + 실제 충격음(녹음)
    // 높은 '띵' 대신 묵직한 충격음이 주인공. 헤드샷은 짧은 금속음을 얹어 구분
    play('fleshh', { gain: 1, rate: 0.9 + Math.random() * 0.15 }); play('punch', { gain: 0.55, rate: 0.95 + Math.random() * 0.1 });
    thump(170, 55, 0.09, 0.5);
    if (head) { play('headmetal', { gain: 0.75, rate: 0.85 + Math.random() * 0.1 }); tone(1150, 0.07, 0.07, 0.005, 'sine'); }
    else tone(420, 0.04, 0.05, 0, 'sine');
  },
  kill() { play('killpunch', { gain: 1 }); thump(130, 40, 0.3, 0.8, 0, 0.3); tone(660, 0.25, 0.2, 0.02); tone(990, 0.35, 0.18, 0.08); tone(1320, 0.4, 0.12, 0.14); },
  hurt() { thump(220, 70, 0.15, 0.5); noiseBurst(0.08, 'lowpass', 800, 0.3, 3); },
  step() { if (!play('step', { gain: 0.35, rate: 0.9 + Math.random() * 0.2 })) noiseBurst(0.06, 'lowpass', 500, 0.18, 2); },
  land() { play('land', { gain: 0.5 }); },
  jump() { play('jump', { gain: 0.25 }); },
  swap() { if (!play('swap', { gain: 0.6 })) noiseBurst(0.05, 'highpass', 2000, 0.25, 3, 0.05); },
  tick() { tone(880, 0.08, 0.15, 0, 'square'); },
  go() { tone(660, 0.1, 0.2, 0, 'square'); tone(1320, 0.3, 0.2, 0.08, 'square'); },
  card() { if (!play('ui_switch', { gain: 0.6 })) noiseBurst(0.12, 'bandpass', 2400, 0.15, 2); },
  hover() { play('ui_hover', { gain: 0.4 }); },
  use(item) { noiseBurst(0.12, 'bandpass', item === 'heal' ? 1200 : 2600, 0.3, 3); },
  used(item) { tone(item === 'heal' ? 520 : 780, 0.12, 0.12, 0, 'sine'); tone(item === 'heal' ? 780 : 1170, 0.18, 0.1, 0.07, 'sine'); },
  buy() { play('ui_switch', { gain: 0.5 }); tone(990, 0.08, 0.1, 0, 'sine'); tone(1480, 0.12, 0.08, 0.05, 'sine'); },
  click() { play('ui_click', { gain: 0.6 }); },
  pick(tier) {
    const base = { silver: [523, 659, 784], gold: [523, 659, 784, 1047], prism: [523, 659, 784, 1047, 1319, 1568], curse: [440, 415, 392, 311] }[tier] || [523];
    base.forEach((f, i) => tone(f, 0.35, 0.18, i * 0.07, tier === 'curse' ? 'sawtooth' : 'triangle'));
    if (tier === 'prism') { thump(200, 60, 0.4, 0.5); noiseBurst(0.6, 'highpass', 6000, 0.15, 2, 0.1); }
  },
  fanfare() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 0.2, i * 0.09, 'square')); },
  fail() { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.4, 0.2, i * 0.18, 'sawtooth')); },
  throwN() { noiseBurst(0.12, 'bandpass', 1200, 0.3, 2); },
  // 폭발: 가까울수록 크게
  boom(kind, d) {
    const k = Math.max(0.15, 1 - d / 60);
    if (kind === 'frag') { thump(70, 22, 0.9, 1.3 * k, 0, 0.6); noiseBurst(1.1, 'lowpass', 1100, 1.0 * k, 3); play('metalh', { gain: 0.6 * k, rate: 0.6 }); }
    else { noiseBurst(0.18, 'highpass', 2600, 0.9 * k, 6); thump(160, 60, 0.15, 0.7 * k); }
  },
  // 섬광탄 이명
  ring(dur) { tone(3100, Math.min(3, dur), 0.08, 0, 'sine'); },
  slide() { noiseBurst(0.45, 'lowpass', 900, 0.35, 2); },
  dash() { noiseBurst(0.25, 'bandpass', 900, 0.4, 2); },
  jump2() { tone(500, 0.12, 0.12, 0, 'sine'); tone(800, 0.12, 0.1, 0.04, 'sine'); },
  ghost() { tone(300, 0.5, 0.15, 0, 'sine'); tone(450, 0.5, 0.1, 0.05, 'sine'); },
  revive() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, 0.2, i * 0.05, 'sine')); },
};

// ================= UI =================
function updateHp() {
  const r = Math.max(0, me.hp) / me.maxHp;
  ui.hpfill.style.width = Math.min(100, r * 100) + '%';
  ui.hpfill.style.background = r > 0.5 ? '#4cd964' : r > 0.25 ? '#ffcc00' : '#ff3b30';
  ui.hptext.textContent = Math.max(0, Math.round(me.hp));
  // 뒤질 때 받은 보너스 체력: 최대치를 넘는 만큼 금색으로 표시
  const over = Math.max(0, Math.round(me.hp - me.maxHp));
  ui.hpbonus.textContent = over > 0 && !me.dead ? `보너스 +${over}` : '';
  ui.hpfill.classList.toggle('bonus', over > 0);
}
function updateAmmo() {
  const Wp = W(me.weapon), n = me.ammo[me.weapon] ?? Wp.mag;
  ui.wname.textContent = Wp.name;
  ui.wname.style.color = Wp.grade ? GRADES[Wp.grade].color : '';
  ui.ammo.textContent = n;
  ui.ammo.classList.toggle('low', n <= Math.ceil(Wp.mag * 0.2));
  ui.ammomax.textContent = ` / ${Wp.mag}`;
  const html = me.loadout.map((id, i) => `<span class="${i === me.slot ? 'on' : ''}" style="--g:${GRADES[me.kit.mods[i].grade | 0].color}">${i + 1} ${escapeHtml(G(id).name)}${partTags(i)}</span>`).join('');
  if (ui.slotBox.innerHTML !== html) ui.slotBox.innerHTML = html;
  updateKit();
}
// 칸에 붙은 부착물 짧은 표시
// 줄임말(조1·탄2) 대신 알아볼 수 있는 이름으로 (2026-11-04 테스트 지적)
const PART_TAG = { mag: '탄창', muz: '소음기', grip: '손잡이' };
const OPTIC_TAG = ['', '레드도트', '2배율', '4배율'];
function partTags(slot) {
  const parts = me.kit.mods[slot].parts || {};
  const t = PART_KINDS.filter(k => parts[k]).map(k => k === 'optic' ? OPTIC_TAG[parts[k]] : `${PART_TAG[k]}${parts[k]}`).join('·');
  return t ? ` <em>${t}</em>` : '';
}
// 방어구·소모품·골드 표시
function updateKit() {
  const k = me.kit, a = [];
  if (k.armor.helmet) a.push(`<span class="arm">헬멧 Lv${k.armor.helmet}</span>`);
  if (k.armor.vest) a.push(`<span class="arm">조끼 Lv${k.armor.vest}</span>`);
  for (const id in NADE) a.push(`<span class="item${me.nades[id] ? '' : ' none'}"><kbd>${NADE[id].key}</kbd>${NADE[id].name} ${me.nades[id] | 0}</span>`);
  for (const id in ITEMS) a.push(`<span class="item${k.items[id] ? '' : ' none'}"><kbd>${ITEMS[id].key}</kbd>${ITEMS[id].name} ${k.items[id] | 0}</span>`);
  if (gameMode === 'run') a.push(`<span class="gold">${me.gold} G</span>`);
  const html = a.join('');
  if (ui.kit.innerHTML !== html) ui.kit.innerHTML = html;
}
function opponent() { return [...others.entries()][0]; }
function updateScore() {
  const op = opponent();
  const opName = op ? op[1].name : '상대 대기 중...';
  if (gameMode === 'run') {
    ui.score.innerHTML = `<span id="stageTag">STAGE ${stage?.stage ?? 1} / ${RUN.stages}</span> &nbsp; <span class="op">${escapeHtml(stage?.name ?? '')}</span>`;
    ui.status.textContent = '한 번 죽으면 런 종료';
  } else {
    ui.score.innerHTML = `<span class="me">나 ${scores[me.id] ?? 0}</span> &nbsp;:&nbsp; <span class="op">${scores[op?.[0]] ?? 0} ${escapeHtml(opName)}</span>`;
    ui.status.textContent = op ? `라운드 ${roundNo} · 먼저 ${winRounds}라운드 승리` : '같은 방 코드로 상대가 들어오길 기다리는 중';
  }
}
function chips(augs) {
  return augs.map(k => { const a = augText(k); return a ? `<span style="color:${a.color}" title="${escapeHtml(TIERS[a.tier].name + ' · ' + a.desc)}">${escapeHtml(a.name)}${a.curse ? '' : `<i>${'★'.repeat(a.lv + 1)}</i>`}</span>` : ''; }).join('');
}
function updateAugBars() {
  ui.myAugs.innerHTML = chips(me.augs);
  const op = opponent();
  ui.opAugs.innerHTML = op ? chips(op[1].augs || []) : '';
}
function feed(text) {
  const d = document.createElement('div'); d.textContent = text;
  ui.feed.prepend(d);
  setTimeout(() => d.remove(), 4500);
}
function flashClass(el, ms, cls, on = true) {
  el.classList.add('show'); if (cls) el.classList.toggle(cls, on);
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms);
}
function banner(html, cls = '') {
  ui.banner.className = ''; void ui.banner.offsetWidth;
  ui.banner.innerHTML = html; ui.banner.className = 'show ' + cls;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const weaponName = w => w === 'nade' ? '수류탄' : GUNS[w]?.name ?? '';
const nameOf = id => id === me.id ? '나' : others.get(id)?.name ?? '???';

// 데미지 숫자: 맞은 지점을 화면 좌표로 바꿔서 띄움
// 조준점 옆에 잠깐 뜨는 글자 (헤드샷 등)
function popText(text, cls = '') {
  const d = document.createElement('div');
  d.className = 'pop ' + cls; d.textContent = text;
  ui.hud.appendChild(d);
  setTimeout(() => d.remove(), 900);
}
function damageNumber(at, dmg, head, big, leg) {
  const v = new THREE.Vector3(...at); v.y += 0.2;
  v.project(camera);
  if (v.z > 1) return;
  const d = document.createElement('div');
  d.className = 'dmg' + (head ? ' head' : '') + (big ? ' big' : '') + (leg ? ' leg' : '');
  d.textContent = dmg;
  d.style.left = ((v.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30) + 'px';
  d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  ui.dmg.appendChild(d);
  setTimeout(() => d.remove(), 800);
}

// ================= 로비 =================
$('name').value = (() => { try { return localStorage.getItem('fps_name') || ''; } catch { return ''; } })();
$('room').value = new URLSearchParams(location.search).get('room') || '';
document.querySelectorAll('#diff button').forEach(b => b.onclick = () => {
  botDiff = b.dataset.d;
  document.querySelectorAll('#diff button').forEach(x => x.classList.toggle('on', x === b));
});
const getName = () => {
  const name = $('name').value.trim() || 'Player';
  try { localStorage.setItem('fps_name', name); } catch {}
  return name;
};
const bestRun = () => { try { return +localStorage.getItem('fps_best_run') || 0; } catch { return 0; } };
const showBest = () => { $('bestRun').textContent = bestRun() ? `최고 기록: ${bestRun()}스테이지 클리어` : '아직 기록 없음'; };
showBest();

let joining = false, sentReady = false;
$('joinBtn').onclick = () => {
  if (joining) return;
  joining = true; mode = 'online';
  ui.msg.textContent = '접속 중...';
  connect($('room').value.trim() || 'lobby', getName());
};
function startLocal(kind) {
  joining = true; mode = 'bot';
  hostGame = new GameRoom(kind === 'run' ? '로그라이크 런' : 'AI 봇전', kind === 'run' ? 'run' : 'duel', { waitReady: true });
  sentReady = false;
  localId = hostGame.join(getName(), msg => onMessage(msg));
  net = msg => hostGame.message(localId, msg);
  bot = new Bot(hostGame, botDiff);
  const o = others.get(bot.id);
  if (o) o.name = kind === 'run' ? 'BOT' : `BOT (${{ easy: '쉬움', normal: '보통', hard: '어려움' }[botDiff]})`;
  updateScore();
}
$('botBtn').onclick = () => { if (!joining) startLocal('duel'); };
$('runBtn').onclick = () => { if (!joining) startLocal('run'); };

// 런 다시 시작: 기존 방/봇/상대 모델 정리 후 새로 시작
function resetLocal() {
  hostGame?.dispose(); hostGame = null; bot = null;
  for (const o of others.values()) scene.remove(o.mesh);
  others.clear();
  me.id = 0; me.augs = []; me.stats = statsFor([]); me.kit = newKit(); me.gold = 0; scores = {}; matchOver = false; stage = null; sentReady = false; pauseClock(false);
  ui.runEnd.classList.add('hidden'); hidePick();
  ui.center.textContent = '';
}
$('runAgain').onclick = () => { resetLocal(); startLocal('run'); lockPointer(); };
$('toLobby').onclick = () => { location.href = location.pathname; };
document.querySelectorAll('.lobbyBtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); location.href = location.pathname + (mode === 'online' ? '' : ''); }));

// ================= P2P 연결 (PeerJS / WebRTC) =================
// 방 코드로 정해진 ID를 먼저 차지한 사람이 '방장'이 되어 게임 판정을 맡고,
// 두 번째 사람은 그 방장에게 직접 연결합니다. 별도 게임 서버가 필요 없습니다.
let peer = null, conn = null, hostGame = null, localId = null;
let net = () => {};

function peerOptions() {
  // 테스트용: ?peerhost=localhost&peerport=9000 으로 자체 PeerJS 서버 사용 가능
  const q = new URLSearchParams(location.search);
  if (!q.get('peerhost')) return { debug: +q.get('peerdebug') || 0 };
  return { host: q.get('peerhost'), port: +q.get('peerport') || 9000, path: q.get('peerpath') || '/', secure: q.get('peersecure') === '1', debug: +q.get('peerdebug') || 0 };
}
function roomPeerId(room) {
  const hex = [...new TextEncoder().encode(room.toLowerCase())].map(b => b.toString(16).padStart(2, '0')).join('');
  return 'fpsduel-v1-' + hex;
}
function lostConnection(text) {
  if (!ui.lobby.classList.contains('hidden')) {
    joining = false;
    ui.msg.textContent = text;
  } else {
    document.exitPointerLock();
    ui.center.innerHTML = text + '<br><small style="font-size:18px">새로고침해서 다시 들어오세요</small>';
  }
}

function connect(room, name) {
  const hostId = roomPeerId(room);
  peer = new Peer(hostId, peerOptions());

  peer.on('open', () => {
    hostGame = new GameRoom(room);
    localId = hostGame.join(name, msg => onMessage(msg));
    net = msg => hostGame.message(localId, msg);

    peer.on('connection', c => {
      let pid = null, lastSeen = Date.now();
      const hb = setInterval(() => {
        if (c.open) c.send({ t: 'ping' });
        if (c.open && Date.now() - lastSeen > 6000) { clearInterval(hb); c.close(); if (pid !== null) { hostGame.leave(pid); pid = null; } }
      }, 1000);
      c.on('open', () => { lastSeen = Date.now(); });
      c.on('data', m => {
        lastSeen = Date.now();
        if (m?.t === 'join' && pid === null) {
          pid = hostGame.join(m.name, msg => c.open && c.send(msg));
          if (pid === null) setTimeout(() => c.close(), 500);
        } else if (pid !== null) hostGame.message(pid, m);
      });
      const drop = () => { clearInterval(hb); if (pid !== null) { hostGame.leave(pid); pid = null; } };
      c.on('close', drop);
      c.on('error', drop);
    });
  });

  peer.on('error', err => {
    if (err.type === 'unavailable-id' && !hostGame && !conn) {
      peer.destroy();
      joinAsGuest(hostId, room, name);
    } else if (!hostGame && !conn) {
      lostConnection('연결 실패: ' + (err.type || err.message));
    }
  });
}

function joinAsGuest(hostId, room, name) {
  peer = new Peer(peerOptions());
  peer.on('open', () => {
    conn = peer.connect(hostId, { reliable: true });
    const timer = setTimeout(() => { if (!me.id) lostConnection('방장에게 연결하지 못했습니다. 네트워크 환경(회사망 등)에 따라 막힐 수 있어요.'); }, 15000);
    let lastSeen = Date.now(), hb = null;
    conn.on('open', () => {
      conn.send({ t: 'join', name, room });
      lastSeen = Date.now();
      hb = setInterval(() => {
        if (conn.open) conn.send({ t: 'ping' });
        if (me.id && Date.now() - lastSeen > 6000) { clearInterval(hb); lostConnection('방장과의 연결이 끊겼습니다'); }
      }, 1000);
    });
    conn.on('data', m => { lastSeen = Date.now(); if (m?.t === 'welcome') clearTimeout(timer); onMessage(m); });
    conn.on('close', () => { if (!ui.msg.textContent.startsWith('방이 가득')) lostConnection('방장과의 연결이 끊겼습니다'); });
    net = msg => conn.open && conn.send(msg);
  });
  peer.on('error', err => {
    if (me.id) return;
    lostConnection(err.type === 'peer-unavailable' ? '방장을 찾을 수 없어요. 몇 초 뒤 다시 시도해 주세요.' : '연결 실패: ' + (err.type || err.message));
  });
}

addEventListener('beforeunload', () => peer?.destroy());


// ================= 메시지 처리 =================
// 사람 모델이 준비되면 그걸 쓰고, 로딩 중이거나 실패하면 박스 병사를 씁니다
function makeOtherMesh() {
  if (!humanReady()) return makeSoldier(0xb8443a);
  const h = new Human();
  h.group.userData = { human: h, getGun: id => h.getGun(id), setWeapon: id => h.setWeapon(id) };
  return h.group;
}
preloadGuns(DEFAULT_LOADOUT);
loadHuman().then(() => {
  for (const o of others.values()) {
    if (o.mesh.userData.human) continue;
    const mesh = makeOtherMesh();
    mesh.position.copy(o.mesh.position); mesh.rotation.y = o.mesh.rotation.y; mesh.visible = o.mesh.visible;
    scene.remove(o.mesh); scene.add(mesh); o.mesh = mesh; o.xray = false;
    mesh.userData.setWeapon(o.w);
  }
}).catch(e => console.warn('사람 모델 로드 실패, 박스 병사로 진행', e));

function addOther(o) {
  const mesh = makeOtherMesh();
  mesh.position.set(...o.pos);
  scene.add(mesh);
  others.set(o.id, {
    name: o.name, mesh, target: new THREE.Vector3(...o.pos), yaw: o.yaw || 0, pitch: 0, w: o.loadout?.[0] || DEFAULT_LOADOUT[0], dead: !!o.dead, deadT: 0,
    speed: 0, vel: new THREE.Vector3(), augs: o.augs || [], flinch: 0, flinchHead: false, fallSign: 1, ghostUntil: 0, revealUntil: 0, xray: false, air: false,
  });
  mesh.visible = !o.dead;
  mesh.userData.setWeapon(others.get(o.id).w);
  updateAugBars();
}

function resetLoadout() {
  me.ammo = Object.fromEntries(me.loadout.map(id => [id, W(id).mag]));
  me.weapon = me.loadout[me.slot] || me.loadout[0]; me.burstLeft = 0;
  me.reloadStart = 0; me.reloadUntil = 0; me.switchUntil = 0; me.ads = false; me.boltT = 0; me.pendingReload = null;
  me.dashReadyAt = 0; me.doubleUsed = false; me.ghostUntil = 0; me.invulnUntil = 0; me.usingUntil = 0; me.buffUntil = 0; me.nades = { frag: 1, flash: 1 }; me.blindUntil = 0;
  ui.reload.textContent = '';
  updateAmmo();
}
function respawnMe(m) {
  stopKillcam();
  me.ent.pos.set(...m.pos); me.ent.vel.set(0, 0, 0);
  me.yaw = m.yaw; me.pitch = 0; me.hp = m.hp; me.maxHp = m.maxHp || me.stats.maxHp; me.capHp = Math.max(me.maxHp, m.hp); me.dead = false;
  ui.center.textContent = ''; ui.center.className = '';
  resetLoadout();
  updateHp();
  if (m.bonus) feed(`뒤지고 있어서 체력 +${m.bonus} 보정`);
}

function muzzleWorld() {
  // 화면 속 총구 위치를 월드 좌표로 근사
  const q = camera.quaternion;
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const k = 1 - me.adsT;
  return camera.position.clone().addScaledVector(f, 0.8).addScaledVector(r, 0.17 * k).addScaledVector(u, -0.12 * k - 0.05);
}

// ---------- 증강 선택 화면 ----------
let pickDur = RULES.pickTime, pickStart = 0;
function showPick(m) {
  picking = true;
  if (!m.reroll) { pickStart = nowS(); pickDur = m.dur ?? RULES.pickTime; }
  const T = TIERS[m.tier] || TIERS.silver;
  ui.pickTitle.innerHTML = (gameMode === 'run' ? `STAGE ${roundNo - 1} 클리어! ` : '') + `<b style="color:${T.color}">${T.name}</b> 증강 선택` + (m.curse ? ` <small style="color:${CURSE_COLOR}">+ 저주 카드</small>` : '');
  ui.cards.innerHTML = ''; ui.slotPick.innerHTML = '';
  ui.cards.dataset.tier = m.tier || 'silver';
  m.opts.forEach((id, i) => {
    const a = augText(id);
    const c = document.createElement('div');
    c.className = 'card ' + a.tier + (a.curse ? ' curse' : '');
    c.style.setProperty('--c', a.color);
    c.style.setProperty('--icon', `url(assets/ui/${a.icon}.png)`);
    c.innerHTML = `<div class="tier">${a.curse ? '저주 · ' : ''}${TIERS[a.tier].name}</div><div class="gem"><i></i></div><div class="name">${escapeHtml(a.name)}</div><div class="line"></div><div class="desc">${escapeHtml(a.desc)}</div><div class="key">${i + 1}번 키 또는 클릭</div>`;
    c.onclick = () => choose(id, c);
    c.onmouseenter = () => sfx.hover();
    ui.cards.appendChild(c);
  });
  ui.reroll.classList.toggle('hidden', !(m.rerolls > 0));
  ui.reroll.textContent = `새로고침 (${m.rerolls})`;
  ui.pickWait.classList.add('hidden');
  ui.pick.classList.remove('hidden');
  sfx.card();
  if (document.pointerLockElement) document.exitPointerLock();
  refreshPause();
}
function choose(id, el) {
  if (!picking) return;
  picking = false;
  [...ui.cards.children].forEach(c => { if (c !== el) c.style.opacity = 0.25; });
  el?.classList.add('chosen');
  { const a = augText(id); sfx.click(); sfx.pick(a.curse ? 'curse' : a.tier); }
  net({ t: 'pick', id });
  ui.reroll.classList.add('hidden');
  // 이어서 총 선택 화면이 뜨므로 포인터는 총 선택 뒤에 다시 잠금
}
function hidePick() { picking = false; gunPicking = false; lootPicking = false; shopping = false; ui.pick.classList.add('hidden'); ui.slotPick.innerHTML = ''; refreshPause(); }

// ---------- 총 선택 화면 (증강 뒤) ----------
let gunPicking = false, gunSel = null, gunOpts = [];
// 칸 고르기는 Q/E (숫자키는 카드 고르기 전용. 2026-11-04: 숫자키가 카드·칸 둘 다라 실수로 총이 바뀜)
const SLOT_KEY = ['Q', 'E'];
const bar = (label, v) => `<span>${label}</span><b><i style="width:${Math.round(v * 100)}%"></i></b>`;
function showGunPick(m) {
  picking = false; gunPicking = true; gunSel = null; gunOpts = (m.opts || []).map(o => typeof o === 'string' ? { id: o, grade: 0 } : o);
  pickStart = nowS(); pickDur = m.dur || 0;   // 0 = 시간 제한 없음 (고를 때까지 기다림)
  preloadGuns(gunOpts.map(o => o.id));
  ui.pickTitle.innerHTML = `<b style="color:#7fd6ff">총 선택</b> <small style="font-size:15px;letter-spacing:1px">증강과 칸에 붙은 부착물은 새 총에도 그대로 적용돼요</small>`;
  ui.cards.innerHTML = ''; ui.cards.dataset.tier = 'gun';
  gunOpts.forEach(({ id, grade }, i) => {
    const Wg = GUNS[id], b = gunBars(Wg), Gr = GRADES[grade] || GRADES[0];
    const c = document.createElement('div');
    c.className = 'card gun';
    c.style.setProperty('--c', Gr.color);
    c.innerHTML = `<div class="tier">${Gr.name} · ${escapeHtml(CLASSES[Wg.cls])}${grade ? ` <small>데미지 +${Math.round((Gr.dmg - 1) * 100)}%${Gr.syn > 1 ? ` · 증강 시너지 +${Math.round((Gr.syn - 1) * 100)}%` : ''}</small>` : ''}</div><div class="gunimg" style="background-image:url(assets/ui/guns/${id}.png)"></div>`
      + `<div class="name">${escapeHtml(Wg.name)}</div><div class="line"></div><div class="desc">${escapeHtml(Wg.desc)}</div>`
      + `<div class="bars">${bar('데미지', b.dmg)}${bar('화력', b.rate)}${bar('사거리', b.range)}${bar('이동', b.move)}</div>`
      + `<div class="spec">탄창 ${Wg.mag} · 재장전 ${Wg.reload}초${Wg.pellets ? ` · 산탄 ${Wg.pellets}알` : ''}${Wg.burst ? ` · ${Wg.burst}점사` : Wg.auto ? ' · 연사' : ' · 단발'}</div>`
      + `<div class="key">${i + 1}번 키 또는 클릭</div>`;
    c.onclick = () => selectGun(i);
    c.onmouseenter = () => sfx.hover();
    ui.cards.appendChild(c);
  });
  renderSlots();
  ui.reroll.classList.add('hidden');
  ui.pickWait.classList.add('hidden');
  ui.pick.classList.remove('hidden');
  sfx.card();
  if (document.pointerLockElement) document.exitPointerLock();
  refreshPause();
}
function renderSlots() {
  ui.slotPick.innerHTML = '';
  me.loadout.forEach((id, i) => {
    const btn = document.createElement('button');
    const parts = me.kit.mods[i].parts || {}, np = PART_KINDS.filter(k => parts[k]).length;
    btn.textContent = (gunSel ? `${i + 1}번 칸 ${G(id).name} → ${G(gunSel).name}` + ` (${SLOT_KEY[i]} 키)` : `${i + 1}번 칸: ${G(id).name}`) + (np ? ` · 부착물 ${np}개 유지` : '');
    btn.disabled = !gunSel;
    btn.onclick = () => chooseSlot(i);
    ui.slotPick.appendChild(btn);
  });
  const pass = document.createElement('button');
  pass.className = 'pass'; pass.textContent = '패스 · 지금 총 유지 (X 키)';
  pass.onclick = passGun;
  ui.slotPick.appendChild(pass);
}
function selectGun(i) {
  if (!gunPicking || !gunOpts[i]) return;
  gunSel = gunOpts[i].id; sfx.click();
  [...ui.cards.children].forEach((c, k) => c.classList.toggle('sel', k === i));
  renderSlots();
}
// 총을 고르면 이어서 파밍(대결: 카드 3장, 런: 상점)이 바로 뜸. 포인터는 파밍이 끝날 때 잠금
function endGunPick(msg) {
  if (!gunPicking) return;
  gunPicking = false;
  ui.slotPick.querySelectorAll('button').forEach(b => b.disabled = true);
  net(msg);
}

// ---------- 파밍 (대결: 카드 3장 중 1장) / 상점 (런) ----------
let lootPicking = false, shopping = false, lootOpts = [], lootSel = -1;
const LV_COLOR = ['#b8c0cc', '#5fd38a', '#5aa8ff', '#c77dff'];
const cardColor = c => c.kind === 'item' ? '#ffd166' : c.kind === 'rest' ? '#6dff9c' : LV_COLOR[c.lv] || LV_COLOR[1];
// 부착물 카드: 칸마다 실제로 붙을 효과 (안 맞는 총이면 바뀐 효과)
function slotEffects(c) {
  return me.loadout.map((id, i) => {
    const e = partEffect(c.part, c.lv, W(id)), cur = me.kit.mods[i].parts?.[c.part] | 0;
    return { i, id, e, cur };
  });
}
function lootCard(c, i, extra = '') {
  const el = document.createElement('div');
  el.className = 'card loot' + (c.sold ? ' sold' : '');
  el.style.setProperty('--c', cardColor(c));
  el.style.setProperty('--icon', `url(assets/ui/${cardIcon(c)}.png)`);
  const kindName = c.kind === 'part' ? '부착물' : c.kind === 'armor' ? '방어구' : c.kind === 'rest' ? '휴식 · 무료' : '소모품';
  let desc = escapeHtml(cardDesc(c));
  if (c.kind === 'part') desc += '<div class="eff">' + slotEffects(c).map(s => `<div${s.e.conv ? ' class="conv"' : ''}><b>${s.i + 1}번 ${escapeHtml(G(s.id).name)}</b> ${escapeHtml(s.e.label)}${s.e.conv ? ' <i>바뀐 효과</i>' : ''}</div>`).join('') + '</div>';
  if (c.kind === 'armor' && me.kit.armor[c.part] >= c.lv) desc += `<div class="eff warn">이미 Lv${me.kit.armor[c.part]} 있음 (효과 없음)</div>`;
  if (c.kind === 'item' && me.kit.items[c.part] >= MAX_ITEMS) desc += `<div class="eff warn">최대 ${MAX_ITEMS}개까지</div>`;
  el.innerHTML = `<div class="tier">${kindName}${c.lv ? ' · Lv' + c.lv : ''}</div><div class="gem"><i></i></div><div class="name">${escapeHtml(cardTitle(c))}</div><div class="line"></div><div class="desc">${desc}</div>${extra}<div class="key">${i + 1}번 키 또는 클릭</div>`;
  el.onmouseenter = () => sfx.hover();
  return el;
}
function showLoot(m) {
  picking = false; gunPicking = false; lootPicking = true; shopping = false; lootSel = -1; lootOpts = m.opts || [];
  if (m.kit) me.kit = m.kit;
  ui.pickTitle.innerHTML = `<b style="color:#ffd166">파밍</b> <small style="font-size:15px;letter-spacing:1px">1장 고르기 · 부착물은 칸에 붙어서 총을 바꿔도 따라가요</small>`;
  ui.cards.innerHTML = ''; ui.cards.dataset.tier = 'loot';
  lootOpts.forEach((c, i) => { const el = lootCard(c, i); el.onclick = () => selectLoot(i); ui.cards.appendChild(el); });
  renderLootSlots();
  ui.reroll.classList.add('hidden'); ui.pickWait.classList.add('hidden'); ui.pick.classList.remove('hidden');
  sfx.card();
  if (document.pointerLockElement) document.exitPointerLock();
  refreshPause();
}
// 아래 버튼: 부착물을 고르면 1번/2번 칸, 그 밖에는 패스(또는 상점 끝내기)
function renderLootSlots() {
  ui.slotPick.innerHTML = '';
  const list = shopping ? shopItems : lootOpts, c = list[lootSel];
  if (c?.kind === 'part') {
    for (const s of slotEffects(c)) {
      const btn = document.createElement('button');
      btn.textContent = `${s.i + 1}번 칸 ${G(s.id).name}: ${s.e.label}${s.cur ? ` (지금 ${partName(c.part, s.cur)} 교체)` : ''} (${SLOT_KEY[s.i]} 키)`;
      btn.onclick = () => lootSlot(s.i);
      ui.slotPick.appendChild(btn);
    }
  } else if (!shopping) {
    const hint = document.createElement('button'); hint.disabled = true; hint.textContent = '카드를 고르세요';
    ui.slotPick.appendChild(hint);
  }
  const pass = document.createElement('button');
  pass.className = 'pass';
  pass.textContent = shopping ? '다음 스테이지로 (Enter)' : '패스 · 안 받기 (X 키)';
  pass.onclick = shopping ? endShop : () => endLoot({ t: 'loot', pass: true });
  ui.slotPick.appendChild(pass);
}
function selectLoot(i) {
  const list = shopping ? shopItems : lootOpts, c = list[i];
  if (!c || (!lootPicking && !shopping)) return;
  if (shopping && (c.sold || me.gold < c.price || (c.kind === 'armor' && me.kit.armor[c.part] >= c.lv) || (c.kind === 'item' && me.kit.items[c.part] >= MAX_ITEMS))) { sfx.empty(); return; }
  sfx.click();
  if (c.kind !== 'part') {   // 방어구·소모품은 바로
    if (shopping) { net({ t: 'buy', i }); sfx.buy(); lootSel = -1; renderLootSlots(); return; }
    lootSel = i; return finishLootChoice(undefined);
  }
  lootSel = i;
  [...ui.cards.children].forEach((el, k) => el.classList.toggle('sel', k === i));
  renderLootSlots();
}
function lootSlot(slot) {
  if (lootSel < 0) return;
  if (shopping) { net({ t: 'buy', i: lootSel, slot }); sfx.buy(); lootSel = -1; [...ui.cards.children].forEach(el => el.classList.remove('sel')); renderLootSlots(); return; }
  finishLootChoice(slot);
}
function finishLootChoice(slot) {
  const el = ui.cards.children[lootSel];
  [...ui.cards.children].forEach(c => { if (c !== el) c.style.opacity = 0.25; });
  el?.classList.add('chosen'); sfx.pick('gold');
  endLoot({ t: 'loot', i: lootSel, slot });
}
function endLoot(msg) {
  if (!lootPicking) return;
  if (msg.pass) { sfx.click(); [...ui.cards.children].forEach(c => c.style.opacity = 0.25); }
  lootPicking = false;
  ui.slotPick.querySelectorAll('button').forEach(b => b.disabled = true);
  net(msg);
  lockPointer();   // 클릭/키 입력 안에서 잠가야 브라우저가 허락함
}
// 런 상점
let shopItems = [];
function showShop(m) {
  shopItems = m.items || []; me.gold = m.gold ?? me.gold;
  if (m.open) { picking = false; gunPicking = false; lootPicking = false; shopping = true; lootSel = -1; sfx.card(); if (document.pointerLockElement) document.exitPointerLock(); }
  if (!shopping) return;
  ui.pickTitle.innerHTML = `<b style="color:#ffd166">상점</b> <small style="font-size:15px;letter-spacing:1px">보유 <b style="color:#ffd166">${me.gold} G</b> · 스테이지를 깰 때마다 골드를 얻어요</small>`;
  ui.cards.innerHTML = ''; ui.cards.dataset.tier = 'loot';
  shopItems.forEach((c, i) => {
    const el = lootCard(c, i, `<div class="price${me.gold < c.price && !c.sold ? ' poor' : ''}">${c.sold ? (c.kind === 'rest' ? '쉬었음' : '구매 완료') : c.price ? c.price + ' G' : '무료'}</div>`);
    el.classList.add('shop');
    if (!c.sold && me.gold < c.price) el.classList.add('poor');
    el.style.animationDelay = m.open ? '' : '0s';
    el.onclick = () => selectLoot(i);
    ui.cards.appendChild(el);
  });
  renderLootSlots();
  ui.reroll.classList.add('hidden'); ui.pickWait.classList.add('hidden'); ui.pick.classList.remove('hidden');
  updateKit(); refreshPause();
}
function endShop() {
  if (!shopping) return;
  shopping = false; sfx.click();
  ui.slotPick.querySelectorAll('button').forEach(b => b.disabled = true);
  net({ t: 'shopdone' });
  lockPointer();
}
function chooseSlot(slot) {
  if (!gunSel) return;
  const el = [...ui.cards.children].find(c => c.classList.contains('sel'));
  [...ui.cards.children].forEach(c => { if (c !== el) c.style.opacity = 0.25; });
  el?.classList.add('chosen'); sfx.pick('gold');
  endGunPick({ t: 'gunpick', id: gunSel, slot });
}
function passGun() { sfx.click(); [...ui.cards.children].forEach(c => c.style.opacity = 0.25); endGunPick({ t: 'gunpick', pass: true }); }
ui.reroll.onclick = () => { if (picking) net({ t: 'reroll' }); };
$('creditsBtn').onclick = () => $('credits').classList.remove('hidden');
$('creditsClose').onclick = () => $('credits').classList.add('hidden');

// 맵 바꾸기 (방장과 같은 브라우저면 데이터는 이미 바뀌어 있으므로 화면만 다시 만듦)
let builtMap = 0, mapName = MAPS[0].name;
function applyMap(i) {
  if (i === undefined || i === null) return;
  setMap(i); mapName = MAPS[i].name;
  if (builtMap === i) return;
  builtMap = i; buildMapMeshes(); setSky(MAPS[i].sky);
}
function onMessage(m) {
  switch (m.t) {
    case 'map':
      applyMap(m.i); break;
    case 'nade': {
      if (m.by === me.id) { me.nades = m.nades; updateKit(); }
      const mesh = new THREE.Mesh(nadeGeo[m.kind], nadeMat[m.kind]); mesh.castShadow = true; scene.add(mesh);
      nadeMeshes.set(m.nid, { mesh, kind: m.kind, p0: m.p, v0: m.v, start: nowS() });
      sfx.throwN(); break;
    }
    case 'boom': {
      const n = nadeMeshes.get(m.nid); if (n) { scene.remove(n.mesh); nadeMeshes.delete(m.nid); }
      const p = new THREE.Vector3(...m.p), d = p.distanceTo(camera.position);
      explosion(p, m.kind);
      sfx.boom(m.kind, d);
      if (m.kind === 'frag') { shake = Math.max(shake, 1.4 * Math.max(0, 1 - d / 22)); worldFlash.intensity = 120; worldFlash.position.copy(p).y += 1; flashUntil = nowS() + 0.08; flashFrames = 3; }
      break;
    }
    case 'flash':
      if (m.id === me.id) { me.blindUntil = nowS() + m.dur; me.blindLen = m.dur; sfx.ring(m.dur); }
      break;
    case 'break':
      breakBox(m.i);
      { const c = hideBox(m.i); if (c) playAt('woodh', c, 1); }
      break;
    case 'full':
      lostConnection('방이 가득 찼습니다 (최대 2명). 다른 방 코드를 써 주세요.');
      peer?.destroy(); break;
    case 'welcome':
      me.id = m.id;
      applyMap(m.map ?? 0);
      if (m.loadout) { me.loadout = m.loadout; me.slot = 0; }
      me.kit = m.kit || newKit(); me.gold = 0;
      gameMode = m.mode || 'duel'; winRounds = m.winRounds || RULES.winRounds;
      respawnMe(m);
      m.others.forEach(addOther);
      scores = m.scores;
      if (mode === 'online') { const u = new URL(location.href); u.searchParams.set('room', m.room); history.replaceState(null, '', u); }
      ui.lobby.classList.add('hidden');
      ui.hud.classList.remove('hidden');
      ui.pause.classList.remove('hidden');
      ui.pauseText.textContent = gameMode === 'run' ? '로그라이크 런 · 클릭해서 시작' : mode === 'bot' ? 'AI 봇전 · 클릭해서 시작' : `방 "${m.room}" 입장 완료 · 클릭해서 시작`;
      updateScore(); updateAugBars();
      if ((() => { try { return !localStorage.getItem('fps_guide'); } catch { return false; } })()) showGuide();
      break;
    case 'join':
      addOther(m); feed(`${m.name} 입장`); updateScore(); break;
    case 'leave': {
      const o = others.get(m.id);
      if (o) { scene.remove(o.mesh); others.delete(m.id); feed(`${o.name} 퇴장`); }
      hidePick(); updateScore(); updateAugBars(); break;
    }
    case 'phase':
      phase = m.phase; phaseEnd = nowS() + (m.dur || 0); roundNo = m.round; lastCount = -1;
      if (phase === 'countdown') {
        hidePick(); matchOver = false; stopKillcam(); resetRoundStats();
        if (gameMode !== 'run') banner(`ROUND ${roundNo}<small>${escapeHtml(mapName)}</small>`);
      }
      if (phase === 'live') { ui.center.className = 'count'; ui.center.textContent = 'FIGHT!'; sfx.go(); setTimeout(() => { if (phase === 'live' && ui.center.textContent === 'FIGHT!') { ui.center.textContent = ''; ui.center.className = ''; } }, 700); }
      if (phase === 'pick' && !picking && !gunPicking && !lootPicking && !shopping) { ui.pick.classList.remove('hidden'); ui.cards.innerHTML = ''; ui.pickTitle.textContent = '증강 선택 중'; ui.reroll.classList.add('hidden'); ui.pickWait.classList.remove('hidden'); pickStart = nowS(); pickDur = m.dur; }
      if (phase === 'waiting') hidePick();
      updateScore();
      break;
    case 'stage':
      stage = m;
      banner(`${m.boss ? 'BOSS' : 'STAGE ' + m.stage}<small>${m.boss ? escapeHtml(m.name) + ' · ' : ''}${escapeHtml(MAPS[(m.stage - 1) % MAPS.length].name)} · ${m.stage} / ${m.total}${m.augs ? ` · 봇 증강 ${m.augs}개` : ''}</small>`, m.boss ? 'boss' : '');
      updateScore();
      break;
    case 'pick':
      showPick(m); break;
    case 'picked':
      break;
    case 'augs':
      if (m.id === me.id) {
        me.augs = m.augs; me.stats = statsFor(m.augs);
        updateAmmo();
      } else { const o = others.get(m.id); if (o) o.augs = m.augs; }
      updateAugBars();
      break;
    case 'state': {
      const o = others.get(m.id); if (!o) break;
      o.target.set(...m.p); o.yaw = m.yaw; o.pitch = m.pitch; o.air = !!m.air; o.cr = +m.cr || 0; o.ln = +m.ln || 0;
      if (m.w && m.w !== o.w && GUNS[m.w]) { o.w = m.w; o.mesh.userData.setWeapon(m.w); }
      break;
    }
    case 'shot': {
      const o3 = new THREE.Vector3(...m.o), Wg = G(m.w), cls = Wg.cls, pel = (m.rays?.length || 1) > 1;
      let from;
      if (m.id === me.id) from = muzzleWorld();
      else {
        const o = others.get(m.id);
        from = o3.clone();
        if (o) { o.mesh.userData.getGun(o.w).userData.muzzle.getWorldPosition(from); if (o.mesh.visible) muzzleFlash(from, (cls === 'sniper' ? 1.1 : cls === 'sg' ? 1.0 : cls === 'pistol' ? 0.5 : 0.75) * (m.q ? 0.35 : 1), m.rays?.[0] ? new THREE.Vector3(...m.rays[0].end).sub(from).normalize() : null); }
        sfx.gun(m.w, true, !!m.q);
      }
      let sounded = false;
      for (const r of m.rays || []) {
        const end = new THREE.Vector3(...r.end);
        // 내가 맞은 총알은 화면 바로 앞에서 끊어서 그림
        const camD = end.distanceTo(camera.position);
        const tEnd = camD < 1.5 ? end.clone().lerp(from, Math.min(1, 1.5 / Math.max(from.distanceTo(end), 1.5))) : end;
        tracer(from, tEnd, r.pierced ? 0xff6af0 : cls === 'sniper' ? 0xbfe4ff : 0xffd27a);
        // 관통탄: 뚫고 지나간 벽에도 자국
        if (r.pierced && r.wallT) {
          const d = end.clone().sub(o3).normalize(), wp = o3.clone().addScaledVector(d, r.wallT);
          const s = surfaceAt(o3, wp.clone().addScaledVector(d, 0.05));
          if (s) { bulletHole(s.point, s.normal); sparks(s.point, s.normal, 0xff6af0, pel ? 4 : 10); }
        }
        if (r.hit) { if (camD > 1.5) blood(end); }
        else {
          const s = surfaceAt(o3, end);
          if (s) {
            if (!sounded) { const heavyHit = cls === 'sniper' || cls === 'sg' || cls === 'dmr'; playAt((s.kind || 'wall') + (heavyHit ? 'h' : ''), s.point, heavyHit ? 1 : 0.8); sounded = true; }
            bulletHole(s.point, s.normal);
            sparks(s.point, s.normal, 0xffb050, cls === 'sniper' ? 14 : pel ? 3 : 6);
            if (!pel || Math.random() < 0.35) puff(s.point.clone().addScaledVector(s.normal, 0.1), 0xbdb6aa, cls === 'sniper' ? 0.9 : 0.4);
          }
        }
      }
      break;
    }
    case 'hit':
      if (m.target === me.id) {
        rs.taken += m.dmg || 0;
        me.hp = m.hp; updateHp(); sfx.hurt(); shake = Math.max(shake, heavy(m.w) ? 0.6 : 0.3); hurtPulse = Math.min(1, hurtPulse + (m.dmg || 20) / 60);
        if (m.from) {
          const ang = Math.atan2(-(m.from[0] - me.ent.pos.x), -(m.from[2] - me.ent.pos.z)) - me.yaw;
          ui.hitdir.style.transform = `rotate(${-ang}rad)`;
          flashClass(ui.hitdir, 700);
        }
      } else {
        const o = others.get(m.target);
        if (o) { o.flinch = Math.min(2, o.flinch + (m.head ? 1.6 : 1.0)); o.flinchHead = m.head; }
        if (m.by === me.id) {
          rs.hits++; rs.dmg += m.dmg || 0; if (m.head) rs.heads++;
          stats.hits++; stats.dmg += m.dmg || 0; if (m.head) stats.heads++;
          const killing = m.hp <= 0;
          flashClass(ui.hit, killing ? 400 : 160, 'head', !!m.head);
          ui.hit.classList.toggle('kill', killing);
          sfx.hit(m.head);
          if (m.dmg > 0 && m.at) damageNumber(m.at, m.dmg, m.head, m.dmg >= 80, m.part === 'leg');
          if (m.head) popText(killing ? '헤드샷 처치' : '헤드샷', 'hs');
          ui.cross.classList.add('hitpulse'); clearTimeout(ui.cross._t); ui.cross._t = setTimeout(() => ui.cross.classList.remove('hitpulse'), 120);
          recoilKick = Math.max(recoilKick, 0.4);
        }
      }
      break;
    case 'loadout':
      if (m.id === me.id) {
        me.loadout = m.loadout;
        if (m.kit) me.kit = m.kit;
        if (m.gold !== undefined) me.gold = m.gold;
        for (const id of me.loadout) if (!(id in me.ammo)) me.ammo[id] = W(id).mag;
        if (shopping || lootPicking) for (const id of me.loadout) me.ammo[id] = W(id).mag;   // 고르는 중엔 다음 라운드에 어차피 가득
        me.weapon = me.loadout[me.slot] || me.loadout[0];
        preloadGuns(me.loadout); updateAmmo();
      } else { const o = others.get(m.id); if (o) { o.w = m.loadout[0]; o.kit = m.kit; o.mesh.userData.setWeapon(o.w); } }
      break;
    case 'gunpick':
      showGunPick(m); break;
    case 'gunpicked':
      gunPicking = false;   // 이어서 'loot' 또는 'shop'이 옴
      break;
    case 'loot':
      showLoot(m); break;
    case 'shop':
      showShop(m); break;
    case 'lootpicked':
      lootPicking = false; shopping = false;
      refreshPause();
      setTimeout(() => { if (phase === 'pick' && !picking && !gunPicking && !lootPicking && !shopping) { ui.cards.innerHTML = ''; ui.slotPick.innerHTML = ''; ui.pickTitle.textContent = '상대가 고르는 중'; ui.pickWait.classList.remove('hidden'); } }, 600);
      break;
    case 'using':
      if (m.id === me.id) { me.usingUntil = nowS() + m.dur; me.usingLen = m.dur; me.usingItem = m.item; me.ads = false; sfx.use(m.item); }
      else { const o = others.get(m.id); if (o) o.usingUntil = nowS() + m.dur; }
      break;
    case 'buff':
      if (m.id === me.id) { me.buffUntil = nowS() + m.dur; me.buffSpeed = m.speed; sfx.used('adren'); feed(`아드레날린: ${m.dur}초 동안 빠르게 + 회복`); }
      break;
    case 'hp':
      if (m.id === me.id) { if (m.hp > me.hp && me.usingItem === 'heal' && nowS() >= me.usingUntil - 0.2) { sfx.used('heal'); me.usingItem = null; } me.hp = m.hp; updateHp(); }
      break;
    case 'ghost':
      if (m.id === me.id) { me.ghostUntil = nowS() + m.dur; sfx.ghost(); feed(`유령 발동: ${m.dur}초 투명`); }
      else { const o = others.get(m.id); if (o) o.ghostUntil = nowS() + m.dur; }
      break;
    case 'reveal': { const o = others.get(m.target); if (o) o.revealUntil = nowS() + m.dur; break; }
    case 'revive':
      if (m.id === me.id) { me.invulnUntil = nowS() + m.dur; sfx.revive(); banner('재생!', 'clear'); }
      else feed(`${nameOf(m.id)} 재생 발동!`);
      break;
    case 'kill': {
      scores = m.scores; updateScore();
      feed(m.self ? `${nameOf(m.victim)} 자기 수류탄에 쓰러짐` : `${nameOf(m.killer)}  [${weaponName(m.w)}${m.head ? ' · 헤드샷' : ''}]  ${nameOf(m.victim)}`);
      recordKillStats(m);
      setTimeout(() => showRoundResult(m), 450);
      if (m.victim === me.id) {
        me.dead = true; me.hp = 0; me.ads = false; updateHp();
        if (gameMode !== 'run') startKillcam(m.killer);
        ui.center.className = ''; ui.center.innerHTML = gameMode === 'run' ? '사망' : `라운드 패배<br><small style="font-size:18px">${nameOf(m.killer)} ${m.scores[m.killer]}점</small>`;
      } else {
        const o = others.get(m.victim);
        // 헤드샷 처치: 머리에서 피가 크게 튐
        if (m.head && m.at) { const hp = new THREE.Vector3(...m.at); blood(hp); blood(hp); sparks(hp, new THREE.Vector3(0, 1, 0), 0xaa1010, 14); }
        if (o) {
          o.dead = true; o.deadT = 0;
          // 쏜 사람 반대쪽으로 쓰러짐
          const fx = Math.sin(o.mesh.rotation.y), fz = Math.cos(o.mesh.rotation.y);
          const tx = (m.from?.[0] ?? me.ent.pos.x) - o.mesh.position.x, tz = (m.from?.[2] ?? me.ent.pos.z) - o.mesh.position.z;
          o.fallSign = (-fx * tx - fz * tz) > 0 ? 1 : -1;
        }
        if (m.killer === me.id) {
          sfx.kill(); killPunch = 1;
          ui.killStamp.className = ''; void ui.killStamp.offsetWidth; ui.killStamp.className = 'show' + (m.head ? ' head' : '');
          // 처치 도장과 가운데 글씨가 같은 자리에 겹쳐서(2026-11-04) 한 곳에만 표시
          ui.killStamp.innerHTML = (m.head ? '헤드샷!' : '처치') + (gameMode === 'run' ? '' : '<small>라운드 승리</small>');
          ui.center.className = ''; ui.center.textContent = '';
          if (gameMode === 'run') setTimeout(() => { if (phase !== 'over') { banner(`STAGE ${m.scores[me.id]} CLEAR`, 'clear'); sfx.fanfare(); } }, 500);
        }
      }
      break;
    }
    case 'respawn':
      if (m.id === me.id) respawnMe(m);
      else {
        const o = others.get(m.id);
        if (o) { o.dead = false; o.mesh.visible = true; o.mesh.rotation.x = 0; o.target.set(...m.pos); o.mesh.position.set(...m.pos); o.yaw = m.yaw; o.mesh.rotation.y = m.yaw; }
      }
      break;
    case 'scores':
      scores = m.scores; updateScore(); break;
    case 'win':
      matchOver = true;
      bumpStat(st => { const k = mode === 'online' ? 'online' : 'bot'; st.games[k].played++; if (m.id === me.id) st.games[k].won++; });
      ui.center.className = '';
      ui.center.innerHTML = (m.id === me.id ? '🏆 승리!' : `패배... ${escapeHtml(m.name)} 승리`) + '<br><small style="font-size:18px">잠시 후 새 경기 (증강 초기화)<br>그만하려면 Esc → 처음 화면으로 나가기</small>';
      ui.roundRes.classList.add('hidden'); clearTimeout(ui.roundRes._t); ui.roundRes._noShow = true;
      if (m.id === me.id) sfx.fanfare(); else sfx.fail();
      break;
    case 'runover':
    case 'runclear': {
      const cleared = m.t === 'runclear' ? m.stage : m.cleared;
      bumpStat(st => { st.games.run.played++; if (m.t === 'runclear') st.games.run.won++; st.games.run.best = Math.max(st.games.run.best, cleared); });
      const prev = bestRun();
      if (cleared > prev) { try { localStorage.setItem('fps_best_run', cleared); } catch {} }
      ui.runEndTitle.textContent = m.t === 'runclear' ? '런 클리어!' : '런 종료';
      ui.runEndText.textContent = (m.t === 'runclear' ? `${RUN.stages}스테이지를 모두 클리어했어요!` : `${m.stage}스테이지에서 쓰러졌어요 · ${cleared}스테이지 클리어`) + (cleared > prev ? ' · 최고 기록 갱신!' : ` · 최고 기록 ${Math.max(prev, cleared)}`);
      ui.runEndAugs.innerHTML = chips(me.augs);
      ui.runEnd.classList.remove('hidden');
      document.exitPointerLock();
      if (m.t === 'runclear') sfx.fanfare(); else sfx.fail();
      showBest();
      break;
    }
  }
}

// ================= 입력 =================
const cvs = renderer.domElement;
// 마우스 잠금(포인터 락)은 이 두 함수로만 다룸.
// 잠금 요청은 클릭/키 입력 직후에만 성공하고, 실패해도 pointerlockchange가 오지 않으므로
// 실패하면 반드시 '클릭해서 계속' 화면을 띄워서 사용자가 다시 잠글 수 있게 함
let lockPending = false, lockedAt = 0;
function refreshPause() {
  const blocking = picking || gunPicking || lootPicking || shopping || !ui.runEnd.classList.contains('hidden');
  ui.pause.classList.toggle('hidden', locked || lockPending || blocking || !me.id);
}
function lockPointer() {
  // 봇전·런은 처음 클릭할 때 경기 시작 (조작 안내를 읽는 동안 맞지 않게)
  if (mode === 'bot' && me.id && !sentReady) { sentReady = true; net({ t: 'ready' }); }
  if (document.pointerLockElement === cvs) return;
  lockPending = true;
  const fail = () => { lockPending = false; refreshPause(); };
  try { const r = cvs.requestPointerLock(); if (r && r.catch) r.catch(fail); } catch { fail(); }
  // 응답이 아예 없는 브라우저 대비
  setTimeout(() => { if (lockPending && !locked) fail(); }, 1500);
}
ui.pause.addEventListener('click', lockPointer);
// 혹시 안내 화면이 안 보여도 게임 화면을 클릭하면 다시 잠금
cvs.addEventListener('click', () => { if (!locked && me.id && !picking && !gunPicking && !lootPicking && !shopping && ui.runEnd.classList.contains('hidden')) lockPointer(); });
document.addEventListener('pointerlockerror', () => { lockPending = false; refreshPause(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === cvs;
  if (locked) lockedAt = performance.now();
  lockPending = false;
  refreshPause();
  if (!locked) {
    ui.pauseText.textContent = mode === 'bot' && sentReady ? '일시정지 (게임 멈춤) · 클릭해서 계속' : '일시정지 · 클릭해서 계속';
    mouseDown = rightDown = false; Object.keys(keys).forEach(k => keys[k] = false);
  }
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousemove', e => {
  // 포인터락이 걸린 직후 한두 번 엉뚱하게 튀는 값만 무시 (빠르게 휙 돌리는 정상 움직임은 그대로 받음)
  if (!locked || (performance.now() - lockedAt < 150 && (Math.abs(e.movementX) > 200 || Math.abs(e.movementY) > 200)) || Math.abs(e.movementX) > 3000) return;
  const sens = 0.0022 * settings.sens * (camera.fov / settings.fov);
  me.yaw -= e.movementX * sens;
  me.pitch = THREE.MathUtils.clamp(me.pitch - e.movementY * sens, -1.5, 1.5);
  swayX += e.movementX * 0.00015; swayY += e.movementY * 0.00015;
});
document.addEventListener('mousedown', e => {
  if (!locked) return;
  if (e.button === 0) { mouseDown = true; firedThisClick = false; }
  if (e.button === 2) rightDown = true;
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) rightDown = false; });
document.addEventListener('wheel', e => { if (locked) switchWeapon(e.deltaY > 0 ? 1 : -1, true); });
document.addEventListener('keydown', e => {
  // 증강 선택: 1/2/3
  if (picking && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
    const i = +e.code.slice(5) - 1, c = ui.cards.children[i];
    if (c) c.click();
    return;
  }
  if (picking && e.code === 'KeyR') { ui.reroll.click(); return; }
  // 총 선택: 1~3 카드, 카드를 고른 뒤엔 1/2 칸, X 패스
  if (gunPicking) {
    const n = /^Digit[1-3]$/.test(e.code) ? +e.code.slice(5) : 0;
    if (e.code === 'KeyX') passGun();
    else if (gunSel && (e.code === 'KeyQ' || e.code === 'KeyE')) chooseSlot(e.code === 'KeyQ' ? 0 : 1);
    else if (n) selectGun(n - 1);
    return;
  }
  // 파밍 카드 / 상점: 숫자로 카드, 부착물을 고른 뒤엔 1/2 칸, X 패스 / Enter 상점 끝
  if (lootPicking || shopping) {
    const n = /^Digit[1-5]$/.test(e.code) ? +e.code.slice(5) : 0;
    const list = shopping ? shopItems : lootOpts;
    if (e.code === 'KeyX' && lootPicking) endLoot({ t: 'loot', pass: true });
    else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && shopping) endShop();
    else if (list[lootSel]?.kind === 'part' && (e.code === 'KeyQ' || e.code === 'KeyE')) lootSlot(e.code === 'KeyQ' ? 0 : 1);
    else if (n) selectLoot(n - 1);
    return;
  }
  if (e.code === 'KeyM' && !e.repeat && e.target.tagName !== 'INPUT') setMuted(!muted);
  const first = !keys[e.code];
  keys[e.code] = true;
  if (!locked) return;
  if (e.code === 'Space') { e.preventDefault(); if (first) tryDoubleJump(); }
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && first) tryDash();
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'KeyC' && first) trySlide();
  if (e.code === 'KeyG' && first) throwNade('frag');
  if (e.code === 'KeyT' && first) throwNade('flash');
  if (first) for (const id in ITEMS) if (e.code === 'Digit' + ITEMS[id].key) useItem(id);
});
// 소모품: 방장이 개수·시간을 판정. 쓰는 중엔 사격·재장전 불가
function useItem(id) {
  if (me.dead || nowS() < me.usingUntil || !(me.kit.items[id] > 0) || !(canAct() || phase === 'countdown')) return;
  if (id === 'heal' && me.hp >= (me.capHp ?? me.maxHp)) { feed('체력이 가득 차 있어요'); return; }
  net({ t: 'use', item: id });
}
document.addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('resize', resize);

const nowS = gameNow;
const canAct = () => phase === 'live' || phase === 'waiting';
function busy() { const t = nowS(); return t < me.reloadUntil || t < me.switchUntil || t < me.usingUntil; }

// G 수류탄 / T 섬광탄: 보는 방향으로 던짐 (라운드마다 1개씩, 방장이 판정)
function throwNade(kind) {
  if (me.dead || !canAct() || !(me.nades[kind] > 0) || nowS() < me.usingUntil || nowS() < me.throwT + 0.6) return;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  me.throwT = nowS();
  net({ t: 'state', p: [me.ent.pos.x, me.ent.pos.y, me.ent.pos.z], yaw: me.yaw, pitch: me.pitch, w: me.weapon, ads: false, air: !me.ent.onGround, cr: +me.crT.toFixed(2), ln: +me.leanT.toFixed(2) });
  net({ t: 'throw', kind, dir: dir.toArray() });
}
// 날아가는 수류탄 (방장과 같은 계산으로 위치를 그림)
const nadeMeshes = new Map();
const nadeGeo = { frag: new THREE.SphereGeometry(0.07, 10, 8), flash: new THREE.CylinderGeometry(0.045, 0.045, 0.15, 10) };
const nadeMat = { frag: new THREE.MeshStandardMaterial({ color: 0x3d4a2e, roughness: 0.6, metalness: 0.3 }), flash: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.6 }) };
function updateNades() {
  const now = nowS();
  for (const [id, n] of nadeMeshes) {
    const t = Math.min(now - n.start, NADE[n.kind].fuse);
    const q = simNade(n.p0, n.v0, t);
    n.mesh.position.set(q[0], q[1], q[2]);
    n.mesh.rotation.x += 0.2; n.mesh.rotation.z += 0.13;
    if (now - n.start > NADE[n.kind].fuse + 1) { scene.remove(n.mesh); nadeMeshes.delete(id); }
  }
}
// 달리다가 C: 미끄러지기 (0.6초, 1.2초마다)
function trySlide() {
  const now = nowS(), sp = Math.hypot(me.ent.vel.x, me.ent.vel.z);
  if (me.dead || !canAct() || !me.ent.onGround || now < me.nextSlide || sp < MOVE.run * 0.8) return;
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  me.slideDir = { f: f || 1, s, yaw: me.yaw }; me.slideUntil = now + 0.6; me.nextSlide = now + 1.2;
  sfx.slide(); shake = Math.max(shake, 0.12);
}
function tryDoubleJump() {
  if (!me.stats.doubleJump || me.ent.onGround || me.doubleUsed || me.dead || !canAct()) return;
  me.doubleUsed = true; me.ent.vel.y = MOVE.jump * me.stats.doubleJump; sfx.jump2();
}
function tryDash() {
  const now = nowS();
  const dbl = now - me.lastShiftTap < 0.3;
  me.lastShiftTap = now;
  if (!dbl || !me.stats.dash || now < me.dashReadyAt || me.dead || !canAct()) return;
  let f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (!f && !s) f = 1;
  me.dashDir = { f, s }; me.dashUntil = now + 0.2; me.dashReadyAt = now + me.stats.dash;
  sfx.dash(); shake = Math.max(shake, 0.15);
}

// 칸(0/1) 교체. relative면 휠 방향
function switchWeapon(slot, relative) {
  if (me.dead) return;
  const n = me.loadout.length;
  if (relative) slot = (me.slot + slot + n) % n;
  if (slot === me.slot || !me.loadout[slot]) return;
  // 재장전 중에 바꾸면 재장전 취소 (탄은 안 채워짐)
  if (nowS() < me.reloadUntil) { me.reloadUntil = 0; me.pendingReload = null; net({ t: 'reloadcancel' }); }
  me.slot = slot; me.weapon = me.loadout[slot];
  me.switchUntil = nowS() + W(me.weapon).swap; me.switchLen = W(me.weapon).swap; me.ads = false; me.boltT = 0; me.burstLeft = 0;
  sfx.swap(); updateAmmo();
  ui.reload.textContent = '';
}

function startReload() {
  const Wp = W(me.weapon);
  if (me.dead || busy() || me.ammo[me.weapon] >= Wp.mag) return;
  me.reloadStart = nowS(); me.reloadUntil = me.reloadStart + Wp.reload; me.ads = false;
  me.pendingReload = me.weapon;
  net({ t: 'reload', w: me.weapon });
  sfx.reload(Wp.reload);
  ui.reload.textContent = '재장전 중...';
}

// 재장전 완료 처리는 매 프레임 확인 (타이머보다 정확)
function finishReload() {
  if (!me.pendingReload || nowS() < me.reloadUntil) return;
  me.ammo[me.pendingReload] = W(me.pendingReload).mag;
  me.pendingReload = null;
  ui.reload.textContent = '';
  updateAmmo();
}

// 현재 탄퍼짐(라디안): 지향사격 기본 + 연사 누적(블룸) + 이동 + 공중. 정조준하면 크게 줄어듦
function curSpread(Wp) {
  const moving = Math.hypot(me.ent.vel.x, me.ent.vel.z);
  const hip = Wp.spread * 1.4 + me.bloom, ads = Wp.adsSpread + me.bloom * 0.3;
  return (THREE.MathUtils.lerp(hip, ads, me.adsT) + moving * (me.adsT > 0.5 ? 0.0015 : 0.004)) * (1 - 0.3 * me.crT) + (me.ent.onGround ? 0 : 0.05) + (nowS() < me.slideUntil ? 0.03 : 0);
}
// 샷건 산탄이 퍼지는 반경(라디안). 정조준하면 30% 모임 (방장 판정과 같은 값)
const pelletRadius = Wp => (Wp.pelletSpread || 0) * (Wp.pelletMul ?? 1) * (1 - 0.3 * me.adsT);

// 노리쇠/펌프 동작 시간
const boltLen = () => { const Wp = W(me.weapon); return Math.min((Wp.cycle === 'pump' ? 0.55 : 0.9) * me.stats.boltMul, Wp.interval * 0.85); };

function tryFire() {
  const bursting = me.burstLeft > 0;
  if ((!mouseDown && !bursting) || me.dead || matchOver || !locked || busy() || !canAct()) { if (bursting && (me.dead || busy())) me.burstLeft = 0; return; }
  const Wp = W(me.weapon), now = nowS();
  if (bursting) { if (now - me.lastFire < Wp.interval) return; }
  else {
    if (!Wp.auto && firedThisClick) return;
    if (now - me.lastFire < (Wp.burst ? Wp.burstGap : Wp.interval)) return;
  }
  if (!(me.ammo[me.weapon] > 0)) { me.burstLeft = 0; firedThisClick = true; me.lastFire = now; sfx.empty(); startReload(); return; }
  me.burstLeft = Wp.burst ? (bursting ? me.burstLeft - 1 : Wp.burst - 1) : 0;
  me.streak = now - me.lastFire < Wp.interval * 2.5 ? me.streak + 1 : 0;
  me.lastFire = now; firedThisClick = true;
  me.ammo[me.weapon]--; updateAmmo();
  rs.shots++; stats.shots++;

  // 퍼짐: 원 안에 고르게 (샷건 산탄은 방장이 이 방향 둘레로 다시 퍼뜨림)
  const spread = curSpread(Wp);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  { const r = spread * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize(), up = new THREE.Vector3().crossVectors(right, dir);
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize(); }
  // 연사할수록 퍼짐이 커짐 (최대 기본의 2.5배). 쉬면 줄어듦
  me.bloom = Math.min(Wp.spread * 2.5, me.bloom + (Wp.bloom ?? Wp.spread * 0.5));
  // 위치를 먼저 보내서 방장이 정확한 위치로 판정하게 함
  net({ t: 'state', p: [me.ent.pos.x, me.ent.pos.y, me.ent.pos.z], yaw: me.yaw, pitch: me.pitch, w: me.weapon, ads: me.ads, air: !me.ent.onGround, cr: +me.crT.toFixed(2), ln: +me.leanT.toFixed(2), sl: nowS() < me.slideUntil });
  net({ t: 'shoot', dir: dir.toArray(), w: me.weapon, ads: me.adsT > 0.7 });

  // 반동: 연사할수록 위로 올라가고 좌우로 흔들리는 패턴
  const k = Math.min(me.streak, 10), cls = Wp.cls;
  me.pitch = Math.min(1.5, me.pitch + Wp.recoil * (me.ads ? 0.6 : 1) * (1 + k * 0.08) * (1 - 0.25 * me.crT));
  // 좌우 반동은 총 종류마다 정해진 무늬(익히면 마우스로 잡을 수 있음) + 약간의 흔들림
  const pat = RECOIL_PAT[cls] || RECOIL_PAT.ar;
  me.yaw -= (pat[me.streak % pat.length] * 0.8 + (Math.random() - 0.5) * 0.15) * Wp.recoil * (me.ads ? 0.6 : 1) * (1 - 0.25 * me.crT);
  recoilKick = 1; shake = Math.max(shake, (SHAKE[cls] ?? 0.2) * (me.ads ? 0.6 : 1));
  camKick += (KICK[cls] ?? 0.015) * (me.ads ? 0.7 : 1); camKickYaw += (Math.random() - 0.5) * (KICK[cls] ?? 0.015) * 0.6;
  firePunch = cls === 'sg' || cls === 'sniper' ? 1 : cls === 'dmr' || cls === 'br' ? 0.5 : 0.25;
  // 총구 화염: 2프레임 이상 확실히 보이게
  const fl = (FLAME[cls] ?? 0.32) * (Wp.quiet ? 0.45 : 1), mt = muzzleTex();
  flameA.material.map = mt; flameA.material.needsUpdate = true;
  flameA.scale.set(fl * 0.55, fl, 1); flameB.scale.set(fl * 0.55, fl, 1);
  flameA.rotation.z = Math.random() * 0.6 - 0.3; flameB.rotation.z = Math.PI / 2 + Math.random() * 0.6 - 0.3;
  flareS.material.map = flareTex(); flareS.scale.setScalar(fl * 0.75); flareS.material.rotation = Math.random() * Math.PI;
  starS.material.map = mt; starS.scale.setScalar(fl * 0.55); starS.material.rotation = Math.random() * Math.PI * 2;
  flashGroup.visible = true; flashUntil = now + 0.06; flashFrames = 3;
  worldFlash.intensity = (cls === 'sg' || cls === 'sniper' ? 80 : 50) * (Wp.quiet ? 0.3 : 1); worldFlash.position.copy(muzzleWorld());
  if (!Wp.auto || Math.random() < 0.35) puff(muzzleWorld(), 0xcfcac0, cls === 'sg' || cls === 'sniper' ? 0.5 : 0.28, 0.5);
  sfx.gun(me.weapon, false, Wp.quiet);
  if (Wp.cycle) { sfx.bolt(boltLen()); me.boltT = now; setTimeout(ejectShell, boltLen() * 600); }
  else ejectShell();
  if (me.ammo[me.weapon] === 0) setTimeout(startReload, Wp.cycle ? 900 : 250);
}

// ================= 프레임 갱신 =================
function updateMe(dt) {
  if (me.dead) return;
  finishReload();
  const now = nowS();
  const bolting = W(me.weapon).cycle === 'bolt' && me.boltT && now - me.boltT < boltLen();
  const act = canAct();
  me.ads = rightDown && !busy() && !bolting && act;
  const sliding = now < me.slideUntil && me.slideDir;
  // 앉기(C 누르는 동안) / 미끄러지기 중엔 낮은 자세
  const crouchWant = act && (keys.KeyC || sliding) ? 1 : 0;
  me.crT = THREE.MathUtils.damp(me.crT, crouchWant, 12, dt);
  // 기울이기 Q/E: 달리기·미끄러지기 중엔 안 됨, 벽이 있으면 그만큼만
  let leanWant = act && !sliding ? (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0) : 0;
  if (leanWant) { const [rx, rz] = rightOf(me.yaw), ey = me.ent.pos.y + eyeHeight(me.crT); if (insideSolid(me.ent.pos.x + rx * leanWant * POSE.leanEye, ey, me.ent.pos.z + rz * leanWant * POSE.leanEye)) leanWant *= 0.3; }
  me.leanT = THREE.MathUtils.damp(me.leanT, leanWant, 12, dt);
  const running = (keys.ShiftLeft || keys.ShiftRight) && !me.ads && keys.KeyW && me.crT < 0.3 && Math.abs(me.leanT) < 0.2;
  let input = {
    f: act ? (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) : 0,
    s: act ? (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) : 0,
    yaw: me.yaw, jump: act && !!keys.Space,
    speed: (me.ads ? MOVE.ads : running ? MOVE.run : MOVE.walk) * (1 - 0.5 * me.crT) * me.stats.speedMul * W(me.weapon).move * (now < me.buffUntil ? me.buffSpeed : 1) * (now < me.usingUntil ? 0.6 : 1),
  };
  if (sliding) input = { ...input, f: me.slideDir.f, s: me.slideDir.s, yaw: me.slideDir.yaw, speed: 4 + 9 * (me.slideUntil - now) / 0.6, accel: 20, jump: false };
  if (now < me.dashUntil && me.dashDir) input = { ...input, f: me.dashDir.f, s: me.dashDir.s, speed: 24, accel: 40, jump: false };
  const wasAir = !me.ent.onGround;
  const fallV = me.ent.vel.y;
  stepMovement(me.ent, input, dt);
  if (!wasAir && !me.ent.onGround && me.ent.vel.y > 0) sfx.jump();
  if (me.ent.onGround) { if (wasAir) { me.doubleUsed = false; if (fallV < -4) sfx.land(); } }
  const sp = Math.hypot(me.ent.vel.x, me.ent.vel.z);
  if (me.ent.onGround && sp > 1) { stepAcc += dt * sp; if (stepAcc > 2.4) { stepAcc = 0; sfx.step(); } }
  if (!bolting || W(me.weapon).cycle !== 'bolt') tryFire();
}

function updateHud() {
  const now = nowS();
  // 카운트다운 숫자
  if (phase === 'countdown') {
    const n = Math.ceil(phaseEnd - now);
    if (n !== lastCount && n > 0) { lastCount = n; ui.center.className = ''; void ui.center.offsetWidth; ui.center.className = 'count'; ui.center.textContent = n; sfx.tick(); }
  }
  if (phase === 'pick' || !ui.pick.classList.contains('hidden')) {
    ui.pickTimer.parentElement.style.visibility = pickDur > 0 ? 'visible' : 'hidden';
    if (pickDur > 0) ui.pickTimer.style.width = Math.max(0, 1 - (now - pickStart) / pickDur) * 100 + '%';
  }
  // 증강 쿨타임 표시
  const parts = [];
  if (me.stats.dash) parts.push(now >= me.dashReadyAt ? '<span class="ready">대시 준비</span>' : `대시 ${(me.dashReadyAt - now).toFixed(1)}s`);
  if (me.stats.doubleJump) parts.push(me.doubleUsed ? '이단 점프 사용' : '<span class="ready">이단 점프</span>');
  if (me.stats.revive) parts.push('재생 대기');
  if (now < me.buffUntil) parts.push(`<span class="ready">아드레날린 ${(me.buffUntil - now).toFixed(0)}s</span>`);
  const html = parts.join('');
  if (ui.cool.innerHTML !== html) ui.cool.innerHTML = html;
  // 소모품 사용 진행 막대
  const using = now < me.usingUntil && !me.dead;
  ui.useBar.classList.toggle('hidden', !using);
  if (using) { ui.useBar.firstElementChild.textContent = `${ITEMS[me.usingItem]?.name ?? ''} 사용 중`; ui.useBar.lastElementChild.firstElementChild.style.width = (1 - (me.usingUntil - now) / me.usingLen) * 100 + '%'; }
}

function updateView(dt) {
  const Wp = W(me.weapon), now = nowS();
  me.adsT = THREE.MathUtils.damp(me.adsT, me.ads ? 1 : 0, 14 * me.stats.adsMul * Wp.ads * Wp.adsMul, dt);
  const gun = vGun(me.weapon), cls = Wp.cls;
  applySkin(gun);
  const sniperScoped = Wp.optic === 'scope' && me.adsT > 0.85;

  // 카메라
  shake = Math.max(0, shake - dt * 2.5);
  camKick = THREE.MathUtils.damp(camKick, 0, 16, dt); camKickYaw = THREE.MathUtils.damp(camKickYaw, 0, 16, dt);
  firePunch = Math.max(0, firePunch - dt * 9);
  me.bloom = Math.max(0, me.bloom - dt * (Wp.spread * 3 + 0.01));
  if (flashGroup.visible && now >= flashUntil && flashFrames <= 0) { flashGroup.visible = false; worldFlash.intensity = 0; }
  flashFrames--;
  killPunch = Math.max(0, killPunch - dt * 4);
  hurtPulse = Math.max(0, hurtPulse - dt * 1.5);
  const sx = (Math.random() - 0.5) * shake * 0.03, sy = (Math.random() - 0.5) * shake * 0.03;
  { const [rx, rz] = rightOf(me.yaw), lo = me.dead ? 0 : me.leanT * POSE.leanEye;
    camera.position.set(me.ent.pos.x + rx * lo, me.ent.pos.y + (me.dead ? 0.35 : eyeHeight(me.crT)), me.ent.pos.z + rz * lo); }
  // 스코프 흔들림: 저격총 정조준 중 천천히 8자로 흔들림 (조준경 부착물이 바뀐 효과로 줄여 줌). 실제 사격 방향에도 들어감
  const sway = sniperScoped ? 0.0022 * Wp.swayMul : 0, st = now * 1.1;
  camera.rotation.set(me.pitch + sy + camKick + Math.sin(st * 2) * sway * 0.5, me.yaw + sx + camKickYaw + Math.sin(st) * sway, me.dead ? 0.5 : -me.leanT * 0.12 - (nowS() < me.slideUntil ? 0.05 : 0));
  const dashing = now < me.dashUntil;
  const fov = THREE.MathUtils.lerp(settings.fov, Wp.fov * Wp.fovMul, me.adsT) + killPunch * 6 + (dashing ? 8 : 0) + firePunch * (me.adsT > 0.5 ? 0.6 : 1.8);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  // 화면 테두리: 체력 낮음 + 맞을 때 번쩍
  const r = Math.max(0, me.hp) / me.maxHp;
  vignette.uniforms.red.value = Math.min(1, (r < 0.35 && !me.dead ? (0.35 - r) * 1.6 : 0) + hurtPulse * 0.7);
  vignette.uniforms.amount.value = 0.35 + (now < me.ghostUntil ? 0.5 : 0);

  // 1인칭 총 위치 (흔들림, 반동, 재장전/교체 애니메이션)
  const sp = Math.hypot(me.ent.vel.x, me.ent.vel.z);
  if (me.ent.onGround && sp > 0.5) bob += dt * sp * 1.5;
  recoilKick = Math.max(0, recoilKick - dt * (heavy(me.weapon) ? 4 : cls === 'pistol' ? 10 : 14));
  swayX = THREE.MathUtils.damp(swayX, 0, 8, dt); swayY = THREE.MathUtils.damp(swayY, 0, 8, dt);
  const bobAmt = (1 - me.adsT * 0.85) * Math.min(1, sp / 6);
  const pos = hipFor(cls).clone().lerp(adsFor(gun), me.adsT);
  pos.x += Math.cos(bob) * 0.012 * bobAmt - swayX;
  pos.y += Math.abs(Math.sin(bob)) * 0.016 * bobAmt + swayY;
  pos.z += recoilKick * (heavy(me.weapon) ? 0.12 : cls === 'pistol' ? 0.06 : 0.045);
  let rotX = recoilKick * (heavy(me.weapon) ? 0.18 : cls === 'pistol' ? 0.14 : 0.06), rotZ = 0, rotY = 0;
  gun.userData.slideKick(Math.min(1, recoilKick * 1.5));
  // 가늠자로 조준하는 총은 정조준할 때 개머리판이 시야를 가려서 접음
  if (gun.userData.stock && !gun.userData.optic) gun.userData.stock.scale.setScalar(me.adsT > 0.5 ? 1e-4 : 1);
  // 재장전: 총을 기울이고 왼손이 탄창을 뺐다 끼움
  if (now < me.reloadUntil) {
    const t = (now - me.reloadStart) / Wp.reload, e = Math.sin(Math.min(1, t) * Math.PI);
    pos.y -= 0.08 * e; rotZ = 0.6 * e; rotX += 0.25 * e;
    gun.userData.magDrop(t > 0.2 && t < 0.7 ? 0.25 : 0);
  } else gun.userData.magDrop(0);
  // 교체: 아래로 내렸다 올림
  if (now < me.switchUntil) { const t = 1 - (me.switchUntil - now) / (me.switchLen || 0.45); pos.y -= 0.35 * (1 - t); rotX -= 0.5 * (1 - t); }
  // 노리쇠 당기기 / 펌프질
  const bl = boltLen();
  if (Wp.cycle && me.boltT && now - me.boltT < bl) {
    const t = (now - me.boltT) / bl, e = Math.sin(t * Math.PI);
    if (Wp.cycle === 'bolt') { rotZ += 0.35 * e; pos.y -= 0.03 * e; } else { pos.z += 0.03 * e; rotX += 0.05 * e; }
    gun.userData.boltPull(e);
  } else gun.userData.boltPull(0);
  // 달리기 자세
  if ((keys.ShiftLeft || keys.ShiftRight) && keys.KeyW && !me.ads && me.ent.onGround) { rotY += 0.5; rotX -= 0.15; pos.x -= 0.05; pos.y -= 0.03; }

  viewRoot.position.copy(pos);
  viewRoot.rotation.set(rotX, rotY, rotZ);
  for (const id in vGuns) vGuns[id].visible = id === me.weapon;
  viewRoot.visible = !me.dead && !sniperScoped && !testHideView;
  flashGroup.position.copy(gun.userData.muzzle.position).applyEuler(viewRoot.rotation).add(viewRoot.position);
  flashGroup.rotation.copy(viewRoot.rotation);
  // 레드도트: 진짜 도트사이트처럼 빨간 점이 항상 실제 조준점(화면 가운데)에 보이게, 반동·흔들림만큼 창 안에서 보정
  const opt = gun.userData.optic;
  if (opt?.userData.dot) {
    const D = opt.userData.dot, od = opt.userData;
    D.position.copy(od.home);
    if (me.adsT > 0.6) {
      viewRoot.updateMatrixWorld(true);
      const wz = D.getWorldPosition(new THREE.Vector3()).z;
      const t = opt.worldToLocal(new THREE.Vector3(0, 0, wz));
      D.position.set(THREE.MathUtils.clamp(t.x, -od.W / 2 + 0.004, od.W / 2 - 0.004), THREE.MathUtils.clamp(t.y, 0.006, od.H - 0.004), od.home.z);
    }
  }

  ui.scope.classList.toggle('hidden', !sniperScoped || me.dead);
  // 조준점: 실제 탄퍼짐 각도를 화면 픽셀로 바꿔서 그만큼 벌어짐. 샷건은 산탄 범위를 원으로 표시
  const pxPerRad = (innerHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const isSg = !!Wp.pellets;
  ui.cross.classList.toggle('sg', isSg);
  ui.cross.style.opacity = me.dead || sniperScoped ? 0 : isSg ? (me.adsT > 0.5 && Wp.optic ? 0.35 : 1) : me.adsT > 0.5 ? 0 : 1;
  const sprPx = Math.tan(curSpread(Wp)) * pxPerRad;
  if (isSg) ui.cross.style.setProperty('--r', Math.round(Math.tan(pelletRadius(Wp) + curSpread(Wp)) * pxPerRad + recoilKick * 6) + 'px');
  ui.cross.style.setProperty('--gap', Math.round(Math.max(4, sprPx) + recoilKick * 6) + 'px');
  if (now >= me.reloadUntil && me.ammo[me.weapon] === 0) ui.reload.textContent = 'R 키로 재장전';
}

// 상대 모델: 이동 방향에 맞춘 걸음(무릎 포함), 상체 흔들림, 맞을 때 움찔, 쓰러짐
function updateOthers(dt) {
  const k = 1 - Math.exp(-15 * dt), now = nowS();
  for (const o of others.values()) {
    const m = o.mesh, ud = m.userData;
    // 첨단 시야(벽 너머 실루엣) / 유령(투명)
    const xray = now < o.revealUntil && !o.dead;
    if (xray !== o.xray) { setXray(m, xray); o.xray = xray; }
    if (ud.human) { updateHuman(o, dt, k, now); continue; }
    if (o.dead) {
      o.deadT += dt;
      m.rotation.x = o.fallSign * Math.min(Math.PI / 2, o.deadT * o.deadT * 9);
      ud.legL.rotation.x = ud.legR.rotation.x = 0;
      if (o.deadT > 2.5) m.visible = false;
      continue;
    }
    m.visible = now >= o.ghostUntil;
    const prev = m.position.clone();
    m.position.lerp(o.target, k);
    const vel = m.position.clone().sub(prev).divideScalar(Math.max(dt, 1e-4)); vel.y = 0;
    o.vel.lerp(vel, 1 - Math.exp(-10 * dt));
    o.speed = o.vel.length();
    let dy = o.yaw - m.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * k;
    ud.aim.rotation.x = o.pitch;
    ud.head.rotation.x = o.pitch * 0.5;

    // 몸 기준 앞/옆 이동 성분
    const yaw = m.rotation.y;
    const fwd = -(o.vel.x * Math.sin(yaw) + o.vel.z * Math.cos(yaw));
    const side = o.vel.x * Math.cos(yaw) - o.vel.z * Math.sin(yaw);
    const sp = o.speed, moving = Math.min(1, sp / 1.5);
    ud.walk += dt * (4 + sp * 1.3) * moving;
    const amp = Math.min(0.8, 0.25 + sp * 0.08) * moving;
    const fN = sp > 0.1 ? fwd / sp : 0, sN = sp > 0.1 ? side / sp : 0;
    const ph = ud.walk;
    for (const [leg, off] of [[ud.legL, 0], [ud.legR, Math.PI]]) {
      const s = Math.sin(ph + off);
      if (o.air) {
        leg.rotation.set(0.5, 0, 0); leg.userData.knee.rotation.x = -0.9;
      } else {
        leg.rotation.x = s * amp * fN;
        leg.rotation.z = s * amp * 0.45 * sN;
        // 다리가 뒤로 갔다가 앞으로 나올 때 무릎을 굽힘
        leg.userData.knee.rotation.x = -Math.max(0, Math.cos(ph + off)) * amp * 1.3 - 0.05 * moving;
      }
    }
    // 상체: 걸음마다 위아래, 맞으면 뒤로 젖힘
    o.flinch = Math.max(0, o.flinch - dt * 6);
    ud.upper.position.y = Math.abs(Math.sin(ph)) * 0.045 * moving - (o.air ? 0 : 0.02 * moving);
    ud.upper.rotation.z = Math.sin(ph) * 0.04 * moving;
    ud.torso.rotation.x = -0.25 * o.flinch + fN * 0.08 * moving;
    if (o.flinchHead) ud.head.rotation.x -= 0.6 * o.flinch;
  }
}

function updateHuman(o, dt, k, now) {
  const m = o.mesh, h = m.userData.human;
  if (o.dead) {
    o.deadT += dt;
    h.deathFlip = o.fallSign < 0; // 뒤에서 맞으면 앞으로 쓰러짐
    h.update(dt, { dead: true });
    if (o.deadT > 3) m.visible = false;
    return;
  }
  m.visible = now >= o.ghostUntil;
  const prev = m.position.clone();
  m.position.lerp(o.target, k);
  const vel = m.position.clone().sub(prev).divideScalar(Math.max(dt, 1e-4)); vel.y = 0;
  o.vel.lerp(vel, 1 - Math.exp(-10 * dt));
  o.speed = o.vel.length();
  let dy = o.yaw - m.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  m.rotation.y += dy * k;
  const yaw = m.rotation.y;
  const fwd = -(o.vel.x * Math.sin(yaw) + o.vel.z * Math.cos(yaw));
  const side = o.vel.x * Math.cos(yaw) - o.vel.z * Math.sin(yaw);
  o.flinch = Math.max(0, o.flinch - dt * 6);
  h.update(dt, { speed: o.speed, fN: fwd, sN: side, air: o.air, pitch: o.pitch, flinch: o.flinch, flinchHead: o.flinchHead, dead: false, crouch: o.cr || 0, lean: o.ln || 0 });
}

// ================= 킬캠 =================
// 최근 3초 동안 나와 상대의 위치·방향을 기록해 두었다가, 내가 죽으면 상대 눈으로 마지막 2.2초를 다시 보여 줌
const hist = [];
let killcam = null, selfMesh = null;
function recordHist() {
  if (killcam) return;
  const t = nowS(), os = {};
  for (const [id, o] of others) os[id] = [o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, o.mesh.rotation.y, o.pitch, o.w];
  hist.push({ t, me: [me.ent.pos.x, me.ent.pos.y, me.ent.pos.z, me.yaw, me.weapon], os });
  while (hist.length && t - hist[0].t > 3) hist.shift();
}
function sampleHist(t) {
  let i = hist.length - 1;
  while (i > 0 && hist[i].t > t) i--;
  return hist[i];
}
function startKillcam(killer) {
  if (!others.has(killer) || hist.length < 2) return;
  const end = hist[hist.length - 1].t;
  killcam = { killer, t0: Math.max(hist[0].t, end - 2.2), end, start: nowS() + 0.55, lastPos: null };
}
function stopKillcam() {
  if (!killcam) return;
  killcam = null;
  if (selfMesh) selfMesh.visible = false;
  ui.killcam.classList.add('hidden');
}
function updateKillcam(dt) {
  if (!killcam) return;
  const now = nowS();
  if (now < killcam.start) return;
  const t = Math.min(killcam.end, killcam.t0 + (now - killcam.start));
  const h = sampleHist(t), k = h.os[killcam.killer];
  if (!k || now - killcam.start > (killcam.end - killcam.t0) + 1.4) return stopKillcam();
  // 상대 눈 위치에서 상대가 보던 방향으로
  camera.position.set(k[0], k[1] + PLAYER.eye, k[2]);
  camera.rotation.set(k[4], k[3], 0);
  if (Math.abs(camera.fov - settings.fov) > 0.01) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
  const ko = others.get(killcam.killer); if (ko) ko.mesh.visible = false;
  // 내 몸 (킬캠 때만 보임)
  if (!selfMesh) { selfMesh = makeOtherMesh(); scene.add(selfMesh); }
  const ud = selfMesh.userData;
  selfMesh.visible = true;
  ud.setWeapon(h.me[4]);
  const p = new THREE.Vector3(h.me[0], h.me[1], h.me[2]);
  const sp = killcam.lastPos ? p.distanceTo(killcam.lastPos) / Math.max(dt, 1e-3) : 0;
  killcam.lastPos = p.clone();
  selfMesh.position.copy(p); selfMesh.rotation.set(0, h.me[3], 0);
  const dead = t >= killcam.end - 0.01;
  if (ud.human) ud.human.update(dt, { speed: dead ? 0 : sp, fN: sp, sN: 0, air: false, pitch: 0, flinch: 0, flinchHead: false, dead });
  else if (dead) selfMesh.rotation.x = Math.min(Math.PI / 2, selfMesh.rotation.x + dt * 4);
  ui.killcam.classList.remove('hidden');
  ui.killcam.innerHTML = `<b>킬캠</b> ${escapeHtml(nameOf(killcam.killer))}의 시점`;
}

// ================= 라운드 결과 · 전적 =================
let rs = null;
function resetRoundStats() { rs = { shots: 0, hits: 0, heads: 0, dmg: 0, taken: 0 }; }
resetRoundStats();
const STAT0 = () => ({ games: { bot: { played: 0, won: 0 }, online: { played: 0, won: 0 }, run: { played: 0, won: 0, best: 0 } }, kills: 0, deaths: 0, headKills: 0, shots: 0, hits: 0, heads: 0, dmg: 0, guns: {}, rounds: 0, roundsWon: 0 });
const stats = (() => { try { const v = JSON.parse(localStorage.getItem('fps_stats')); if (v && v.games) return Object.assign(STAT0(), v); } catch {} return STAT0(); })();
function saveStats() { try { localStorage.setItem('fps_stats', JSON.stringify(stats)); } catch {} }
function bumpStat(fn) { fn(stats); saveStats(); checkAch(); }
function recordKillStats(m) {
  stats.rounds++;
  if (m.killer === me.id && !m.self) {
    stats.kills++; stats.roundsWon++; if (m.head) stats.headKills++; stats.guns[m.w] = (stats.guns[m.w] || 0) + 1;
    if (m.w === 'nade') stats.nadeKills = (stats.nadeKills || 0) + 1;
    if (rs.taken === 0) stats.flawless = (stats.flawless || 0) + 1;
    if (gameMode === 'run') stats.runStage = Math.max(stats.runStage || 0, m.scores[me.id] || 0);
  }
  if (m.victim === me.id) stats.deaths++;
  saveStats(); checkAch();
}
function showRoundResult(m) {
  if (ui.roundRes._noShow) { ui.roundRes._noShow = false; return; }
  const won = m.killer === me.id;
  const dist = m.from ? Math.round(Math.hypot(m.from[0] - (won ? (others.get(m.victim)?.mesh.position.x ?? 0) : me.ent.pos.x), m.from[2] - (won ? (others.get(m.victim)?.mesh.position.z ?? 0) : me.ent.pos.z))) : null;
  const acc = rs.shots ? Math.round(rs.hits / rs.shots * 100) : 0;
  ui.roundRes.innerHTML = `<div class="rr-title ${won ? 'win' : 'lose'}">${won ? '라운드 승리' : '라운드 패배'}</div>`
    + `<div class="rr-grid"><span>명중</span><b>${rs.hits} / ${rs.shots} (${acc}%)</b><span>헤드샷</span><b>${rs.heads}</b>`
    + `<span>준 피해</span><b>${Math.round(rs.dmg)}</b><span>받은 피해</span><b>${Math.round(rs.taken)}</b>`
    + `<span>결정타</span><b>${escapeHtml(weaponName(m.w))}${m.head ? ' · 헤드샷' : ''}${dist !== null ? ` · ${dist}m` : ''}</b></div>`;
  ui.roundRes.classList.remove('hidden');
  clearTimeout(ui.roundRes._t); ui.roundRes._t = setTimeout(() => ui.roundRes.classList.add('hidden'), (RULES.roundEndTime - 0.5) * 1000);
}
// 로비 전적 화면
function showStats() {
  const s = stats, g = s.games, pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '-';
  const fav = Object.entries(s.guns).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => `${escapeHtml(weaponName(id) || id)} ${n}킬`).join(', ') || '-';
  $('statsBody').innerHTML = `<div class="rr-grid">`
    + `<span>봇전</span><b>${g.bot.won}승 ${g.bot.played - g.bot.won}패</b>`
    + `<span>온라인</span><b>${g.online.won}승 ${g.online.played - g.online.won}패</b>`
    + `<span>런</span><b>${g.run.played}회 · 클리어 ${g.run.won}회 · 최고 ${Math.max(g.run.best, bestRun())}스테이지</b>`
    + `<span>킬 / 데스</span><b>${s.kills} / ${s.deaths} (K/D ${s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills})</b>`
    + `<span>라운드 승률</span><b>${pct(s.roundsWon, s.rounds)} (${s.roundsWon}/${s.rounds})</b>`
    + `<span>명중률</span><b>${pct(s.hits, s.shots)} (${s.hits}/${s.shots})</b>`
    + `<span>헤드샷 킬</span><b>${s.headKills} (${pct(s.headKills, s.kills)})</b>`
    + `<span>준 피해 합계</span><b>${Math.round(s.dmg)}</b>`
    + `<span>많이 쓴 총</span><b>${fav}</b></div>`;
  $('stats').classList.remove('hidden');
}
$('statsBtn').onclick = showStats;
$('statsClose').onclick = () => $('stats').classList.add('hidden');
$('statsReset').onclick = () => { if (confirm('전적을 모두 지울까요?')) { Object.assign(stats, STAT0()); saveStats(); showStats(); } };

// ================= 업적 · 해금 (총 스킨, 조준점 색) =================
const ACH = [
  { id: 'first_win', name: '첫 승리', desc: '봇전이나 온라인에서 경기 승리', done: s => s.games.bot.won + s.games.online.won >= 1, prog: s => [s.games.bot.won + s.games.online.won, 1], unlock: 'skin:desert' },
  { id: 'run5', name: '절반 돌파', desc: '로그라이크 런 5스테이지 클리어', done: s => Math.max(s.runStage || 0, s.games.run.best) >= 5, prog: s => [Math.max(s.runStage || 0, s.games.run.best), 5], unlock: 'skin:forest' },
  { id: 'run_clear', name: '런 정복', desc: '로그라이크 런 10스테이지 모두 클리어', done: s => s.games.run.won >= 1, prog: s => [s.games.run.won, 1], unlock: 'skin:gold' },
  { id: 'heads20', name: '명사수', desc: '헤드샷으로 20번 처치', done: s => s.headKills >= 20, prog: s => [s.headKills, 20], unlock: 'skin:arctic' },
  { id: 'nade3', name: '폭탄 전문가', desc: '수류탄으로 3번 처치', done: s => (s.nadeKills || 0) >= 3, prog: s => [s.nadeKills || 0, 3], unlock: 'skin:dragon' },
  { id: 'flawless', name: '무결점', desc: '피해를 하나도 안 받고 라운드 승리', done: s => (s.flawless || 0) >= 1, prog: s => [s.flawless || 0, 1], unlock: 'xc:sky' },
  { id: 'kills50', name: '베테랑', desc: '모두 합쳐 50번 처치', done: s => s.kills >= 50, prog: s => [s.kills, 50], unlock: 'xc:pink' },
];
const SKINS = {
  base: { name: '기본', tint: null },
  desert: { name: '사막', tint: 0xc2a46e, ach: 'first_win' },
  forest: { name: '숲', tint: 0x55703c, ach: 'run5' },
  arctic: { name: '북극', tint: 0xdfe5ea, ach: 'heads20' },
  dragon: { name: '붉은 용', tint: 0x9a1f1f, ach: 'nade3' },
  gold: { name: '황금', tint: 0xd8a51a, metal: true, ach: 'run_clear' },
};
const XCOLORS = { white: ['흰색', '#ffffff'], green: ['초록', '#4dff88'], yellow: ['노랑', '#ffe14d'], sky: ['하늘', '#4dd2ff', 'flawless'], pink: ['분홍', '#ff5ad1', 'kills50'] };
const XSTYLES = { cross: '십자', dot: '점', both: '십자 + 점' };
const achDone = (() => { try { return new Set(JSON.parse(localStorage.getItem('fps_ach') || '[]')); } catch { return new Set(); } })();
const look = (() => { try { return Object.assign({ skin: 'base', xc: 'white', xs: 'cross' }, JSON.parse(localStorage.getItem('fps_look') || '{}')); } catch { return { skin: 'base', xc: 'white', xs: 'cross' }; } })();
const unlocked = ach => !ach || achDone.has(ach);
function checkAch() {
  for (const a of ACH) {
    if (achDone.has(a.id) || !a.done(stats)) continue;
    achDone.add(a.id);
    const [kind, key] = a.unlock.split(':');
    toast(`업적 달성: <b>${a.name}</b><br><small>해금: ${kind === 'skin' ? SKINS[key].name + ' 총 스킨' : XCOLORS[key][0] + ' 조준점'}</small>`);
  }
  try { localStorage.setItem('fps_ach', JSON.stringify([...achDone])); } catch {}
}
function toast(html) {
  const d = document.createElement('div'); d.className = 'toast'; d.innerHTML = html;
  document.body.appendChild(d); sfx.pick?.('gold');
  setTimeout(() => d.remove(), 4200);
}
function saveLook() { try { localStorage.setItem('fps_look', JSON.stringify(look)); } catch {} applyCrosshair(); }
function applyCrosshair() {
  ui.cross.style.setProperty('--xc', XCOLORS[look.xc]?.[1] || '#fff');
  ui.cross.dataset.style = look.xs;
}
// 1인칭 총 스킨: 총 모델이 늦게 로드되므로 메쉬 수가 바뀌면 다시 칠함
const skinMats = new Map();
function skinMat(base, sk) {
  const key = base.uuid + sk;
  if (!skinMats.has(key)) {
    const m = base.clone(), S = SKINS[sk];
    m.color = base.color.clone().lerp(new THREE.Color(S.tint), 0.65);
    if (S.metal) { m.metalness = 0.9; m.roughness = 0.28; }
    skinMats.set(key, m);
  }
  return skinMats.get(key);
}
function applySkin(gun) {
  let n = 0; gun.traverse(o => { if (o.isMesh) n++; });
  const sig = look.skin + ':' + n;
  if (gun.userData.skinSig === sig) return;
  gun.userData.skinSig = sig;
  const opt = gun.userData.optic;
  gun.traverse(o => {
    if (!o.isMesh || !o.material?.isMeshStandardMaterial) return;
    let p = o; while (p && p !== gun) { if (p === opt) return; p = p.parent; }   // 조준경은 그대로
    if (!o.userData.baseMat) o.userData.baseMat = o.material;
    o.material = look.skin === 'base' || !SKINS[look.skin]?.tint ? o.userData.baseMat : skinMat(o.userData.baseMat, look.skin);
  });
}
// 꾸미기 · 업적 화면
function showCustom() {
  const box = $('customBody');
  const btn = (on, locked, label, data, sub = '') => `<button type="button" class="opt${on ? ' on' : ''}${locked ? ' locked' : ''}" ${data} ${locked ? 'disabled' : ''}>${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
  const achName = id => ACH.find(a => a.id === id)?.name;
  box.innerHTML = `<h3>총 스킨</h3><div class="opts">${Object.entries(SKINS).map(([k, v]) => btn(look.skin === k, !unlocked(v.ach), `<i class="sw" style="background:${v.tint ? '#' + v.tint.toString(16).padStart(6, '0') : '#2a2c30'}"></i>${v.name}`, `data-skin="${k}"`, unlocked(v.ach) ? '' : '🔒 ' + achName(v.ach))).join('')}</div>`
    + `<h3>조준점 색</h3><div class="opts">${Object.entries(XCOLORS).map(([k, v]) => btn(look.xc === k, !unlocked(v[2]), `<i class="sw" style="background:${v[1]}"></i>${v[0]}`, `data-xc="${k}"`, unlocked(v[2]) ? '' : '🔒 ' + achName(v[2]))).join('')}</div>`
    + `<h3>조준점 모양</h3><div class="opts">${Object.entries(XSTYLES).map(([k, v]) => btn(look.xs === k, false, v, `data-xs="${k}"`)).join('')}</div>`
    + `<h3>업적</h3><div class="achs">${ACH.map(a => { const [c, t] = a.prog(stats), ok = achDone.has(a.id); return `<div class="ach${ok ? ' ok' : ''}"><b>${ok ? '✓ ' : ''}${a.name}</b><span>${a.desc}</span><em>${ok ? '완료' : `${Math.min(c, t)} / ${t}`}</em></div>`; }).join('')}</div>`;
  box.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { look.skin = b.dataset.skin; saveLook(); showCustom(); });
  box.querySelectorAll('[data-xc]').forEach(b => b.onclick = () => { look.xc = b.dataset.xc; saveLook(); showCustom(); });
  box.querySelectorAll('[data-xs]').forEach(b => b.onclick = () => { look.xs = b.dataset.xs; saveLook(); showCustom(); });
  $('custom').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
document.querySelectorAll('.customBtn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); showCustom(); }));
$('customClose').addEventListener('click', e => { e.stopPropagation(); $('custom').classList.add('hidden'); });
$('custom').addEventListener('click', e => e.stopPropagation());
// 잠금을 풀어 둔 스킨이 나중에 잠기면(업적 기록을 지운 경우) 기본으로
if (!unlocked(SKINS[look.skin]?.ach)) look.skin = 'base';
if (!unlocked(XCOLORS[look.xc]?.[2])) look.xc = 'white';
applyCrosshair();

let testHideView = false; // 테스트용
const clock = new THREE.Clock();
let sendAcc = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  // 봇전·런: 일시정지 화면(Esc)이 떠 있으면 게임 시간을 멈춤 (2026-11-04: 멈춘 사이 봇이 쏘던 문제)
  const pauseNow = mode === 'bot' && !!me.id && sentReady && !locked && !(picking || gunPicking || lootPicking || shopping) && phase !== 'over' && !matchOver;
  if (pauseNow !== isPaused()) { pauseClock(pauseNow); hostGame?.setPaused(pauseNow); }
  if (me.id && !pauseNow) {
    updateMe(dt);
    if (bot) bot.update(dt);
    updateView(dt);
    updateHud();
    sendAcc += dt;
    if (sendAcc > 0.05 && !me.dead) {
      sendAcc = 0;
      net({ t: 'state', p: [me.ent.pos.x, me.ent.pos.y, me.ent.pos.z], yaw: me.yaw, pitch: me.pitch, w: me.weapon, ads: me.ads, air: !me.ent.onGround, cr: +me.crT.toFixed(2), ln: +me.leanT.toFixed(2), sl: nowS() < me.slideUntil });
    }
  } else if (me.id) {
    updateView(0);   // 멈춘 동안에도 화면은 그대로 그림
  } else {
    // 로비 배경: 천천히 도는 카메라
    const t = performance.now() * 0.00005;
    camera.position.set(Math.sin(t) * 26, 9, Math.cos(t) * 26); camera.lookAt(0, 1, 0);
    viewRoot.visible = false;
  }
  updateOthers(dt);
  if (me.id) { recordHist(); updateKillcam(dt); }
  updateNades();
  { const b = Math.max(0, Math.min(1, (me.blindUntil - nowS()) / me.blindLen * 1.5)); if (ui.blind._o !== b) { ui.blind.style.opacity = b; ui.blind._o = b; } }
  updateEffects(dt);
  updateShells(dt);
  composer.render();
  requestAnimationFrame(loop);
}

updateAmmo();
loop();

// 테스트용 핸들
setMuted(muted);
window.__fps = { me, others, stats, look, achDone, checkAch, showCustom, get killcam() { return killcam; }, histLen: () => hist.length, camPos: () => [camera.position.toArray().map(v => +v.toFixed(2)), camera.rotation.toArray().slice(0, 3).map(v => +v.toFixed(2)), camera.rotation.order, hist.slice(-2).map(h => JSON.stringify(h.os))], hideView: v => { testHideView = v; }, testAds: v => { rightDown = v; }, testFire: v => { mouseDown = v; if (v) { locked = true; firedThisClick = false; } }, vGun, get gunPicking() { return gunPicking; }, get lootPicking() { return lootPicking; }, get shopping() { return shopping; }, selectLoot, lootSlot, endShop, useItem, W, selectGun, chooseSlot, passGun, get hostGame() { return hostGame; }, get bot() { return bot; }, get locked() { return locked; }, get phase() { return phase; }, onMessage, choose: id => choose(id, null) };
