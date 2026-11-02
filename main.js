import * as THREE from 'three';
import { PLAYER, RULES, WEAPONS, WEAPON_ORDER } from './map.js';
import { GameRoom } from './game.js';
import { Bot } from './bot.js';
import { stepMovement, MOVE } from './physics.js';
import {
  renderer, scene, camera, viewScene, composer, vignette, resize,
  tracer, sparks, puff, blood, bulletHole, surfaceAt, updateEffects, flashTex,
} from './world.js';
import { makeRifle, makeSniper, makeArms, makeSoldier } from './models.js';

// ================= 상태 =================
const me = {
  id: 0, ent: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: true },
  yaw: 0, pitch: 0, hp: RULES.maxHp, dead: false,
  weapon: 'rifle', ammo: { rifle: WEAPONS.rifle.mag, sniper: WEAPONS.sniper.mag },
  reloadStart: 0, reloadUntil: 0, switchUntil: 0, lastFire: 0, ads: false, adsT: 0, boltT: 0,
};
const others = new Map(); // id -> { name, mesh, target, yaw, pitch, w, dead, deadT, speed }
let scores = {};
let locked = false, matchOver = false;
const keys = {};
let mouseDown = false, rightDown = false, firedThisClick = false;
let recoilKick = 0, shake = 0, bob = 0, stepAcc = 0, swayX = 0, swayY = 0;
let mode = null, bot = null, botDiff = 'normal';

const $ = id => document.getElementById(id);
const ui = {
  lobby: $('lobby'), pause: $('pause'), pauseText: $('pauseText'), hud: $('hud'),
  hpfill: $('hpfill'), hptext: $('hptext'), score: $('scoreboard'), status: $('status'),
  feed: $('feed'), center: $('center'), hit: $('hitmarker'), hitdir: $('hitdir'), msg: $('lobbyMsg'),
  ammo: $('ammo'), ammomax: $('ammomax'), wname: $('wname'), reload: $('reloadHint'), scope: $('scope'),
  cross: $('crosshair'), slots: [...document.querySelectorAll('#slots span')],
};

// ================= 1인칭 무기 =================
const viewRoot = new THREE.Group(); viewScene.add(viewRoot);
const vGuns = { rifle: makeRifle(), sniper: makeSniper() };
const arms = makeArms();
viewRoot.add(vGuns.rifle, vGuns.sniper, arms);
vGuns.sniper.visible = false;
const HIP = new THREE.Vector3(0.17, -0.17, -0.42);
const ADS = { rifle: new THREE.Vector3(0, -0.098, -0.3), sniper: new THREE.Vector3(0, -0.085, -0.22) };
const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(1.6, 1.3, 1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
flashSprite.visible = false; viewScene.add(flashSprite);
const worldFlash = new THREE.PointLight(0xffb060, 0, 12, 2); scene.add(worldFlash);

// ================= 사운드 =================
let audio, master;
function ac() {
  if (!audio) { audio = new AudioContext(); master = audio.createGain(); master.gain.value = 0.6; master.connect(audio.destination); }
  return audio;
}
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
function thump(f0, f1, len, gain, when = 0) {
  const a = ac(), t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g).connect(master); o.start(t); o.stop(t + len);
}
function tone(freq, len, gain, when = 0) {
  const a = ac(), t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g).connect(master); o.start(t); o.stop(t + len);
}
const sfx = {
  rifle(far) { const k = far ? 0.3 : 1; noiseBurst(0.14, 'lowpass', 3200, 0.7 * k, 4); thump(150, 40, 0.09, 0.8 * k); },
  sniper(far) { const k = far ? 0.45 : 1; noiseBurst(0.6, 'lowpass', 1800, 0.9 * k, 5); thump(90, 28, 0.3, 1.0 * k); noiseBurst(0.9, 'bandpass', 600, 0.15 * k, 2, 0.05); },
  bolt() { noiseBurst(0.04, 'highpass', 2500, 0.3, 3, 0.35); noiseBurst(0.04, 'highpass', 3200, 0.3, 3, 0.6); },
  empty() { noiseBurst(0.03, 'highpass', 4000, 0.4); },
  reload(t) { noiseBurst(0.05, 'highpass', 2200, 0.35, 3, 0.15); noiseBurst(0.06, 'bandpass', 1500, 0.4, 3, t * 0.55); noiseBurst(0.05, 'highpass', 3000, 0.4, 3, t * 0.88); },
  hit(head) { tone(head ? 2400 : 1500, 0.08, 0.25); },
  hurt() { thump(220, 70, 0.15, 0.5); },
  step() { noiseBurst(0.06, 'lowpass', 500, 0.18, 2); },
  swap() { noiseBurst(0.05, 'highpass', 2000, 0.25, 3, 0.05); },
};

