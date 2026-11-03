// 게임 판정 로직: 방장(먼저 들어온 사람) 브라우저에서 실행됩니다.
// 라운드제: 킬 1번 = 1라운드. 라운드마다 두 사람 모두 서로 안 보이는 먼 곳에서 다시 시작.
import { RULES, solidAABBs, rayAABB, playerHitboxes, pickSpawnPair, faceCenter } from './map.js';
import { statsFor, effWeapon, rollOptions, rollTier, hasCurse, stageInfo, RUN } from './augments.js';
import { DEFAULT_LOADOUT, rangeMul, rollGuns } from './guns.js';

const SOLIDS = solidAABBs();
const nowS = () => Date.now() / 1000;

export class GameRoom {
  // mode: 'duel'(온라인/일반 봇전) | 'run'(봇전 로그라이크)
  constructor(roomName, mode = 'duel') {
    this.roomName = roomName;
    this.mode = mode;
    this.players = new Map();
    this.nextId = 1;
    this.phase = 'waiting';   // waiting | countdown | live | roundEnd | pick | over
    this.round = 0;           // 끝난 라운드 수
    this.timers = [];
  }

  get over() { return this.phase === 'over'; }
  get stage() { return this.round + 1; }

  later(sec, fn) { const t = setTimeout(() => { this.timers = this.timers.filter(x => x !== t); fn(); }, sec * 1000); this.timers.push(t); }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  dispose() { this.clearTimers(); this.players.clear(); }

  broadcast(msg) { this.players.forEach(p => p.send(msg)); }
  scores() { return Object.fromEntries([...this.players.values()].map(p => [p.id, p.score])); }
  augInfo() { return Object.fromEntries([...this.players.values()].map(p => [p.id, p.augs])); }
  setPhase(phase, dur = 0, extra = {}) {
    this.phase = phase;
    this.broadcast({ t: 'phase', phase, dur, round: this.round + 1, ...extra });
  }

  // 총 2칸. 바뀐 총은 탄창을 가득 채움
  setLoadout(p, loadout) {
    p.loadout = [...loadout];
    for (const id of p.loadout) if (!(id in p.ammo)) p.ammo[id] = effWeapon(id, p.stats).mag;
    this.broadcast({ t: 'loadout', id: p.id, loadout: p.loadout });
  }

  setAugs(p, augs) {
    p.augs = augs;
    p.stats = statsFor(augs);
    this.broadcast({ t: 'augs', id: p.id, augs: p.augs });
  }

  resetBody(p, pos, bonusHp = 0) {
    p.pos = pos;
    p.maxHp = p.stats.maxHp + (p.hpBonus || 0);
    p.hp = p.maxHp + bonusHp;
    p.dead = false;
    p.ammo = Object.fromEntries(p.loadout.map(k => [k, effWeapon(k, p.stats).mag]));
    p.reloadEnd = 0;
    p.reviveUsed = false;
    p.invulnUntil = 0;
    p.ghostUntil = 0;
  }

  // 새 플레이어 입장. 가득 찼으면 null
  join(name, send, opts = {}) {
    if (this.players.size >= 2) { send({ t: 'full' }); return null; }
    const me = {
      id: this.nextId++, send, name: String(name || 'Player').slice(0, 16), score: 0,
      yaw: 0, pitch: 0, lastShot: 0, augs: [], stats: statsFor([]), isBot: !!opts.isBot,
      autoPick: opts.autoPick || null, hpBonus: 0, ghostReadyAt: 0, loadout: [...DEFAULT_LOADOUT], ammo: {},
    };
    this.players.set(me.id, me);
    const [a, b] = pickSpawnPair();
    const other = [...this.players.values()].find(p => p !== me);
    let spot = a;
    if (other) spot = Math.hypot(a[0] - other.pos[0], a[2] - other.pos[2]) > Math.hypot(b[0] - other.pos[0], b[2] - other.pos[2]) ? a : b;
    this.resetBody(me, spot);
    const others = [...this.players.values()].filter(p => p !== me)
      .map(p => ({ id: p.id, name: p.name, pos: p.pos, yaw: p.yaw, hp: p.hp, dead: p.dead, augs: p.augs, loadout: p.loadout }));
    send({
      t: 'welcome', id: me.id, loadout: me.loadout, pos: me.pos, yaw: faceCenter(me.pos[0], me.pos[2]), hp: me.hp, maxHp: me.maxHp,
      room: this.roomName, mode: this.mode, others, scores: this.scores(), winRounds: RULES.winRounds,
    });
    this.players.forEach(p => p !== me && p.send({ t: 'join', id: me.id, name: me.name, pos: me.pos, yaw: 0, hp: me.hp, augs: me.augs, loadout: me.loadout }));
    this.broadcast({ t: 'scores', scores: this.scores() });
    if (this.players.size === 2) this.later(1, () => this.startMatch());
    return me.id;
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    this.clearTimers();
    this.broadcast({ t: 'leave', id });
    this.players.forEach(p => { p.score = 0; this.setAugs(p, []); this.setLoadout(p, DEFAULT_LOADOUT); });
    this.round = 0;
    this.setPhase('waiting');
    this.broadcast({ t: 'scores', scores: this.scores() });
  }

