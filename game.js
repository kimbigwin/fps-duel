// 게임 판정 로직: 방장(먼저 들어온 사람) 브라우저에서 실행됩니다.
import { SPAWNS, RULES, solidAABBs, rayAABB, playerHitboxes } from './map.js';

const SOLIDS = solidAABBs();

export class GameRoom {
  constructor(roomName) {
    this.roomName = roomName;
    this.players = new Map();
    this.over = false;
    this.nextId = 1;
  }

  broadcast(msg) { this.players.forEach(p => p.send(msg)); }
  scores() { return Object.fromEntries([...this.players.values()].map(p => [p.id, p.score])); }

  spawn(p) {
    const used = new Set([...this.players.values()].filter(o => o !== p).map(o => o.slot));
    p.slot = used.has(0) ? 1 : 0;
    const s = SPAWNS[p.slot];
    p.pos = [s.x, 0, s.z];
    p.hp = RULES.maxHp;
    p.dead = false;
    return { id: p.id, pos: p.pos, yaw: s.yaw, hp: p.hp };
  }

  // 새 플레이어 입장. 가득 찼으면 null
  join(name, send) {
    if (this.players.size >= 2) { send({ t: 'full' }); return null; }
    const me = { id: this.nextId++, send, name: String(name || 'Player').slice(0, 16), score: 0, yaw: 0, pitch: 0, lastShot: 0 };
    this.players.set(me.id, me);
    const sp = this.spawn(me);
    const others = [...this.players.values()].filter(p => p !== me)
      .map(p => ({ id: p.id, name: p.name, pos: p.pos, yaw: p.yaw, hp: p.hp, dead: p.dead }));
    send({ t: 'welcome', ...sp, room: this.roomName, others, scores: this.scores() });
    this.players.forEach(p => p !== me && p.send({ t: 'join', id: me.id, name: me.name, pos: me.pos, yaw: sp.yaw, hp: me.hp }));
    this.broadcast({ t: 'scores', scores: this.scores() });
    return me.id;
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    this.broadcast({ t: 'leave', id });
    this.players.forEach(p => { p.score = 0; });
    this.broadcast({ t: 'scores', scores: this.scores() });
  }

  resetMatch() {
    this.over = false;
    this.players.forEach(p => { p.score = 0; });
    this.players.forEach(p => this.broadcast({ t: 'respawn', ...this.spawn(p) }));
    this.broadcast({ t: 'scores', scores: this.scores() });
  }

  message(id, m) {
    const me = this.players.get(id);
    if (!me || !m) return;

    if (m.t === 'state' && !me.dead) {
      if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
      me.pos = m.p; me.yaw = +m.yaw || 0; me.pitch = +m.pitch || 0;
      this.players.forEach(p => p !== me && p.send({ t: 'state', id: me.id, p: me.pos, yaw: me.yaw, pitch: me.pitch }));
    }

    if (m.t === 'shoot' && !me.dead && !this.over) {
      const now = Date.now() / 1000;
      if (now - me.lastShot < RULES.fireInterval * 0.8) return;
      me.lastShot = now;

      const o = [me.pos[0], me.pos[1] + 1.6, me.pos[2]];
      let d = m.dir;
      if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return;
      const len = Math.hypot(...d) || 1; d = d.map(v => v / len);

      let wallT = 200;
      for (const b of SOLIDS) wallT = Math.min(wallT, rayAABB(o, d, b));

      let hit = null;
      for (const p of this.players.values()) {
        if (p === me || p.dead) continue;
        const hb = playerHitboxes(p.pos);
        const th = rayAABB(o, d, hb.head), tb = rayAABB(o, d, hb.body);
        const t = Math.min(th, tb);
        if (t < wallT) { hit = { p, head: th <= tb }; wallT = t; }
      }
      const end = o.map((v, i) => v + d[i] * wallT);
      this.broadcast({ t: 'shot', id: me.id, o, end });

      if (hit) {
        const v = hit.p;
        v.hp -= hit.head ? RULES.headDamage : RULES.bodyDamage;
        this.broadcast({ t: 'hit', target: v.id, by: me.id, hp: Math.max(0, v.hp), head: hit.head });
        if (v.hp <= 0) {
          v.dead = true;
          me.score++;
          this.broadcast({ t: 'kill', killer: me.id, victim: v.id, head: hit.head, scores: this.scores() });
          if (me.score >= RULES.winScore) {
            this.over = true;
            this.broadcast({ t: 'win', id: me.id, name: me.name });
            setTimeout(() => this.players.size && this.resetMatch(), 5000);
          } else {
            setTimeout(() => {
              if (this.players.has(v.id) && v.dead) this.broadcast({ t: 'respawn', ...this.spawn(v) });
            }, RULES.respawnTime * 1000);
          }
        }
      }
    }
  }
}
