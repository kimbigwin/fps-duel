import * as THREE from 'three';
import { ARENA, PLAYER, RULES, solidAABBs } from './map.js';
import { GameRoom } from './game.js';

// ================= 기본 씬 =================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb7d9);
scene.fog = new THREE.Fog(0x8fb7d9, 40, 110);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4036, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(20, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 100 });
scene.add(sun);

// ================= 아레나 =================
function gridTexture(base, line, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = line; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const size = ARENA.half * 2;
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(size, size),
  new THREE.MeshStandardMaterial({ map: gridTexture('#5b6470', '#4a525c', size / 2) }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4252 });
const boxColors = [0xc8a165, 0x9c7b52, 0xb35c44, 0x6d8a5e];
for (const a of solidAABBs()) {
  const w = a.max[0] - a.min[0], h = a.max[1] - a.min[1], d = a.max[2] - a.min[2];
  const isWall = w > ARENA.half || d > ARENA.half;
  const mat = isWall ? wallMat : new THREE.MeshStandardMaterial({
    color: boxColors[Math.round(Math.abs(a.min[0] * 3 + a.min[2])) % boxColors.length],
    map: gridTexture('#ffffff', '#d0d0d0', 1),
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set((a.min[0] + a.max[0]) / 2, h / 2, (a.min[2] + a.max[2]) / 2);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

// ================= 1인칭 총 =================
const gun = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.5), gunMat);
const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 10), gunMat);
gunBarrel.rotation.x = Math.PI / 2; gunBarrel.position.set(0, 0.025, -0.38);
const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0xff8a3d }));
gunGrip.position.set(0, -0.11, 0.12); gunGrip.rotation.x = 0.3;
gun.add(gunBody, gunBarrel, gunGrip);
const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.025, -0.55); gun.add(muzzle);
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
flash.position.copy(muzzle.position); flash.visible = false; gun.add(flash);
const flashLight = new THREE.PointLight(0xffb347, 0, 6); flashLight.position.copy(muzzle.position); gun.add(flashLight);
const GUN_REST = new THREE.Vector3(0.2, -0.19, -0.42);
gun.position.copy(GUN_REST);
gun.scale.setScalar(0.65);
camera.add(gun);

// ================= 상대 모델 =================
function makeAvatar(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.bodyHeight - PLAYER.radius * 2, 4, 12), mat);
  body.position.y = PLAYER.bodyHeight / 2;
  const head = new THREE.Mesh(new THREE.BoxGeometry(PLAYER.headSize, PLAYER.headSize, PLAYER.headSize), new THREE.MeshStandardMaterial({ color: 0xffd7b0 }));
  head.position.y = PLAYER.bodyHeight + PLAYER.headSize / 2;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  visor.position.set(0, 0.05, -PLAYER.headSize / 2 - 0.01); head.add(visor);
  const pivot = new THREE.Group(); pivot.position.y = 1.25;          // 팔/총 피벗 (상하 조준)
  const rgun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.7), gunMat);
  rgun.position.set(0.3, 0, -0.35); pivot.add(rgun);
  g.add(body, head, pivot);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { head, pivot };
  return g;
}

// ================= 상태 =================
const SOLIDS = solidAABBs();
const me = { id: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true, hp: RULES.maxHp, dead: false };
const others = new Map(); // id -> { name, mesh, target, yaw, pitch, dead }
let scores = {};
let locked = false, matchOver = false;
const keys = {};
let mouseDown = false, lastFire = 0, recoil = 0;

const $ = id => document.getElementById(id);
const ui = {
  lobby: $('lobby'), pause: $('pause'), pauseText: $('pauseText'), hud: $('hud'),
  hpfill: $('hpfill'), hptext: $('hptext'), score: $('scoreboard'), status: $('status'),
  feed: $('feed'), center: $('center'), hit: $('hitmarker'), dmg: $('damage'), msg: $('lobbyMsg'),
};