  startMatch() {
    this.clearTimers();
    this.round = 0; this.pickNo = 0;
    this.players.forEach(p => { p.score = 0; p.hpBonus = 0; this.setAugs(p, []); this.setLoadout(p, DEFAULT_LOADOUT); });
    if (this.mode === 'run') this.prepareStage();
    this.broadcast({ t: 'scores', scores: this.scores() });
    this.startRound();
  }

  // 봇전 런: 스테이지에 맞게 봇 강화
  prepareStage() {
    const info = stageInfo(this.stage);
    for (const p of this.players.values()) {
      if (!p.isBot) continue;
      p.hpBonus = info.hpBonus;
      const augs = [...p.augs];
      // 봇은 스테이지가 높을수록 높은 등급 증강 (이단점프/대시/첨단시야는 봇이 못 씀)
      const tier = this.stage >= 8 ? 'prism' : this.stage >= 4 ? 'gold' : 'silver';
      while (augs.length < info.augs) {
        const opts = rollOptions(augs, tier, false, Math.random, ['djump', 'dash', 'radar']);
        if (!opts.length) break;
        augs.push(opts[0]);
      }
      if (augs.length !== p.augs.length) this.setAugs(p, augs);
      if (info.loadout && info.loadout.join() !== p.loadout.join()) this.setLoadout(p, info.loadout);
    }
    this.broadcast({ t: 'stage', stage: this.stage, total: RUN.stages, ...info });
  }

  startRound() {
    const list = [...this.players.values()];
    const [a, b] = pickSpawnPair();
    list.forEach((p, i) => {
      const other = list[1 - i];
      // 3점 이상 뒤지면 이번 라운드 체력 +20 (온라인/일반 봇전)
      const behind = this.mode === 'duel' && other && other.score - p.score >= 3 ? 20 : 0;
      this.resetBody(p, i === 0 ? a : b, behind);
      this.broadcast({ t: 'respawn', id: p.id, pos: p.pos, yaw: faceCenter(p.pos[0], p.pos[2]), hp: p.hp, maxHp: p.maxHp, bonus: behind });
    });
    this.setPhase('countdown', RULES.countdown);
    this.later(RULES.countdown, () => this.setPhase('live'));
  }

  endRound(killer, victim) {
    this.round++;
    this.setPhase('roundEnd', RULES.roundEndTime);
    if (this.mode === 'run') {
      if (!victim.isBot) {
        // 런 실패
        this.later(1.2, () => { this.phase = 'over'; this.broadcast({ t: 'runover', stage: this.round, cleared: this.round - 1 }); });
        return;
      }
      if (this.round >= RUN.stages) {
        this.later(1.2, () => { this.phase = 'over'; this.broadcast({ t: 'runclear', stage: this.round }); });
        return;
      }
      this.later(RULES.roundEndTime, () => this.startPick(true));
      return;
    }
    if (killer.score >= RULES.winRounds) {
      this.later(1.2, () => {
        this.phase = 'over';
        this.broadcast({ t: 'win', id: killer.id, name: killer.name });
        this.later(6, () => this.players.size === 2 && this.startMatch());
      });
      return;
    }
    if (RULES.augmentRounds.includes(this.round)) this.later(RULES.roundEndTime, () => this.startPick(false));
    else this.later(RULES.roundEndTime, () => this.startRound());
  }