// ================= UI =================
function updateHp() {
  const r = Math.max(0, me.hp) / RULES.maxHp;
  ui.hpfill.style.width = r * 100 + '%';
  ui.hpfill.style.background = r > 0.5 ? '#4cd964' : r > 0.25 ? '#ffcc00' : '#ff3b30';
  ui.hptext.textContent = Math.max(0, me.hp);
  vignette.uniforms.red.value = r < 0.35 && !me.dead ? (0.35 - r) * 1.6 : 0;
}
function updateAmmo() {
  const W = WEAPONS[me.weapon], n = me.ammo[me.weapon];
  ui.wname.textContent = W.name;
  ui.ammo.textContent = n;
  ui.ammo.classList.toggle('low', n <= Math.ceil(W.mag * 0.2));
  ui.ammomax.textContent = ` / ${W.mag}`;
  ui.slots.forEach(s => s.classList.toggle('on', s.dataset.w === me.weapon));
}
function updateScore() {
  const op = [...others.entries()][0];
  const opName = op ? op[1].name : '상대 대기 중...';
  ui.score.innerHTML = `<span class="me">나 ${scores[me.id] ?? 0}</span> &nbsp;:&nbsp; <span class="op">${scores[op?.[0]] ?? 0} ${escapeHtml(opName)}</span>`;
  ui.status.textContent = op ? `먼저 ${RULES.winScore}킬 하면 승리` : '같은 방 코드로 상대가 들어오길 기다리는 중';
}
function feed(text) {
  const d = document.createElement('div'); d.textContent = text;
  ui.feed.prepend(d);
  setTimeout(() => d.remove(), 4500);
}
function flashClass(el, ms, extra) {
  el.classList.add('show'); if (extra !== undefined) el.classList.toggle('head', extra);
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const nameOf = id => id === me.id ? '나' : others.get(id)?.name ?? '???';

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

let joining = false;
$('joinBtn').onclick = () => {
  if (joining) return;
  joining = true; mode = 'online';
  ui.msg.textContent = '접속 중...';
  connect($('room').value.trim() || 'lobby', getName());
};
$('botBtn').onclick = () => {
  if (joining) return;
  joining = true; mode = 'bot';
  hostGame = new GameRoom('AI 봇전');
  localId = hostGame.join(getName(), msg => onMessage(msg));
  net = msg => hostGame.message(localId, msg);
  bot = new Bot(hostGame, botDiff);
  const o = others.get(bot.id);
  if (o) o.name = `BOT (${{ easy: '쉬움', normal: '보통', hard: '어려움' }[botDiff]})`;
  updateScore();
};

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
function addOther(o) {
  const mesh = makeSoldier(0xb8443a);
  mesh.position.set(...o.pos);
  scene.add(mesh);
  others.set(o.id, { name: o.name, mesh, target: new THREE.Vector3(...o.pos), yaw: o.yaw || 0, pitch: 0, w: 'rifle', dead: !!o.dead, deadT: 0, speed: 0 });
  mesh.visible = !o.dead;
}

function resetLoadout() {
  me.ammo = { rifle: WEAPONS.rifle.mag, sniper: WEAPONS.sniper.mag };
  me.reloadStart = 0; me.reloadUntil = 0; me.switchUntil = 0; me.ads = false; me.boltT = 0; me.pendingReload = null;
  ui.reload.textContent = '';
  updateAmmo();
}
function respawnMe(m) {
  me.ent.pos.set(...m.pos); me.ent.vel.set(0, 0, 0);
  me.yaw = m.yaw; me.pitch = 0; me.hp = m.hp; me.dead = false;
  ui.center.textContent = '';
  resetLoadout();
  updateHp();
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

function onMessage(m) {
  switch (m.t) {
    case 'full':
      lostConnection('방이 가득 찼습니다 (최대 2명). 다른 방 코드를 써 주세요.');
      peer?.destroy(); break;
    case 'welcome':
      me.id = m.id;
      respawnMe(m);
      m.others.forEach(addOther);
      scores = m.scores;
      if (mode === 'online') { const u = new URL(location.href); u.searchParams.set('room', m.room); history.replaceState(null, '', u); }
      ui.lobby.classList.add('hidden');
      ui.hud.classList.remove('hidden');
      ui.pause.classList.remove('hidden');
      ui.pauseText.textContent = mode === 'bot' ? 'AI 봇전 · 클릭해서 시작' : `방 "${m.room}" 입장 완료 · 클릭해서 시작`;
      updateScore();
      break;
    case 'join':
      addOther(m); feed(`${m.name} 입장`); updateScore(); break;
    case 'leave': {
      const o = others.get(m.id);
      if (o) { scene.remove(o.mesh); others.delete(m.id); feed(`${o.name} 퇴장`); }
      updateScore(); break;
    }
    case 'state': {
      const o = others.get(m.id); if (!o) break;
      o.target.set(...m.p); o.yaw = m.yaw; o.pitch = m.pitch;
      if (m.w && m.w !== o.w) { o.w = m.w; for (const k in o.mesh.userData.guns) o.mesh.userData.guns[k].visible = k === m.w; }
      break;
    }
    case 'shot': {
      const end = new THREE.Vector3(...m.end), o3 = new THREE.Vector3(...m.o);
      let from;
      if (m.id === me.id) from = muzzleWorld();
      else {
        const o = others.get(m.id);
        from = o3.clone();
        if (o) o.mesh.userData.guns[o.w].userData.muzzle.getWorldPosition(from);
        sfx[m.w === 'sniper' ? 'sniper' : 'rifle'](true);
      }
      // 내가 맞은 총알은 화면 바로 앞에서 끊어서 그림
      const camD = end.distanceTo(camera.position);
      const tEnd = camD < 1.5 ? end.clone().lerp(from, Math.min(1, 1.5 / Math.max(from.distanceTo(end), 1.5))) : end;
      tracer(from, tEnd, m.w === 'sniper' ? 0xbfe4ff : 0xffd27a);
      if (m.hitPlayer) { if (camD > 1.5) blood(end); }
      else {
        const s = surfaceAt(o3, end);
        if (s) {
          bulletHole(s.point, s.normal);
          sparks(s.point, s.normal, 0xffb050, m.w === 'sniper' ? 14 : 6);
          puff(s.point.clone().addScaledVector(s.normal, 0.1), 0xbdb6aa, m.w === 'sniper' ? 0.9 : 0.4);
        }
      }
      break;
    }
    case 'hit':
      if (m.target === me.id) {
        me.hp = m.hp; updateHp(); sfx.hurt(); shake = Math.max(shake, 0.25);
        if (m.from) {
          const ang = Math.atan2(-(m.from[0] - me.ent.pos.x), -(m.from[2] - me.ent.pos.z)) - me.yaw;
          ui.hitdir.style.transform = `rotate(${-ang}rad)`;
          flashClass(ui.hitdir, 700);
        }
      } else if (m.by === me.id) {
        flashClass(ui.hit, 150, m.head); sfx.hit(m.head);
      }
      break;
    case 'kill': {
      scores = m.scores; updateScore();
      feed(`${nameOf(m.killer)}  [${WEAPONS[m.w]?.name ?? ''}${m.head ? ' · 헤드샷' : ''}]  ${nameOf(m.victim)}`);
      if (m.victim === me.id) {
        me.dead = true; me.hp = 0; me.ads = false; updateHp();
        ui.center.innerHTML = `사망<br><small style="font-size:18px">${RULES.respawnTime}초 후 부활</small>`;
      } else {
        const o = others.get(m.victim); if (o) { o.dead = true; o.deadT = 0; }
        if (m.killer === me.id) { ui.center.textContent = m.head ? '헤드샷 킬!' : '킬!'; setTimeout(() => { if (!matchOver && !me.dead) ui.center.textContent = ''; }, 1200); }
      }
      break;
    }
    case 'respawn':
      if (m.id === me.id) respawnMe(m);
      else {
        const o = others.get(m.id);
        if (o) { o.dead = false; o.mesh.visible = true; o.mesh.rotation.x = 0; o.target.set(...m.pos); o.mesh.position.set(...m.pos); o.yaw = m.yaw; }
      }
      if (matchOver) { matchOver = false; ui.center.textContent = ''; }
      break;
    case 'scores':
      scores = m.scores; updateScore(); break;
    case 'win':
      matchOver = true;
      ui.center.innerHTML = (m.id === me.id ? '🏆 승리!' : `패배... ${escapeHtml(m.name)} 승리`) + '<br><small style="font-size:18px">5초 후 새 게임 시작</small>';
      break;
  }
}

// ================= 입력 =================
const cvs = renderer.domElement;
ui.pause.addEventListener('click', () => cvs.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === cvs;
  ui.pause.classList.toggle('hidden', locked);
  if (!locked) {
    ui.pauseText.textContent = '일시정지 · 클릭해서 계속';
    mouseDown = rightDown = false; Object.keys(keys).forEach(k => keys[k] = false);
  }
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousemove', e => {
  if (!locked || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // 포인터락 직후 튀는 값 무시
  const sens = 0.0022 * (camera.fov / 75);
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
  keys[e.code] = true;
  if (!locked) return;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1') switchWeapon('rifle');
  if (e.code === 'Digit2') switchWeapon('sniper');
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('resize', resize);

const nowS = () => performance.now() / 1000;
function busy() { return nowS() < me.reloadUntil || nowS() < me.switchUntil; }

function switchWeapon(w, relative) {
  if (me.dead || nowS() < me.reloadUntil) return; // 재장전 중에는 교체 불가
  if (relative) { const i = WEAPON_ORDER.indexOf(me.weapon); w = WEAPON_ORDER[(i + w + WEAPON_ORDER.length) % WEAPON_ORDER.length]; }
  if (w === me.weapon) return;
  me.weapon = w; me.switchUntil = nowS() + 0.45; me.ads = false; me.boltT = 0;
  sfx.swap(); updateAmmo();
  ui.reload.textContent = '';
}

function startReload() {
  const W = WEAPONS[me.weapon];
  if (me.dead || busy() || me.ammo[me.weapon] >= W.mag) return;
  me.reloadStart = nowS(); me.reloadUntil = me.reloadStart + W.reload; me.ads = false;
  me.pendingReload = me.weapon;
  net({ t: 'reload', w: me.weapon });
  sfx.reload(W.reload);
  ui.reload.textContent = '재장전 중...';
}

// 재장전 완료 처리는 매 프레임 확인 (타이머보다 정확)
function finishReload() {
  if (!me.pendingReload || nowS() < me.reloadUntil) return;
  me.ammo[me.pendingReload] = WEAPONS[me.pendingReload].mag;
  me.pendingReload = null;
  ui.reload.textContent = '';
  updateAmmo();
}

function tryFire() {
  if (!mouseDown || me.dead || matchOver || !locked || busy()) return;
  const W = WEAPONS[me.weapon], now = nowS();
  if (!W.auto && firedThisClick) return;
  if (now - me.lastFire < W.interval) return;
  if (me.ammo[me.weapon] <= 0) { firedThisClick = true; me.lastFire = now; sfx.empty(); startReload(); return; }
  me.lastFire = now; firedThisClick = true;
  me.ammo[me.weapon]--; updateAmmo();

  // 퍼짐: 정조준/이동/점프에 따라 달라짐
  const moving = Math.hypot(me.ent.vel.x, me.ent.vel.z);
  const spread = THREE.MathUtils.lerp(W.spread, W.adsSpread, me.adsT) + moving * 0.002 + (me.ent.onGround ? 0 : 0.04);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  dir.x += (Math.random() - 0.5) * 2 * spread; dir.y += (Math.random() - 0.5) * 2 * spread; dir.z += (Math.random() - 0.5) * 2 * spread;
  dir.normalize();
  // 위치를 먼저 보내서 방장이 정확한 위치로 판정하게 함
  net({ t: 'state', p: [me.ent.pos.x, me.ent.pos.y, me.ent.pos.z], yaw: me.yaw, pitch: me.pitch, w: me.weapon, ads: me.ads });
  net({ t: 'shoot', dir: dir.toArray(), w: me.weapon });

  // 반동
  me.pitch = Math.min(1.5, me.pitch + W.recoil * (me.ads ? 0.6 : 1));
  me.yaw += (Math.random() - 0.5) * W.recoil * 0.6;
  recoilKick = 1; shake = Math.max(shake, me.weapon === 'sniper' ? 0.35 : 0.08);
  flashSprite.visible = true; flashSprite.material.rotation = Math.random() * Math.PI;
  flashSprite.scale.setScalar(me.weapon === 'sniper' ? 0.35 : 0.22);
  worldFlash.intensity = 30; worldFlash.position.copy(muzzleWorld());
  setTimeout(() => { flashSprite.visible = false; worldFlash.intensity = 0; }, 45);
  sfx[me.weapon]();
  if (me.weapon === 'sniper') { sfx.bolt(); me.boltT = now; }
  if (me.ammo[me.weapon] === 0) setTimeout(startReload, me.weapon === 'sniper' ? 900 : 250);
}

// ================= 프레임 갱신 =================
function updateMe(dt) {
  if (me.dead) return;
  finishReload();
  const bolting = me.weapon === 'sniper' && me.boltT && nowS() - me.boltT < 0.9;
  me.ads = rightDown && !busy() && !bolting;
  const running = (keys.ShiftLeft || keys.ShiftRight) && !me.ads && keys.KeyW;
  const input = {
    f: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    s: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    yaw: me.yaw, jump: !!keys.Space,
    speed: me.ads ? MOVE.ads : running ? MOVE.run : MOVE.walk,
  };
  stepMovement(me.ent, input, dt);
  const sp = Math.hypot(me.ent.vel.x, me.ent.vel.z);
  if (me.ent.onGround && sp > 1) { stepAcc += dt * sp; if (stepAcc > 2.4) { stepAcc = 0; sfx.step(); } }
  if (!bolting) tryFire();
}

function updateView(dt) {
  const W = WEAPONS[me.weapon], now = nowS();
  me.adsT = THREE.MathUtils.damp(me.adsT, me.ads ? 1 : 0, 14, dt);
  const sniperScoped = me.weapon === 'sniper' && me.adsT > 0.85;

  // 카메라
  shake = Math.max(0, shake - dt * 2);
  const sx = (Math.random() - 0.5) * shake * 0.03, sy = (Math.random() - 0.5) * shake * 0.03;
  camera.position.set(me.ent.pos.x, me.ent.pos.y + (me.dead ? 0.35 : PLAYER.eye), me.ent.pos.z);
  camera.rotation.set(me.pitch + sy, me.yaw + sx, me.dead ? 0.5 : 0);
  const fov = THREE.MathUtils.lerp(75, W.fov, me.adsT);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

  // 1인칭 총 위치 (흔들림, 반동, 재장전/교체 애니메이션)
  const sp = Math.hypot(me.ent.vel.x, me.ent.vel.z);
  if (me.ent.onGround && sp > 0.5) bob += dt * sp * 1.5;
  recoilKick = Math.max(0, recoilKick - dt * (me.weapon === 'sniper' ? 4 : 14));
  swayX = THREE.MathUtils.damp(swayX, 0, 8, dt); swayY = THREE.MathUtils.damp(swayY, 0, 8, dt);
  const bobAmt = (1 - me.adsT * 0.85) * Math.min(1, sp / 6);
  const pos = HIP.clone().lerp(ADS[me.weapon], me.adsT);
  pos.x += Math.cos(bob) * 0.012 * bobAmt - swayX;
  pos.y += Math.abs(Math.sin(bob)) * 0.016 * bobAmt + swayY;
  pos.z += recoilKick * (me.weapon === 'sniper' ? 0.12 : 0.04);
  let rotX = recoilKick * (me.weapon === 'sniper' ? 0.18 : 0.05), rotZ = 0, rotY = 0;
  const gun = vGuns[me.weapon], magY = me.weapon === 'sniper' ? -0.05 : -0.04;
  // 재장전: 총을 기울이고 탄창을 뺐다 끼움
  if (now < me.reloadUntil) {
    const t = (now - me.reloadStart) / W.reload, e = Math.sin(Math.min(1, t) * Math.PI);
    pos.y -= 0.08 * e; rotZ = 0.6 * e; rotX += 0.25 * e;
    gun.userData.mag.position.y = magY - (t > 0.2 && t < 0.7 ? 0.25 : 0);
  } else gun.userData.mag.position.y = magY;
  // 교체: 아래로 내렸다 올림
  if (now < me.switchUntil) { const t = 1 - (me.switchUntil - now) / 0.45; pos.y -= 0.35 * (1 - t); rotX -= 0.5 * (1 - t); }
  // 저격 노리쇠 당기기
  if (me.weapon === 'sniper' && me.boltT && now - me.boltT < 0.9) {
    const t = (now - me.boltT) / 0.9, e = Math.sin(t * Math.PI);
    rotZ += 0.35 * e; pos.y -= 0.03 * e;
    gun.userData.bolt.position.z = 0.08 + 0.08 * e; gun.userData.bolt.rotation.z = -0.8 * e;
  }
  // 달리기 자세
  if ((keys.ShiftLeft || keys.ShiftRight) && keys.KeyW && !me.ads && me.ent.onGround) { rotY += 0.5; rotX -= 0.15; pos.x -= 0.05; pos.y -= 0.03; }

  viewRoot.position.copy(pos);
  viewRoot.rotation.set(rotX, rotY, rotZ);
  vGuns.rifle.visible = me.weapon === 'rifle';
  vGuns.sniper.visible = me.weapon === 'sniper';
  viewRoot.visible = !me.dead && !sniperScoped;
  flashSprite.position.copy(gun.userData.muzzle.position).applyEuler(viewRoot.rotation).add(viewRoot.position);

  ui.scope.classList.toggle('hidden', !sniperScoped || me.dead);
  ui.cross.style.opacity = me.adsT > 0.5 || me.dead ? 0 : 1;
  const gap = Math.round(6 + (W.spread * 300) * (1 - me.adsT) + sp * 1.5 + recoilKick * 8);
  ui.cross.style.setProperty('--gap', gap + 'px');
  if (now >= me.reloadUntil && me.ammo[me.weapon] === 0) ui.reload.textContent = 'R 키로 재장전';
}

function updateOthers(dt) {
  const k = 1 - Math.exp(-15 * dt);
  for (const o of others.values()) {
    const m = o.mesh, ud = m.userData;
    if (o.dead) {
      // 쓰러지는 연출 후 숨김
      o.deadT += dt;
      m.rotation.x = Math.max(-Math.PI / 2, -o.deadT * 5);
      if (o.deadT > 2) m.visible = false;
      continue;
    }
    const prev = m.position.clone();
    m.position.lerp(o.target, k);
    const v = prev.distanceTo(m.position) / Math.max(dt, 1e-4);
    o.speed = THREE.MathUtils.damp(o.speed, v, 10, dt);
    let dy = o.yaw - m.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * k;
    ud.aim.rotation.x = o.pitch;
    ud.head.rotation.x = o.pitch * 0.5;
    ud.walk += dt * o.speed * 1.4;
    const swing = Math.sin(ud.walk) * Math.min(0.7, o.speed * 0.1);
    ud.legL.rotation.x = swing; ud.legR.rotation.x = -swing;
  }
}

const clock = new THREE.Clock();
let sendAcc = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (me.id) {
    updateMe(dt);
    if (bot) bot.update(dt);
    updateView(dt);
    sendAcc += dt;
    if (sendAcc > 0.05 && !me.dead) {
      sendAcc = 0;
      net({ t: 'state', p: [me.ent.pos.x, me.ent.pos.y, me.ent.pos.z], yaw: me.yaw, pitch: me.pitch, w: me.weapon, ads: me.ads });
    }
  } else {
    // 로비 배경: 천천히 도는 카메라
    const t = performance.now() * 0.00005;
    camera.position.set(Math.sin(t) * 26, 9, Math.cos(t) * 26); camera.lookAt(0, 1, 0);
    viewRoot.visible = false;
  }
  updateOthers(dt);
  updateEffects(dt);
  composer.render();
  requestAnimationFrame(loop);
}

updateAmmo();
loop();

// 테스트용 핸들
window.__fps = { me, others, get hostGame() { return hostGame; }, get bot() { return bot; }, get locked() { return locked; } };