// ================= 사운드 (WebAudio) =================
let audio;
function sfx(type) {
  audio ??= new AudioContext();
  const t = audio.currentTime;
  const len = type === 'shot' ? 0.18 : 0.08;
  const buf = audio.createBuffer(1, audio.sampleRate * len, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = audio.createBufferSource(); src.buffer = buf;
  const filter = audio.createBiquadFilter();
  filter.type = type === 'shot' ? 'lowpass' : 'highpass';
  filter.frequency.value = type === 'shot' ? 1800 : 3000;
  const gain = audio.createGain();
  gain.gain.value = type === 'far' ? 0.15 : type === 'shot' ? 0.5 : 0.4;
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start(t);
}

// ================= UI =================
function updateHp() {
  const r = Math.max(0, me.hp) / RULES.maxHp;
  ui.hpfill.style.width = r * 100 + '%';
  ui.hpfill.style.background = r > 0.5 ? '#4cd964' : r > 0.25 ? '#ffcc00' : '#ff3b30';
  ui.hptext.textContent = Math.max(0, me.hp);
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
  setTimeout(() => d.remove(), 4000);
}
function flashClass(el, ms) { el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms); }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const nameOf = id => id === me.id ? '나' : others.get(id)?.name ?? '???';

// ================= 네트워크 =================
$('name').value = localStorage.getItem('fps_name') || '';
$('room').value = new URLSearchParams(location.search).get('room') || '';

let joining = false;
$('joinBtn').onclick = () => {
  if (joining) return;
  const name = $('name').value.trim() || 'Player';
  const room = $('room').value.trim() || 'lobby';
  try { localStorage.setItem('fps_name', name); } catch {}
  joining = true;
  ui.msg.textContent = '접속 중...';
  connect(room, name);
};

// ----- P2P 연결 (PeerJS / WebRTC) -----
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
    // 방장이 됨
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
      // 이미 방장이 있음 -> 손님으로 접속
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

function addOther(o) {
  const mesh = makeAvatar(0xd9453b);
  mesh.position.set(...o.pos);
  scene.add(mesh);
  others.set(o.id, { name: o.name, mesh, target: new THREE.Vector3(...o.pos), yaw: o.yaw || 0, pitch: 0, dead: !!o.dead });
  mesh.visible = !o.dead;
}