  // 증강 선택. run이면 사람만 고르고 봇은 스테이지 설정으로 강화
  startPick(runMode) {
    const list = [...this.players.values()];
    const pickers = runMode ? list.filter(p => !p.isBot) : list;
    const top = Math.max(...list.map(p => p.score));
    this.pickers = new Set(pickers.map(p => p.id));
    this.setPhase('pick', RULES.pickTime);
    // 이번 선택의 등급은 모두 같음. 저주 카드는 선택마다 번갈아 1장 추가
    const n = this.pickNo || 0;
    this.pickNo = n + 1;
    this.pickTier = rollTier(this.mode, runMode ? this.round : n); // 런: 방금 깬 스테이지 번호
    this.pickCurse = hasCurse(n);
    for (const p of pickers) {
      p.gunOpts = null;
      p.pickOpts = rollOptions(p.augs, this.pickTier, this.pickCurse);
      // 뒤지고 있으면 새로고침 1번 (런은 매번 1번)
      p.rerolls = runMode ? 1 : (p.score < top ? 1 : 0);
      if (p.autoPick) this.later(0.8 + Math.random(), () => this.message(p.id, { t: 'pick', id: p.pickOpts[Math.floor(Math.random() * p.pickOpts.length)] }));
      else p.send({ t: 'pick', opts: p.pickOpts, rerolls: p.rerolls, dur: RULES.pickTime, tier: this.pickTier, curse: this.pickCurse });
    }
    this.later(RULES.pickTime, () => {
      if (this.phase !== 'pick') return;
      // 증강을 아직 안 고른 사람은 첫 카드로 정하고 총 선택으로 넘어감
      for (const id of [...this.pickers]) { const p = this.players.get(id); if (p && !p.gunOpts) this.message(id, { t: 'pick', id: p.pickOpts[0] }); }
    });
  }

  // 증강을 고른 뒤 총 3개 중 하나를 골라 2칸 중 하나와 바꾸거나 패스
  startGunPick(p) {
    p.gunOpts = rollGuns(p.loadout, 3);
    // 사람은 시간 제한 없이 고를 때까지 기다림 (사용자 요청: 시간 초과 자동 패스 없음)
    if (p.autoPick) this.later(0.6 + Math.random() * 0.6, () => this.message(p.id, { t: 'gunpick', pass: true }));
    else p.send({ t: 'gunpick', opts: p.gunOpts, loadout: p.loadout, dur: 0 });
  }

  finishPickIfDone() {
    if (this.phase !== 'pick' || this.pickers.size) return;
    this.clearTimers();
    if (this.mode === 'run') this.prepareStage();
    this.startRound();
  }

  // 재장전 시간이 지났으면 탄창 채움 (네트워크 지연 여유 0.15초)
  finishReload(p, now) {
    if (p.reloadEnd && p.reloadEnd <= now + 0.15) { p.ammo[p.reloadW] = effWeapon(p.reloadW, p.stats).mag; p.reloadEnd = 0; }
  }

