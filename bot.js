// AI 봇: 방장 브라우저 안에서 GameRoom에 '플레이어'로 참가합니다.
import { ARENA, WEAPONS, rayAABB } from './map.js';
import { SOLIDS, stepMovement, MOVE } from './physics.js';

export const DIFFICULTY = {
  easy:   { label: '쉬움',   reaction: 0.75, aimError: 0.055, turn: 3.0, strafe: 0.4, headChance: 0.05 },
  normal: { label: '보통',   reaction: 0.42, aimError: 0.028, turn: 5.0, strafe: 0.7, headChance: 0.2 },
  hard:   { label: '어려움', reaction: 0.22, aimError: 0.013, turn: 8.0, strafe: 1.0, headChance: 0.4 },
};

// ---------- 내비게이션 그리드 (1m 칸, A*) ----------
const H = ARENA.half, N = H * 2;
const blocked = new Uint8Array(N * N);
for (let gx = 0; gx < N; gx++) for (let gz = 0; gz < N; gz++) {
  const x = gx - H + 0.5, z = gz - H + 0.5;
  for (const b of SOLIDS) {
    if (x > b.min[0] - 0.7 && x < b.max[0] + 0.7 && z > b.min[2] - 0.7 && z < b.max[2] + 0.7) { blocked[gx * N + gz] = 1; break; }
  }
}
const toCell = v => Math.max(0, Math.min(N - 1, Math.floor(v + H)));

function nearestFree(gx, gz) {
  if (!blocked[gx * N + gz]) return [gx, gz];
  for (let r = 1; r < 6; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const x = gx + dx, z = gz + dz;
    if (x >= 0 && z >= 0 && x < N && z < N && !blocked[x * N + z]) return [x, z];
  }
  return [gx, gz];
}

function findPath(from, to) {
  const [sx, sz] = nearestFree(toCell(from.x), toCell(from.z));
  const [tx, tz] = nearestFree(toCell(to.x), toCell(to.z));
  const start = sx * N + sz, goal = tx * N + tz;
  const g = new Float32Array(N * N).fill(Infinity), came = new Int32Array(N * N).fill(-1);
  const open = [start]; g[start] = 0;
  const h = i => Math.hypot(Math.floor(i / N) - tx, (i % N) - tz);
  const closed = new Uint8Array(N * N);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (g[open[i]] + h(open[i]) < g[open[bi]] + h(open[bi])) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === goal) break;
    closed[cur] = 1;
    const cx = Math.floor(cur / N), cz = cur % N;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nx * N + nz;
      if (blocked[ni] || closed[ni]) continue;
      if (dx && dz && (blocked[cx * N + nz] || blocked[nx * N + cz])) continue; // 모서리 끼임 방지
      const ng = g[cur] + (dx && dz ? 1.414 : 1);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; if (!open.includes(ni)) open.push(ni); }
    }
  }
  const path = [];
  for (let c = goal; c !== -1 && c !== start; c = came[c]) path.push({ x: Math.floor(c / N) - H + 0.5, z: (c % N) - H + 0.5 });
  return path.reverse();
}