function respawnMe(m) {
  me.pos.set(...m.pos); me.vel.set(0, 0, 0);
  me.yaw = m.yaw; me.pitch = 0; me.hp = m.hp; me.dead = false;
  ui.center.textContent = '';
  updateHp();
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
      { const u = new URL(location.href); u.searchParams.set('room', m.room); history.replaceState(null, '', u); }
      ui.lobby.classList.add('hidden');
      ui.hud.classList.remove('hidden');
      ui.pause.classList.remove('hidden');
      ui.pauseText.textContent = `방 "${m.room}" 입장 완료 · 클릭해서 시작`;
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
      break;
    }
    case 'shot': {
      const from = new THREE.Vector3(...m.o);
      if (m.id === me.id) muzzle.getWorldPosition(from);
      else {
        const o = others.get(m.id);
        if (o) { o.mesh.userData.pivot.children[0].getWorldPosition(from); }
        sfx('far');
      }
      tracer(from, new THREE.Vector3(...m.end), m.id === me.id ? 0xffe08a : 0xff7b6b);
      const endP = new THREE.Vector3(...m.end);
      if (endP.distanceTo(camera.position) > 2) impact(endP);
      break;
    }
    case 'hit':
      if (m.target === me.id) {
        me.hp = m.hp; updateHp(); flashClass(ui.dmg, 200);
      } else if (m.by === me.id) {
        flashClass(ui.hit, 120); sfx('hit');
      }
      break;
    case 'kill': {
      scores = m.scores; updateScore();
      feed(`${nameOf(m.killer)} ▸ ${nameOf(m.victim)}${m.head ? ' (헤드샷)' : ''}`);
      if (m.victim === me.id) {
        me.dead = true; me.hp = 0; updateHp();
        ui.center.innerHTML = `사망<br><small style="font-size:18px">${RULES.respawnTime}초 후 부활</small>`;
      } else {
        const o = others.get(m.victim); if (o) { o.dead = true; o.mesh.visible = false; }
        if (m.killer === me.id) { ui.center.textContent = m.head ? '헤드샷 킬!' : '킬!'; setTimeout(() => { if (!matchOver && !me.dead) ui.center.textContent = ''; }, 1200); }
      }
      break;
    }
    case 'respawn':
      if (m.id === me.id) respawnMe(m);
      else {
        const o = others.get(m.id);
        if (o) { o.dead = false; o.mesh.visible = true; o.target.set(...m.pos); o.mesh.position.set(...m.pos); o.yaw = m.yaw; }
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

// ================= 이펙트 =================
const effects = [];
function tracer(a, b, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
  scene.add(line);
  effects.push({ obj: line, life: 0.12, max: 0.12 });
}
const impactGeo = new THREE.SphereGeometry(0.08, 6, 6);
function impact(p) {
  const s = new THREE.Mesh(impactGeo, new THREE.MeshBasicMaterial({ color: 0xffeeaa, transparent: true }));
  s.position.copy(p);
  scene.add(s);
  effects.push({ obj: s, life: 0.3, max: 0.3 });
}

// ================= 입력 =================
const canvas = renderer.domElement;
ui.pause.addEventListener('click', () => canvas.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  ui.pause.classList.toggle('hidden', locked);
  if (!locked) { ui.pauseText.textContent = '일시정지 · 클릭해서 계속'; mouseDown = false; Object.keys(keys).forEach(k => keys[k] = false); }
});
document.addEventListener('mousemove', e => {
  if (!locked || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // 포인터락 직후 튀는 값 무시
  me.yaw -= e.movementX * 0.0022;
  me.pitch = THREE.MathUtils.clamp(me.pitch - e.movementY * 0.0022, -1.5, 1.5);
});
document.addEventListener('mousedown', e => { if (locked && e.button === 0) mouseDown = true; });
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
document.addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space' && locked) e.preventDefault(); });
document.addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function tryFire(now) {
  if (!mouseDown || me.dead || matchOver || !locked) return;
  if (now - lastFire < RULES.fireInterval) return;
  lastFire = now;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  net({ t: 'shoot', dir: dir.toArray() });
  recoil = 1;
  me.pitch = Math.min(1.5, me.pitch + 0.012);
  flash.visible = true; flashLight.intensity = 8;
  setTimeout(() => { flash.visible = false; flashLight.intensity = 0; }, 50);
  sfx('shot');
}

// ================= 이동/충돌 =================
const SPEED = 6, RUN = 9, GRAVITY = 25, JUMP = 8.2, R = PLAYER.radius;

function overlapsXZ(p, b) {
  const cx = THREE.MathUtils.clamp(p.x, b.min[0], b.max[0]);
  const cz = THREE.MathUtils.clamp(p.z, b.min[2], b.max[2]);
  return (p.x - cx) ** 2 + (p.z - cz) ** 2 < R * R;
}

function physics(dt) {
  if (me.dead) return;
  // 입력 -> 수평 속도
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const speed = keys.ShiftLeft || keys.ShiftRight ? RUN : SPEED;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  let vx = -sin * f + cos * s, vz = -cos * f - sin * s;
  const len = Math.hypot(vx, vz); if (len > 0) { vx = vx / len * speed; vz = vz / len * speed; }
  const accel = me.onGround ? 14 : 3;
  me.vel.x += (vx - me.vel.x) * Math.min(1, accel * dt);
  me.vel.z += (vz - me.vel.z) * Math.min(1, accel * dt);
  if (keys.Space && me.onGround) { me.vel.y = JUMP; me.onGround = false; }

  // 수평 이동 + 밀어내기
  me.pos.x += me.vel.x * dt;
  me.pos.z += me.vel.z * dt;
  for (const b of SOLIDS) {
    if (me.pos.y >= b.max[1] - 0.05 || me.pos.y + 1.8 <= b.min[1]) continue;
    const cx = THREE.MathUtils.clamp(me.pos.x, b.min[0], b.max[0]);
    const cz = THREE.MathUtils.clamp(me.pos.z, b.min[2], b.max[2]);
    let dx = me.pos.x - cx, dz = me.pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      me.pos.x = cx + dx / d * R; me.pos.z = cz + dz / d * R;
    } else { // 중심이 박스 안: 가장 가까운 면으로
      const pushes = [b.min[0] - R - me.pos.x, b.max[0] + R - me.pos.x, b.min[2] - R - me.pos.z, b.max[2] + R - me.pos.z];
      const i = pushes.reduce((bi, v, j) => Math.abs(v) < Math.abs(pushes[bi]) ? j : bi, 0);
      if (i < 2) me.pos.x += pushes[i]; else me.pos.z += pushes[i];
    }
  }

  // 수직 이동 (박스 위에 올라설 수 있음)
  const prevY = me.pos.y;
  me.vel.y -= GRAVITY * dt;
  me.pos.y += me.vel.y * dt;
  let ground = 0;
  for (const b of SOLIDS) if (prevY >= b.max[1] - 0.05 && overlapsXZ(me.pos, b)) ground = Math.max(ground, b.max[1]);
  if (me.pos.y <= ground) { me.pos.y = ground; me.vel.y = 0; me.onGround = true; }
  else me.onGround = false;
}