  damage(shooter, victim, base, head, now) {
    if (victim.invulnUntil > now) return { dmg: 0, killed: false };
    const s = shooter.stats;
    let dmg = base * (head ? s.headMul : 1) * s.dmgMul;
    if (s.gambler) dmg *= s.gambler[0] + Math.random() * (s.gambler[1] - s.gambler[0]);
    dmg = Math.round(dmg);
    victim.hp -= dmg;
    let revived = false;
    if (victim.hp <= 0 && victim.stats.revive && !victim.reviveUsed) {
      victim.hp = Math.min(victim.maxHp, victim.stats.revive); victim.reviveUsed = true; victim.invulnUntil = now + 2; revived = true;
    }
    if (s.lifesteal && !shooter.dead) {
      shooter.hp = Math.min(shooter.maxHp, shooter.hp + Math.round(dmg * s.lifesteal));
      this.broadcast({ t: 'hp', id: shooter.id, hp: shooter.hp });
    }
    if (victim.stats.ghost && victim.hp > 0 && now >= victim.ghostReadyAt) {
      const [gd, gc] = victim.stats.ghost;
      victim.ghostUntil = now + gd; victim.ghostReadyAt = now + gc;
      this.broadcast({ t: 'ghost', id: victim.id, dur: gd });
    }
    if (s.radar) shooter.send({ t: 'reveal', target: victim.id, dur: s.radar });
    if (revived) this.broadcast({ t: 'revive', id: victim.id, dur: 2 });
    return { dmg, killed: victim.hp <= 0 };
  }

  // 총알 1개 궤적: 벽(관통탄이면 첫 벽 너머까지)과 사람 판정
  trace(me, o, d) {
    const walls = [];
    for (const b of SOLIDS) {
      const t = rayAABB(o, d, b);
      if (t < Infinity) {
        // 박스를 빠져나가는 지점 = 반대 방향에서 들어오는 지점
        const far = o.map((v, i) => v + d[i] * 400);
        const back = rayAABB(far, d.map(v => -v), b);
        walls.push({ t, exit: 400 - back });
      }
    }
    walls.sort((a, b) => a.t - b.t);
    const firstWall = walls[0]?.t ?? 200;
    let limit = firstWall, pierced = false;
    if (me.stats.pierce && walls.length) {
      const exit = walls[0].exit;
      const next = walls.find(w => w.t > exit + 1e-4);
      limit = Math.min(next ? next.t : 200, 200);
      pierced = true;
    }
    let hit = null, endT = firstWall;
    for (const p of this.players.values()) {
      if (p === me || p.dead) continue;
      const hb = playerHitboxes(p.pos);
      const th = rayAABB(o, d, hb.head), tb = rayAABB(o, d, hb.body);
      const t = Math.min(th, tb);
      if (t < limit && (!hit || t < hit.t)) hit = { p, head: th <= tb, t, through: t > firstWall };
    }
    if (hit) endT = hit.t;
    else if (pierced) endT = limit;
    return { hit, end: o.map((v, i) => v + d[i] * endT), pierced: pierced && (hit ? hit.through : true), firstWall };
  }

