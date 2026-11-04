// 게임 판정 로직: 방장(먼저 들어온 사람) 브라우저에서 실행됩니다.
// 라운드제: 킬 1번 = 1라운드. 라운드마다 두 사람 모두 서로 안 보이는 먼 곳에서 다시 시작.
import { RULES, solidAABBs, rayAABB, playerHitboxes, pickSpawnPair, SPAWN_POINTS, canSee, faceCenter, setMap, currentMap, MAPS, eyeHeight, rightOf, POSE, BOXES, isWood, CRATE_HP, breakBox, lineOfSight } from './map.js';
import { NADE, simNade } from './physics.js';
import { gameNow } from './clock.js';
import { findPath } from './bot.js';
import { statsFor, effWeapon, rollOptions, rollTier, hasCurse, stageInfo, RUN } from './augments.js';
import { DEFAULT_LOADOUT, GUNS, rangeMul, rollGuns } from './guns.js';
import { newKit, rollGrade, rollLoot, cardPrice, ARMOR, ITEMS, MAX_ITEMS, REST } from './loot.js';

const SOLIDS = solidAABBs();

// 라운드 스폰: 두 사람이 서로에게 가는 길을 따라 걸을 때 오래 안 보이는 쌍을 고름
// (2026-11-04 테스트: 스폰 자리만 안 보이는 쌍을 고르면 대부분 2초 안에 서로 보였음)
// 맵마다 한 번만 계산해서 기억
const spawnCache = {};
const along = (path, s, dist) => {
  let p = { x: s[0], z: s[2] }, left = dist;
  for (const w of path) { const d = Math.hypot(w.x - p.x, w.z - p.z); if (d >= left) return [p.x + (w.x - p.x) * left / d, 0, p.z + (w.z - p.z) * left / d]; left -= d; p = w; }
  return [p.x, 0, p.z];
};
function spawnPair() {
  const mi = currentMap();
  if (!spawnCache[mi]) {
    const pts = SPAWN_POINTS.map(([x, z]) => [x, 0, z]), list = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      if (canSee(a, b)) continue;
      const pa = findPath({ x: a[0], z: a[2] }, { x: b[0], z: b[2] }), pb = findPath({ x: b[0], z: b[2] }, { x: a[0], z: a[2] });
      let first = 30;
      for (let k = 2; k <= 30; k += 2) if (canSee(along(pa, a, k), along(pb, b, k))) { first = k; break; }
      list.push({ a, b, first, d: Math.hypot(a[0] - b[0], a[2] - b[2]) });
    }
    const best = Math.max(...list.map(p => p.first));
    spawnCache[mi] = list.filter(p => p.first >= best - 4).sort((x, y) => y.first - x.first || y.d - x.d).slice(0, 8);
  }
  const top = spawnCache[mi];
  if (!top.length) return pickSpawnPair();
  const p = top[Math.floor(Math.random() * top.length)];
  return Math.random() < 0.5 ? [p.a, p.b] : [p.b, p.a];
}
const nowS = gameNow;

export class GameRoom {
  // mode: 'duel'(온라인/일반 봇전) | 'run'(봇전 로그라이크)
  // waitReady: 봇전·런은 사람이 '클릭해서 시작'을 누른 뒤에 경기를 시작함
  constructor(roomName, mode = 'duel', { waitReady = false } = {}) {
    this.roomName = roomName;
    this.waitReady = waitReady; this.ready = !waitReady;
    this.mode = mode;
    this.players = new Map();
    this.nextId = 1;
    this.phase = 'waiting';   // waiting | countdown | live | roundEnd | pick | over
    this.round = 0;           // 끝난 라운드 수
    this.timers = [];
  }

  get over() { return this.phase === 'over'; }
  get stage() { return this.round + 1; }