// ================= 메인 루프 =================
const clock = new THREE.Clock();
let sendAcc = 0, bob = 0;

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now() / 1000;

  if (me.id) {
    physics(dt);
    tryFire(now);

    camera.position.set(me.pos.x, me.pos.y + (me.dead ? 0.3 : PLAYER.eye), me.pos.z);
    camera.rotation.set(me.pitch, me.yaw, me.dead ? 0.4 : 0);

    // 총 흔들림/반동
    const moving = Math.hypot(me.vel.x, me.vel.z);
    if (me.onGround && moving > 0.5) bob += dt * moving * 1.6;
    recoil = Math.max(0, recoil - dt * 10);
    gun.position.set(GUN_REST.x + Math.cos(bob) * 0.01, GUN_REST.y + Math.abs(Math.sin(bob)) * 0.015, GUN_REST.z + recoil * 0.06);
    gun.rotation.x = recoil * 0.12;
    gun.visible = !me.dead;

    // 위치 전송 (초당 20회)
    sendAcc += dt;
    if (sendAcc > 0.05) {
      sendAcc = 0;
      if (!me.dead) net({ t: 'state', p: [me.pos.x, me.pos.y, me.pos.z], yaw: me.yaw, pitch: me.pitch });
    }
  }

  // 상대 보간
  const k = 1 - Math.exp(-15 * dt);
  for (const o of others.values()) {
    o.mesh.position.lerp(o.target, k);
    let dy = o.yaw - o.mesh.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    o.mesh.rotation.y += dy * k;
    o.mesh.userData.pivot.rotation.x = o.pitch;
    o.mesh.userData.head.rotation.x = o.pitch * 0.5;
  }

  // 이펙트 페이드
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    e.obj.material.opacity = Math.max(0, e.life / e.max);
    if (e.life <= 0) { scene.remove(e.obj); e.obj.geometry !== impactGeo && e.obj.geometry.dispose(); e.obj.material.dispose(); effects.splice(i, 1); }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

camera.position.set(0, 20, 40); camera.lookAt(0, 0, 0);
loop();