  message(id, m) {
    const me = this.players.get(id);
    if (!me || !m) return;

    if (m.t === 'state' && !me.dead) {
      if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
      me.pos = m.p; me.yaw = +m.yaw || 0; me.pitch = +m.pitch || 0;
      me.w = me.loadout.includes(m.w) ? m.w : me.loadout[0];
      this.players.forEach(p => p !== me && p.send({ t: 'state', id: me.id, p: me.pos, yaw: me.yaw, pitch: me.pitch, w: me.w, ads: !!m.ads, air: !!m.air }));
    }

    if (m.t === 'pick' && this.phase === 'pick' && this.pickers?.has(me.id) && !me.gunOpts && me.pickOpts?.includes(m.id)) {
      this.setAugs(me, [...me.augs, m.id]);
      me.send({ t: 'picked', id: m.id });
      this.startGunPick(me);
    }
    // 총 선택: { id, slot } 또는 { pass: true }
    if (m.t === 'gunpick' && this.phase === 'pick' && this.pickers?.has(me.id) && me.gunOpts) {
      if (!m.pass && me.gunOpts.includes(m.id) && (m.slot === 0 || m.slot === 1)) {
        const lo = [...me.loadout]; lo[m.slot] = m.id;
        this.setLoadout(me, lo);
      }
      me.gunOpts = null;
      this.pickers.delete(me.id);
      me.send({ t: 'gunpicked', id: m.pass ? null : m.id });
      this.finishPickIfDone();
    }
    if (m.t === 'reroll' && this.phase === 'pick' && this.pickers?.has(me.id) && me.rerolls > 0) {
      me.rerolls--;
      me.pickOpts = rollOptions(me.augs, this.pickTier, this.pickCurse);
      me.send({ t: 'pick', opts: me.pickOpts, rerolls: me.rerolls, reroll: true, tier: this.pickTier, curse: this.pickCurse });
    }

    // 재장전: 방장이 탄약 수를 관리
    if (m.t === 'reload' && !me.dead && me.loadout.includes(m.w)) {
      const now = nowS();
      this.finishReload(me, now);
      const W = effWeapon(m.w, me.stats);
      if (me.reloadEnd > now || me.ammo[m.w] >= W.mag) return;
      me.reloadEnd = now + W.reload;
      me.reloadW = m.w;
    }

    if (m.t === 'shoot' && !me.dead && (this.phase === 'live' || this.phase === 'waiting')) {
      const now = nowS();
      if (!me.loadout.includes(m.w)) return;                // 가진 총만
      const wname = m.w, W = effWeapon(wname, me.stats);
      this.finishReload(me, now);
      if (me.reloadEnd > now) return;                      // 재장전 중
      if (!(me.ammo[wname] > 0)) return;                   // 탄 없음
      if (now - me.lastShot < W.interval * 0.5) return;    // 연사 제한 (네트워크 지연 여유)
      me.lastShot = now;
      const lastFive = me.stats.lastFive && me.ammo[wname] <= me.stats.lastFive;
      me.ammo[wname]--;

      const o = [me.pos[0], me.pos[1] + 1.6, me.pos[2]];
      let d = m.dir;
      if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return;
      const len = Math.hypot(...d) || 1; d = d.map(v => v / len);

      // 샷건: 방장이 산탄 방향을 만듦 (보낸 방향 둘레로 퍼짐)
      const dirs = [d];
      if (W.pellets > 1) {
        dirs.length = 0;
        // d에 수직인 두 축 u, v
        let u = [-d[2], 0, d[0]]; const ul = Math.hypot(...u) || 1; u = ul > 1e-6 ? u.map(x => x / ul) : [1, 0, 0];
        const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
        for (let i = 0; i < W.pellets; i++) {
          const r = W.pelletSpread * (m.ads ? 0.7 : 1) * Math.sqrt(Math.random()) * (i ? 1 : 0.3), a = Math.random() * Math.PI * 2;
          const q = d.map((x, k) => x + (u[k] * Math.cos(a) + v[k] * Math.sin(a)) * r);
          const l = Math.hypot(...q); dirs.push(q.map(x => x / l));
        }
      }
      const rays = dirs.map(dd => this.trace(me, o, dd));
      this.broadcast({ t: 'shot', id: me.id, o, w: wname, rays: rays.map(r => ({ end: r.end, hit: !!r.hit, pierced: r.pierced, wallT: r.firstWall })) });

      // 맞은 사람별로 모아서 한 번에 판정 (샷건 여러 알)
      const byVictim = new Map();
      for (const r of rays) {
        if (!r.hit) continue;
        let base = (r.hit.head ? W.head * me.stats.headMul : W.body) * rangeMul(W, r.hit.t);
        if (lastFive) base *= 2;
        if (r.hit.through) base *= me.stats.pierce;
        const e = byVictim.get(r.hit.p) || { base: 0, head: false, at: r.end, through: false, n: 0 };
        e.base += base; e.head ||= r.hit.head; e.through ||= r.hit.through; e.n++;
        if (r.hit.head) e.at = r.end;
        byVictim.set(r.hit.p, e);
      }
      for (const [v, e] of byVictim) {
        const { dmg, killed } = this.damage(me, v, e.base, false, now);
        this.broadcast({ t: 'hit', target: v.id, by: me.id, hp: Math.max(0, v.hp), dmg, head: e.head, w: wname, from: o, at: e.at, through: e.through, pellets: e.n });
        if (killed && this.phase === 'live') {
          v.dead = true;
          me.score++;
          this.broadcast({ t: 'kill', killer: me.id, victim: v.id, head: e.head, w: wname, scores: this.scores(), from: o });
          this.endRound(me, v);
        } else if (killed) {
          // 대기 중(상대 없음)에는 그냥 체력만 회복
          v.hp = v.maxHp;
        }
      }
    }
  }
}