  // 예약 작업. 일시정지(봇전·런)하면 남은 시간을 기억했다가 이어서 돎
  later(sec, fn) {
    const job = { fn, due: nowS() + sec, h: null };
    const arm = () => { job.h = setTimeout(() => { this.timers = this.timers.filter(x => x !== job); fn(); }, Math.max(0, job.due - nowS()) * 1000); };
    job.arm = arm;
    if (!this.paused) arm();
    this.timers.push(job);
  }
  clearTimers() { this.timers.forEach(j => clearTimeout(j.h)); this.timers = []; }
  setPaused(v) {
    if (!!v === !!this.paused) return;
    this.paused = !!v;
    // 시계(gameNow)는 밖에서 멈추므로 due는 그대로 두고 타이머만 끄고 켬
    for (const j of this.timers) { clearTimeout(j.h); j.h = null; if (!v) j.arm(); }
  }
  dispose() { this.clearTimers(); this.players.clear(); }

  broadcast(msg) { this.players.forEach(p => p.send(msg)); }
  scores() { return Object.fromEntries([...this.players.values()].map(p => [p.id, p.score])); }
  augInfo() { return Object.fromEntries([...this.players.values()].map(p => [p.id, p.augs])); }
  setPhase(phase, dur = 0, extra = {}) {
    this.phase = phase;
    this.broadcast({ t: 'phase', phase, dur, round: this.round + 1, ...extra });
  }

  // 이 총이 들어 있는 칸의 등급·부착물
  mod(p, id) { const i = p.loadout.indexOf(id); return i >= 0 ? p.kit.mods[i] : null; }
  W(p, id) { return effWeapon(id, p.stats, this.mod(p, id)); }
  // 총 2칸 + 장비. 바뀐 총은 탄창을 가득 채움
  setLoadout(p, loadout, kit) {
    p.loadout = [...loadout];
    if (kit) p.kit = kit;
    for (const id of p.loadout) if (!(id in p.ammo)) p.ammo[id] = this.W(p, id).mag;
    this.sendKit(p);
  }
  sendKit(p) { this.broadcast({ t: 'loadout', id: p.id, loadout: p.loadout, kit: p.kit, gold: p.gold || 0 }); }

  setAugs(p, augs) {
    p.augs = augs;
    p.stats = statsFor(augs);
    this.broadcast({ t: 'augs', id: p.id, augs: p.augs });
  }