// 두 점 사이에 벽이 없는지
export function lineOfSight(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dist = Math.hypot(...d);
  const n = d.map(v => v / dist);
  for (const box of SOLIDS) if (rayAABB(a, n, box) < dist) return false;
  return true;
}

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Bot {
  constructor(room, difficulty = 'normal') {
    this.room = room;
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.ent = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, onGround: true };
    this.yaw = 0; this.pitch = 0; this.dead = false;
    this.weapon = 'rifle';
    this.ammo = { rifle: WEAPONS.rifle.mag, sniper: WEAPONS.sniper.mag };
    this.reloadUntil = 0; this.lastShot = 0;
    this.path = []; this.repath = 0;
    this.seeTime = 0; this.strafeDir = 1; this.strafeTimer = 0; this.sendAcc = 0;
    this.id = room.join('BOT', msg => this.onMessage(msg));
  }

  onMessage(m) {
    if ((m.t === 'welcome' || m.t === 'respawn') && m.id === this.id) {
      Object.assign(this.ent.pos, { x: m.pos[0], y: m.pos[1], z: m.pos[2] });
      this.ent.vel = { x: 0, y: 0, z: 0 };
      this.yaw = m.yaw; this.pitch = 0; this.dead = false;
      this.ammo = { rifle: WEAPONS.rifle.mag, sniper: WEAPONS.sniper.mag };
      this.reloadUntil = 0; this.seeTime = 0; this.path = []; this.pendingReload = null;
      this.waitUntil = performance.now() / 1000 + 1.2; // 부활 직후 잠깐 대기
    }
    if (m.t === 'kill' && m.victim === this.id) this.dead = true;
    if (m.t === 'hit' && m.target === this.id && m.from) {
      // 맞으면 공격자 쪽으로 몸을 돌림
      this.alertYaw = Math.atan2(-(m.from[0] - this.ent.pos.x), -(m.from[2] - this.ent.pos.z));
    }
  }

  target() {
    for (const p of this.room.players.values()) if (p.id !== this.id && !p.dead) return p;
    return null;
  }

  update(dt) {
    if (this.dead || this.room.over) return;
    const now = performance.now() / 1000;
    if (now < (this.waitUntil || 0)) return;
    if (this.pendingReload && now >= this.reloadUntil) { this.ammo[this.pendingReload] = WEAPONS[this.pendingReload].mag; this.pendingReload = null; }
    const me = this.ent.pos;
    const t = this.target();
    const eye = [me.x, me.y + 1.6, me.z];
    let input = { f: 0, s: 0, yaw: this.yaw, speed: MOVE.walk, jump: false };

    if (t) {
      const tp = { x: t.pos[0], y: t.pos[1], z: t.pos[2] };
      const dist = Math.hypot(tp.x - me.x, tp.z - me.z);
      const visible = lineOfSight(eye, [tp.x, tp.y + 1.6, tp.z]) || lineOfSight(eye, [tp.x, tp.y + 0.9, tp.z]);

      // 거리에 따라 무기 선택
      const wantSniper = dist > 24;
      if (now > this.reloadUntil) this.weapon = wantSniper && this.ammo.sniper > 0 ? 'sniper' : 'rifle';

      if (visible) {
        this.seeTime += dt;
        this.path = [];
        // 조준: 목표 방향으로 서서히 회전
        if (!this.aimH) this.aimH = Math.random() < this.cfg.headChance ? 1.65 : 1.05;
        const aimH = this.aimH;
        const dx = tp.x - me.x, dy = tp.y + aimH - eye[1], dz = tp.z - me.z;
        const wantYaw = Math.atan2(-dx, -dz);
        const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        const k = Math.min(1, this.cfg.turn * dt);
        this.yaw += angleDiff(wantYaw, this.yaw) * k;
        this.pitch += (wantPitch - this.pitch) * k;

        // 좌우 무빙 + 거리 유지
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeTimer = 0.5 + Math.random() * 1.2; this.aimH = 0; }
        input.s = this.strafeDir * this.cfg.strafe;
        input.f = dist > 18 ? 1 : dist < 8 ? -0.6 : 0;
        input.yaw = this.yaw;

        // 사격
        const W = WEAPONS[this.weapon];
        const aimErr = Math.abs(angleDiff(wantYaw, this.yaw)) + Math.abs(wantPitch - this.pitch);
        if (this.seeTime > this.cfg.reaction && aimErr < 0.1 && now > this.reloadUntil && now - this.lastShot > W.interval * (W.auto ? 1.6 : 1.3)) {
          if (this.ammo[this.weapon] <= 0) {
            this.reloadUntil = now + W.reload;
            this.room.message(this.id, { t: 'reload', w: this.weapon });
            this.pendingReload = this.weapon;
          } else {
            this.lastShot = now;
            this.ammo[this.weapon]--;
            const e = this.cfg.aimError;
            const yaw = this.yaw + (Math.random() - 0.5) * 2 * e, pitch = this.pitch + (Math.random() - 0.5) * 2 * e;
            const dir = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
            this.sendState();
            this.room.message(this.id, { t: 'shoot', dir, w: this.weapon });
          }
        }
      } else {
        this.seeTime = 0;
        // 안 보이면 경로를 따라 추적
        this.repath -= dt;
        if (this.repath <= 0 || !this.path.length) { this.path = findPath(me, tp); this.repath = 0.6; }
        while (this.path.length && Math.hypot(this.path[0].x - me.x, this.path[0].z - me.z) < 0.6) this.path.shift();
        const wp = this.path[0];
        if (wp) {
          const wantYaw = Math.atan2(-(wp.x - me.x), -(wp.z - me.z));
          this.yaw += angleDiff(this.alertYaw ?? wantYaw, this.yaw) * Math.min(1, 6 * dt);
          this.alertYaw = undefined;
          this.pitch *= 0.9;
          input = { f: 1, s: 0, yaw: wantYaw, speed: MOVE.run, jump: false };
        }
      }
      // 재장전 (탄이 적고 안 보일 때)
      if (!visible && now > this.reloadUntil && this.ammo.rifle < 10) {
        this.reloadUntil = now + WEAPONS.rifle.reload;
        this.room.message(this.id, { t: 'reload', w: 'rifle' });
        this.pendingReload = 'rifle';
      }
    }

    // 상대가 없거나 죽었을 때 탄이 부족하면 재장전
    if (!t && now > this.reloadUntil && this.ammo.rifle < WEAPONS.rifle.mag) {
      this.reloadUntil = now + WEAPONS.rifle.reload;
      this.room.message(this.id, { t: 'reload', w: 'rifle' });
      this.pendingReload = 'rifle';
    }

    stepMovement(this.ent, input, dt);
    this.sendAcc += dt;
    if (this.sendAcc > 0.05) { this.sendAcc = 0; this.sendState(); }
  }

  sendState() {
    const p = this.ent.pos;
    this.room.message(this.id, { t: 'state', p: [p.x, p.y, p.z], yaw: this.yaw, pitch: this.pitch, w: this.weapon });
  }
}