  resetBody(p, pos, bonusHp = 0) {
    p.pos = pos; p.cr = 0; p.ln = 0; p.nades = { frag: 1, flash: 1 };
    p.maxHp = p.stats.maxHp + (p.hpBonus || 0);
    p.hp = p.maxHp + bonusHp;
    p.capHp = p.hp;   // 이번 라운드 회복 상한 (뒤질 때 보너스 포함)
    p.dead = false;
    p.ammo = Object.fromEntries(p.loadout.map(k => [k, this.W(p, k).mag]));
    p.lifeId = (p.lifeId || 0) + 1; p.usingUntil = 0;
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
      autoPick: opts.autoPick || null, hpBonus: 0, ghostReadyAt: 0, loadout: [...DEFAULT_LOADOUT], ammo: {}, kit: newKit(), gold: 0,
    };
    this.players.set(me.id, me);
    const [a, b] = pickSpawnPair();
    const other = [...this.players.values()].find(p => p !== me);
    let spot = a;
    if (other) spot = Math.hypot(a[0] - other.pos[0], a[2] - other.pos[2]) > Math.hypot(b[0] - other.pos[0], b[2] - other.pos[2]) ? a : b;
    this.resetBody(me, spot);
    const others = [...this.players.values()].filter(p => p !== me)
      .map(p => ({ id: p.id, name: p.name, pos: p.pos, yaw: p.yaw, hp: p.hp, dead: p.dead, augs: p.augs, loadout: p.loadout, kit: p.kit }));
    send({
      t: 'welcome', id: me.id, loadout: me.loadout, kit: me.kit, pos: me.pos, yaw: faceCenter(me.pos[0], me.pos[2]), hp: me.hp, maxHp: me.maxHp,
      room: this.roomName, mode: this.mode, map: currentMap(), others, scores: this.scores(), winRounds: RULES.winRounds,
    });
    this.players.forEach(p => p !== me && p.send({ t: 'join', id: me.id, name: me.name, pos: me.pos, yaw: 0, hp: me.hp, augs: me.augs, loadout: me.loadout, kit: me.kit }));
    this.broadcast({ t: 'scores', scores: this.scores() });
    if (this.players.size === 2 && this.ready) this.later(1, () => this.startMatch());
    return me.id;
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    this.clearTimers();
    this.broadcast({ t: 'leave', id });
    this.players.forEach(p => { p.score = 0; p.gold = 0; this.setAugs(p, []); this.setLoadout(p, DEFAULT_LOADOUT, newKit()); });
    this.round = 0;
    this.setPhase('waiting');
    this.broadcast({ t: 'scores', scores: this.scores() });
  }

  startMatch() {
    this.clearTimers();
    this.round = 0; this.pickNo = 0;
    this.players.forEach(p => { p.score = 0; p.hpBonus = 0; p.gold = 0; this.setAugs(p, []); this.setLoadout(p, DEFAULT_LOADOUT, newKit()); });
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
      // 봇 방어구: 스테이지가 오를수록 단단해짐
      const s = this.stage, armor = { helmet: s >= 8 ? 2 : s >= 5 ? 1 : 0, vest: s >= 10 ? 1 : s >= 9 ? 3 : s >= 6 ? 2 : s >= 4 ? 1 : 0 };
      const kit = { ...p.kit, armor };
      if ((info.loadout && info.loadout.join() !== p.loadout.join()) || JSON.stringify(armor) !== JSON.stringify(p.kit.armor)) this.setLoadout(p, info.loadout || p.loadout, kit);
    }
    this.broadcast({ t: 'stage', stage: this.stage, total: RUN.stages, ...info });
  }

  startRound() {
    const list = [...this.players.values()];
    // 맵: 대결은 라운드마다, 런은 스테이지마다 바뀜
    const mi = (this.mode === 'run' ? (this.stage || 1) - 1 : this.round) % MAPS.length;
    setMap(mi, true);   // 부서진 상자도 되살림
    this.crateHp = {};
    this.broadcast({ t: 'map', i: mi, name: MAPS[mi].name });
    const [a, b] = spawnPair();
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
      // 런 골드: 스테이지 클리어 보상 (다음 상점에서 사용)
      killer.gold = (killer.gold || 0) + 40 + 10 * this.round;
      this.sendKit(killer);
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
    // 봇전·런은 증강도 총 선택처럼 시간 제한 없음 (온라인은 상대를 기다리게 하지 않게 12초)
    const dur = this.waitReady ? 0 : RULES.pickTime;
    this.setPhase('pick', dur);
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
      else p.send({ t: 'pick', opts: p.pickOpts, rerolls: p.rerolls, dur, tier: this.pickTier, curse: this.pickCurse });
    }
    if (dur) this.later(dur, () => {
      if (this.phase !== 'pick') return;
      // 증강을 아직 안 고른 사람은 첫 카드로 정하고 총 선택으로 넘어감
      for (const id of [...this.pickers]) { const p = this.players.get(id); if (p && p.pickOpts && !p.gunOpts) this.message(id, { t: 'pick', id: p.pickOpts[0] }); }
    });
  }

  // 증강을 고른 뒤 총 3개 중 하나를 골라 2칸 중 하나와 바꾸거나 패스
  // 등급 단계: 대결은 몇 번째 선택인지, 런은 스테이지
  lootLevel() { return this.mode === 'run' ? Math.floor(this.round / 3) : Math.max(0, (this.pickNo || 1) - 1); }
  startGunPick(p) {
    p.gunOpts = rollGuns(p.loadout, 3).map(id => ({ id, grade: rollGrade(this.lootLevel()) }));
    // 사람은 시간 제한 없이 고를 때까지 기다림 (사용자 요청: 시간 초과 자동 패스 없음)
    // 봇: 반쯤은 새 총을 집음 (저격·지정사수는 2번 칸, 나머지는 1번 칸)
    if (p.autoPick) this.later(0.6 + Math.random() * 0.6, () => {
      const o = p.gunOpts?.[Math.floor(Math.random() * p.gunOpts.length)];
      const far = o && (GUNS[o.id]?.cls === 'sniper' || GUNS[o.id]?.cls === 'dmr');
      this.message(p.id, o && this.mode === 'duel' && Math.random() < 0.55 ? { t: 'gunpick', id: o.id, slot: far ? 1 : 0 } : { t: 'gunpick', pass: true });
    });
    else p.send({ t: 'gunpick', opts: p.gunOpts, loadout: p.loadout, dur: 0 });
  }

  // 파밍 카드 3장 (대결)
  startLootPick(p) {
    p.lootOpts = rollLoot(3, this.lootLevel());
    if (p.autoPick) {
      // 봇: 아무거나 하나 (부착물은 무작위 칸)
      this.later(0.5 + Math.random() * 0.5, () => this.message(p.id, { t: 'loot', i: Math.floor(Math.random() * 3), slot: Math.random() < 0.5 ? 0 : 1 }));
    } else p.send({ t: 'loot', opts: p.lootOpts, loadout: p.loadout, kit: p.kit });
  }
  // 런 상점 5칸
  startShop(p) {
    p.shop = rollLoot(5, this.lootLevel()).map(c => ({ ...c, price: cardPrice(c), sold: false }));
    // 3스테이지마다 휴식 카드(무료) 1장 추가
    if (this.round % 3 === 0) p.shop.unshift({ kind: 'rest', price: 0, sold: false });
    p.send({ t: 'shop', items: p.shop, gold: p.gold, open: true });
  }
  giveCard(p, c, slot) {
    const kit = structuredClone(p.kit);
    if (c.kind === 'part') { if (slot !== 0 && slot !== 1) return; kit.mods[slot].parts[c.part] = c.lv; }
    else if (c.kind === 'rest') { p.hpBonus = (p.hpBonus || 0) + REST.hp; }
    else if (c.kind === 'armor') kit.armor[c.part] = Math.max(kit.armor[c.part] | 0, c.lv);
    else kit.items[c.part] = Math.min(MAX_ITEMS, (kit.items[c.part] | 0) + 1);
    p.kit = kit;
    // 탄창이 커졌으면 지금 탄도 그만큼 (다음 라운드엔 어차피 가득)
    this.sendKit(p);
  }

  finishPickIfDone() {
    if (this.phase !== 'pick' || this.pickers.size) return;
    this.clearTimers();
    if (this.mode === 'run') this.prepareStage();
    this.startRound();
  }

  // 나무 상자 체력. 0이 되면 부서짐 (판정에서 빠짐)
  hitCrate(i, dmg) {
    const hp = (this.crateHp[i] ?? CRATE_HP) - dmg;
    this.crateHp[i] = hp;
    if (hp <= 0 && breakBox(i)) this.broadcast({ t: 'break', i });
  }
  // 수류탄 피해 (자기 수류탄에 죽으면 상대 점수)
  nadeHurt(att, v, base, at) {
    const now = nowS();
    const { dmg, killed } = this.damage(att, v, base, false, now);
    if (!dmg) return;
    this.broadcast({ t: 'hit', target: v.id, by: att.id, hp: Math.max(0, Math.round(v.hp)), dmg, head: false, part: 'body', w: 'nade', from: at, at: [v.pos[0], v.pos[1] + 1, v.pos[2]] });
    if (killed && this.phase === 'live') {
      v.dead = true;
      const killer = att === v ? ([...this.players.values()].find(p => p !== v) || att) : att;
      killer.score++;
      this.broadcast({ t: 'kill', killer: killer.id, victim: v.id, head: false, w: 'nade', self: att === v, scores: this.scores(), from: at });
      this.endRound(killer, v);
    } else if (killed) v.hp = v.maxHp;
  }
  explode(kind, pos, by, round, nid) {
    this.broadcast({ t: 'boom', kind, p: pos, by, nid });
    if (round !== this.round || !(this.phase === 'live' || this.phase === 'waiting')) return;
    const N = NADE[kind], att = this.players.get(by);
    if (kind === 'frag') {
      // 나무 상자는 가까우면 부서짐
      BOXES.forEach((b, i) => { if (isWood(b) && Math.hypot(Math.max(0, Math.abs(pos[0] - b.x) - b.w / 2), Math.max(0, Math.abs(pos[2] - b.z) - b.d / 2)) < 3) this.hitCrate(i, 999); });
      for (const v of [...this.players.values()]) {
        if (v.dead) continue;
        const c = [v.pos[0], v.pos[1] + 0.9, v.pos[2]], dd = Math.hypot(c[0] - pos[0], c[1] - pos[1], c[2] - pos[2]);
        if (dd > N.radius || !lineOfSight([pos[0], pos[1] + 0.25, pos[2]], c)) continue;
        const vest = ARMOR.vest.red[v.kit?.armor?.vest | 0];
        const base = N.dmg * Math.pow(1 - dd / N.radius, 1.2) * (1 - vest) * (v === att ? 0.6 : 1);
        if (base >= 1 && att) this.nadeHurt(att, v, base, pos);
      }
    } else {
      for (const v of this.players.values()) {
        if (v.dead) continue;
        const [rx, rz] = rightOf(v.yaw), lo = (v.ln || 0) * POSE.leanEye;
        const eye = [v.pos[0] + rx * lo, v.pos[1] + eyeHeight(v.cr), v.pos[2] + rz * lo];
        const dx = pos[0] - eye[0], dy = pos[1] - eye[1], dz = pos[2] - eye[2], dd = Math.hypot(dx, dy, dz);
        if (dd > N.radius || !lineOfSight([pos[0], pos[1] + 0.25, pos[2]], eye)) continue;
        // 바라보는 방향일수록 오래 눈이 멂
        const cp = Math.cos(v.pitch || 0), f = [-Math.sin(v.yaw) * cp, Math.sin(v.pitch || 0), -Math.cos(v.yaw) * cp];
        const dot = (f[0] * dx + f[1] * dy + f[2] * dz) / Math.max(dd, 0.01);
        const dur = (dot > 0.5 ? 3.2 : dot > 0 ? 2.0 : 0.8) * (1 - 0.5 * dd / N.radius);
        this.broadcast({ t: 'flash', id: v.id, dur: +dur.toFixed(2) });
      }
    }
  }

  // 재장전 시간이 지났으면 탄창 채움 (네트워크 지연 여유 0.15초)
  finishReload(p, now) {
    if (p.reloadEnd && p.reloadEnd <= now + 0.15) { p.ammo[p.reloadW] = this.W(p, p.reloadW).mag; p.reloadEnd = 0; }
  }

  // syn: 총 등급 시너지 (희귀 이상이면 증강의 데미지 보너스가 더 커짐)
  damage(shooter, victim, base, head, now, syn = 1) {
    if (victim.invulnUntil > now) return { dmg: 0, killed: false };
    const s = shooter.stats;
    let dmg = base * (head ? s.headMul : 1) * (1 + (s.dmgMul - 1) * (s.dmgMul > 1 ? syn : 1));
    if (s.gambler) dmg *= s.gambler[0] + Math.random() * (s.gambler[1] - s.gambler[0]);
    dmg = Math.round(dmg);
    victim.hp -= dmg;
    let revived = false;
    if (victim.hp <= 0 && victim.stats.revive && !victim.reviveUsed) {
      victim.hp = Math.min(victim.capHp ?? victim.maxHp, victim.stats.revive); victim.reviveUsed = true; victim.invulnUntil = now + 2; revived = true;
    }
    if (s.lifesteal && !shooter.dead) {
      shooter.hp = Math.min(shooter.capHp ?? shooter.maxHp, shooter.hp + Math.round(dmg * s.lifesteal));
      this.broadcast({ t: 'hp', id: shooter.id, hp: Math.round(shooter.hp) });
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
    SOLIDS.forEach((b, bi) => {
      const t = rayAABB(o, d, b);
      if (t < Infinity) {
        // 박스를 빠져나가는 지점 = 반대 방향에서 들어오는 지점
        const far = o.map((v, i) => v + d[i] * 400);
        const back = rayAABB(far, d.map(v => -v), b);
        walls.push({ t, exit: 400 - back, i: bi });
      }
    });
    walls.sort((a, b) => a.t - b.t);
    const firstWall = walls[0]?.t ?? 200, wallIdx = walls[0]?.i ?? -1;
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
      const hb = playerHitboxes(p.pos, { cr: p.cr, ln: p.ln, yaw: p.yaw });
      const th = rayAABB(o, d, hb.head), tb = rayAABB(o, d, hb.body);
      const t = Math.min(th, tb);
      // 부위: 머리 / 몸통 / 다리 (몸통 판정의 아래쪽)
      const head = th <= tb, leg = !head && o[1] + d[1] * t < hb.legTop;
      if (t < limit && (!hit || t < hit.t)) hit = { p, head, leg, t, through: t > firstWall };
    }
    if (hit) endT = hit.t;
    else if (pierced) endT = limit;
    return { hit, end: o.map((v, i) => v + d[i] * endT), pierced: pierced && (hit ? hit.through : true), firstWall, wallIdx };
  }

  message(id, m) {
    const me = this.players.get(id);
    if (!me || !m) return;

    // 봇전·런: 사람이 처음 클릭하면 경기 시작
    if (m.t === 'ready' && !this.ready) {
      this.ready = true;
      if (this.players.size === 2 && this.phase === 'waiting') this.later(0.3, () => this.startMatch());
      return;
    }
    // 무기를 바꾸면 재장전 취소
    if (m.t === 'reloadcancel') { me.reloadEnd = 0; return; }
    if (m.t === 'state' && !me.dead) {
      if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
      me.pos = m.p; me.yaw = +m.yaw || 0; me.pitch = +m.pitch || 0;
      me.cr = Math.max(0, Math.min(1, +m.cr || 0)); me.ln = Math.max(-1, Math.min(1, +m.ln || 0));
      me.w = me.loadout.includes(m.w) ? m.w : me.loadout[0];
      this.players.forEach(p => p !== me && p.send({ t: 'state', id: me.id, p: me.pos, yaw: me.yaw, pitch: me.pitch, w: me.w, ads: !!m.ads, air: !!m.air, cr: me.cr, ln: me.ln, sl: !!m.sl }));
    }

    if (m.t === 'pick' && this.phase === 'pick' && this.pickers?.has(me.id) && !me.gunOpts && me.pickOpts?.includes(m.id)) {
      this.setAugs(me, [...me.augs, m.id]);
      me.pickOpts = null;   // 한 번만 (시간 초과 자동 선택이 다시 걸리지 않게)
      me.send({ t: 'picked', id: m.id });
      this.startGunPick(me);
    }
    // 총 선택: { id, slot } 또는 { pass: true }
    if (m.t === 'gunpick' && this.phase === 'pick' && this.pickers?.has(me.id) && me.gunOpts) {
      const opt = me.gunOpts.find(o => o.id === m.id);
      if (!m.pass && opt && (m.slot === 0 || m.slot === 1)) {
        const lo = [...me.loadout]; lo[m.slot] = m.id;
        delete me.ammo[me.loadout[m.slot]];
        // 칸의 부착물은 그대로, 등급만 새 총 것으로
        const kit = structuredClone(me.kit); kit.mods[m.slot].grade = opt.grade;
        this.setLoadout(me, lo, kit);
      }
      me.gunOpts = null;
      me.send({ t: 'gunpicked', id: m.pass ? null : m.id });
      // 이어서 파밍: 대결은 카드 3장, 런은 상점
      if (this.mode === 'run') this.startShop(me); else this.startLootPick(me);
    }
    // 파밍 카드: { i, slot } 또는 { pass: true }
    if (m.t === 'loot' && this.phase === 'pick' && this.pickers?.has(me.id) && me.lootOpts) {
      const c = me.lootOpts[m.i];
      if (!m.pass && c) this.giveCard(me, c, m.slot);
      me.lootOpts = null;
      this.pickers.delete(me.id);
      me.send({ t: 'lootpicked' });
      this.finishPickIfDone();
    }
    // 런 상점: 사기 / 끝내기
    if (m.t === 'buy' && this.phase === 'pick' && this.pickers?.has(me.id) && me.shop) {
      const c = me.shop[m.i];
      if (c && !c.sold && me.gold >= c.price && (c.kind !== 'part' || m.slot === 0 || m.slot === 1) && (c.kind !== 'item' || me.kit.items[c.part] < MAX_ITEMS)) {
        me.gold -= c.price; c.sold = true;
        this.giveCard(me, c, m.slot);
      }
      me.send({ t: 'shop', items: me.shop, gold: me.gold });
    }
    if (m.t === 'shopdone' && this.phase === 'pick' && this.pickers?.has(me.id) && me.shop) {
      me.shop = null;
      this.pickers.delete(me.id);
      me.send({ t: 'lootpicked' });
      this.finishPickIfDone();
    }
    // 소모품 사용
    if (m.t === 'use' && !me.dead && ITEMS[m.item] && me.kit.items[m.item] > 0 && (this.phase === 'live' || this.phase === 'waiting' || this.phase === 'countdown')) {
      const now = nowS();
      if (me.usingUntil > now) return;
      const it = ITEMS[m.item], life = me.lifeId;
      me.kit.items[m.item]--; me.usingUntil = now + it.use;
      this.sendKit(me);
      this.broadcast({ t: 'using', id: me.id, item: m.item, dur: it.use });
      this.later(it.use, () => {
        if (me.dead || me.lifeId !== life) return;
        if (m.item === 'heal') { me.hp = Math.min(me.capHp ?? me.maxHp, Math.round(me.hp + it.hp)); this.broadcast({ t: 'hp', id: me.id, hp: me.hp }); }
        else {
          // 아드레날린: dur초 동안 0.5초마다 조금씩 회복 + 이동 빠름
          this.broadcast({ t: 'buff', id: me.id, speed: it.speed, dur: it.dur });
          const ticks = it.dur / 0.5, per = it.hp / ticks;
          for (let k = 1; k <= ticks; k++) this.later(k * 0.5, () => { if (me.dead || me.lifeId !== life) return; me.hp = Math.min(me.capHp ?? me.maxHp, me.hp + per); this.broadcast({ t: 'hp', id: me.id, hp: Math.round(me.hp) }); });
        }
      });
    }
    if (m.t === 'reroll' && this.phase === 'pick' && this.pickers?.has(me.id) && me.pickOpts && me.rerolls > 0) {
      me.rerolls--;
      me.pickOpts = rollOptions(me.augs, this.pickTier, this.pickCurse);
      me.send({ t: 'pick', opts: me.pickOpts, rerolls: me.rerolls, reroll: true, tier: this.pickTier, curse: this.pickCurse });
    }

    // 재장전: 방장이 탄약 수를 관리
    // 수류탄 / 섬광탄 던지기 (라운드마다 1개씩)
    if (m.t === 'throw' && !me.dead && NADE[m.kind] && me.nades?.[m.kind] > 0 && (this.phase === 'live' || this.phase === 'waiting')
      && Array.isArray(m.dir) && m.dir.length === 3 && m.dir.every(Number.isFinite) && !(me.usingUntil > nowS())) {
      me.nades[m.kind]--;
      const N = NADE[m.kind], l = Math.hypot(...m.dir) || 1, d = m.dir.map(v => v / l);
      const [rx, rz] = rightOf(me.yaw), lo = (me.ln || 0) * POSE.leanEye;
      const p0 = [me.pos[0] + rx * lo + d[0] * 0.4, me.pos[1] + eyeHeight(me.cr) - 0.1 + d[1] * 0.4, me.pos[2] + rz * lo + d[2] * 0.4];
      const v0 = [d[0] * N.speed, d[1] * N.speed + 2.5, d[2] * N.speed];
      const nid = (this.nadeSeq = (this.nadeSeq || 0) + 1);
      this.broadcast({ t: 'nade', nid, by: me.id, kind: m.kind, p: p0, v: v0, nades: me.nades });
      const round = this.round, end = simNade(p0, v0, N.fuse);
      this.later(N.fuse, () => this.explode(m.kind, end, me.id, round, nid));
    }
    if (m.t === 'reload' && !me.dead && me.loadout.includes(m.w)) {
      const now = nowS();
      this.finishReload(me, now);
      const W = this.W(me, m.w);
      if (me.reloadEnd > now || me.ammo[m.w] >= W.mag) return;
      me.reloadEnd = now + W.reload;
      me.reloadW = m.w;
    }

    if (m.t === 'shoot' && !me.dead && (this.phase === 'live' || this.phase === 'waiting')) {
      const now = nowS();
      if (!me.loadout.includes(m.w)) return;                // 가진 총만
      if (me.usingUntil > now) return;                    // 소모품 쓰는 중
      const wname = m.w, W = this.W(me, wname);
      this.finishReload(me, now);
      if (me.reloadEnd > now) return;                      // 재장전 중
      if (!(me.ammo[wname] > 0)) return;                   // 탄 없음
      if (now - me.lastShot < W.interval * 0.5) return;    // 연사 제한 (네트워크 지연 여유)
      me.lastShot = now;
      const lastFive = me.stats.lastFive && me.ammo[wname] <= me.stats.lastFive;
      me.ammo[wname]--;

      // 눈 위치: 앉으면 낮게, 기울이면 옆으로
      const [rx, rz] = rightOf(me.yaw), lo = (me.ln || 0) * POSE.leanEye;
      const o = [me.pos[0] + rx * lo, me.pos[1] + eyeHeight(me.cr), me.pos[2] + rz * lo];
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
          const r = W.pelletSpread * W.pelletMul * (m.ads ? 0.7 : 1) * Math.sqrt(Math.random()) * (i ? 1 : 0.3), a = Math.random() * Math.PI * 2;
          const q = d.map((x, k) => x + (u[k] * Math.cos(a) + v[k] * Math.sin(a)) * r);
          const l = Math.hypot(...q); dirs.push(q.map(x => x / l));
        }
      }
      const rays = dirs.map(dd => this.trace(me, o, dd));
      this.broadcast({ t: 'shot', id: me.id, o, w: wname, q: W.quiet ? 1 : 0, rays: rays.map(r => ({ end: r.end, hit: !!r.hit, pierced: r.pierced, wallT: r.firstWall })) });

      // 나무 상자에 맞은 총알은 상자 체력을 깎음
      for (const r of rays) if ((!r.hit || r.hit.through) && r.wallIdx >= 0 && isWood(BOXES[r.wallIdx])) this.hitCrate(r.wallIdx, W.body * rangeMul(W, r.firstWall));
      // 맞은 사람별로 모아서 한 번에 판정 (샷건 여러 알)
      const byVictim = new Map();
      for (const r of rays) {
        if (!r.hit) continue;
        // 등급 데미지 × 맞은 사람 방어구 (머리=헬멧, 몸=조끼)
        const arm = r.hit.p.kit?.armor || {};
        // 다리는 75% 데미지, 조끼는 다리를 막지 못함
        let base = (r.hit.head ? W.head * me.stats.headMul : W.body * (r.hit.leg ? POSE.legMul : 1)) * rangeMul(W, r.hit.t) * W.dmgMul
          * (1 - (r.hit.head ? ARMOR.helmet.red[arm.helmet | 0] : r.hit.leg ? 0 : ARMOR.vest.red[arm.vest | 0]));
        if (lastFive) base *= 2;
        if (r.hit.through) base *= me.stats.pierce;
        const e = byVictim.get(r.hit.p) || { base: 0, head: false, at: r.end, through: false, n: 0, legs: 0 };
        e.base += base; e.head ||= r.hit.head; e.through ||= r.hit.through; e.n++; if (r.hit.leg) e.legs++;
        if (r.hit.head) e.at = r.end;
        byVictim.set(r.hit.p, e);
      }
      for (const [v, e] of byVictim) {
        const { dmg, killed } = this.damage(me, v, e.base, false, now, W.syn);
        const part = e.head ? 'head' : e.legs === e.n ? 'leg' : 'body';
        this.broadcast({ t: 'hit', target: v.id, by: me.id, hp: Math.max(0, Math.round(v.hp)), dmg, head: e.head, part, w: wname, from: o, at: e.at, through: e.through, pellets: e.n });
        if (killed && this.phase === 'live') {
          v.dead = true;
          me.score++;
          this.broadcast({ t: 'kill', killer: me.id, victim: v.id, head: e.head, part, w: wname, scores: this.scores(), from: o, at: e.at });
          this.endRound(me, v);
        } else if (killed) {
          // 대기 중(상대 없음)에는 그냥 체력만 회복
          v.hp = v.maxHp;
        }
      }
    }
  }
}
