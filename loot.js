// 파밍: 총 등급, 부착물(칸에 붙음), 방어구, 소모품
// - 부착물은 총이 아니라 "칸(1번/2번)"에 붙어서, 그 칸의 총을 바꿔도 그대로 옮겨집니다.
// - 그 총에 안 맞는 부착물은 비슷한 효과로 바뀝니다 (카드에 바뀐 효과를 보여 줌).
// 방장(game.js)과 화면(main.js), 봇(bot.js)이 같은 계산을 쓰도록 이 파일 하나에 모았습니다.

// ---------- 총 등급 ----------
// dmg: 데미지 배수, syn: 증강 데미지 효과 시너지(희귀 이상이면 증강의 데미지 보너스가 더 커짐)
export const GRADES = [
  { name: '일반', color: '#b8c0cc', dmg: 1.0, syn: 1.0 },
  { name: '고급', color: '#5fd38a', dmg: 1.05, syn: 1.0 },
  { name: '희귀', color: '#5aa8ff', dmg: 1.1, syn: 1.15 },
  { name: '영웅', color: '#c77dff', dmg: 1.16, syn: 1.3 },
];
// 몇 번째 선택인지(대결) / 스테이지(런)가 오를수록 높은 등급이 잘 나옴
export function rollGrade(level = 0, rnd = Math.random) {
  const w = [[55, 32, 11, 2], [35, 38, 20, 7], [20, 35, 30, 15], [10, 30, 35, 25]][Math.max(0, Math.min(3, level))];
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 4; i++) { r -= w[i]; if (r < 0) return i; }
  return 0;
}

// ---------- 부착물 ----------
export const PART_KINDS = ['mag', 'muz', 'grip', 'optic'];
export const PARTS = {
  mag: { name: '확장 탄창', icon: 'plus' },
  muz: { name: '소음기', icon: 'target' },
  grip: { name: '손잡이', icon: 'wrench' },
  optic: { name: '조준경', icon: 'zoom' },
};
const LV = [0, 1, 2, 3];
const pct = v => Math.round(Math.abs(1 - v) * 100) + '%';
const isSniper = W => W.cls === 'sniper';
const isSg = W => W.cls === 'sg';
const isPistol = W => W.cls === 'pistol';

// 이 총(W)에 lv 단계 부착물(kind)을 달았을 때의 효과: { label, mods: {배수들} }
export function partEffect(kind, lv, W) {
  if (!lv) return null;
  const k = [0, 0, 1, 2][lv];
  switch (kind) {
    case 'mag': {
      if (W.cycle) { const m = [0.88, 0.8, 0.72][k]; return { label: `빠른 장전 (재장전 -${pct(m)})`, conv: true, mods: { reload: m } }; }
      const m = [1.2, 1.35, 1.5][k]; return { label: `확장 탄창 (탄창 +${pct(m)})`, mods: { mag: m } };
    }
    case 'muz': {
      if (isSg(W)) { const m = [0.85, 0.75, 0.65][k]; return { label: `초크 (산탄 퍼짐 -${pct(m)})`, conv: true, mods: { pellet: m } }; }
      const m = [0.88, 0.8, 0.72][k]; return { label: `소음기 (반동 -${pct(m)}, 총소리·화염 작게)`, mods: { recoil: m, quiet: 1 } };
    }
    case 'grip': {
      if (isSniper(W)) { const m = [0.9, 0.82, 0.75][k]; return { label: `재조준 빠름 (${W.cycle ? '노리쇠' : '연사 간격'} -${pct(m)})`, conv: true, mods: { interval: m } }; }
      const m = [0.85, 0.75, 0.65][k], a = [1.08, 1.15, 1.22][k];
      return { label: `손잡이 (반동 -${pct(m)}, 정조준 +${pct(a)})`, mods: { recoil: m, ads: a } };
    }
    case 'optic': {
      if (isSniper(W)) { const m = [0.7, 0.5, 0.3][k]; return { label: `흔들림 감소 (스코프 흔들림 -${pct(m)})`, conv: true, mods: { sway: m } }; }
      if (isSg(W) || isPistol(W)) { const a = [1.15, 1.25, 1.35][k]; return { label: `레드도트 (정조준 +${pct(a)})`, conv: lv > 1, mods: { ads: a, adsSpread: 0.85 } }; }
      if (lv === 1) return { label: '레드도트 (정조준 +10%, 정조준 퍼짐 -10%)', mods: { ads: 1.1, adsSpread: 0.9 } };
      if (lv === 2) return { label: '2배율 (확대 +25%, 정조준 퍼짐 -20%)', mods: { fov: 0.8, adsSpread: 0.8 } };
      return { label: '4배율 (확대 +65%, 정조준 퍼짐 -35%)', mods: { fov: 0.6, adsSpread: 0.65, ads: 0.9 } };
    }
  }
  return null;
}
export const partName = (kind, lv) => kind === 'optic' ? ['', '레드도트', '2배율 조준경', '4배율 조준경'][lv] : `${PARTS[kind].name} Lv${lv}`;

// 무기 수치에 등급·부착물 적용 (o = effWeapon 결과를 그대로 고침)
export function applyMods(o, mod) {
  o.dmgMul = 1; o.syn = 1; o.adsMul = 1; o.fovMul = 1; o.pelletMul = 1; o.swayMul = 1; o.quiet = false; o.grade = 0;
  if (!mod) return o;
  const g = GRADES[mod.grade | 0] || GRADES[0];
  o.grade = mod.grade | 0; o.dmgMul = g.dmg; o.syn = g.syn;
  for (const kind of PART_KINDS) {
    const e = partEffect(kind, mod.parts?.[kind] | 0, o);
    if (!e) continue;
    const m = e.mods;
    if (m.mag) o.mag = Math.round(o.mag * m.mag);
    if (m.reload) o.reload *= m.reload;
    if (m.recoil) o.recoil *= m.recoil;
    if (m.interval) o.interval *= m.interval;
    if (m.pellet) o.pelletMul *= m.pellet;
    if (m.ads) o.adsMul *= m.ads;
    if (m.adsSpread) o.adsSpread *= m.adsSpread;
    if (m.fov) o.fovMul *= m.fov;
    if (m.sway) o.swayMul *= m.sway;
    if (m.quiet) o.quiet = true;
  }
  return o;
}

// ---------- 방어구 ----------
export const ARMOR = {
  helmet: { name: '헬멧', icon: 'medal1', red: [0, 0.3, 0.4, 0.5], what: '머리 피해' },
  vest: { name: '방탄 조끼', icon: 'medal1', red: [0, 0.15, 0.25, 0.35], what: '몸통 피해' },
};
// ---------- 소모품 ----------
// heal: 쓰는 데 use초, 끝나면 hp 회복 / adren: 짧게 쓰고 dur초 동안 천천히 회복 + 이동 빠름
export const ITEMS = {
  heal: { name: '구급 키트', icon: 'plus', key: '3', use: 2.0, hp: 50, desc: '2초 동안 치료하고 체력 +50' },
  adren: { name: '아드레날린', icon: 'fastForward', key: '4', use: 0.8, hp: 30, dur: 8, speed: 1.15, desc: '8초 동안 체력 +30, 이동 속도 +15%' },
};
export const MAX_ITEMS = 3;

// ---------- 파밍 카드 ----------
// card: { kind:'part', part:'mag', lv } | { kind:'armor', part:'helmet', lv } | { kind:'item', part:'heal' }
// 런 휴식(3스테이지마다 상점에 무료로 1장): 최대 체력 증가
export const REST = { name: '휴식', icon: 'plus', hp: 15 };
export function cardTitle(c) {
  if (c.kind === 'rest') return REST.name;
  if (c.kind === 'part') return partName(c.part, c.lv);
  if (c.kind === 'armor') return `${ARMOR[c.part].name} Lv${c.lv}`;
  return ITEMS[c.part].name;
}
export function cardDesc(c) {
  if (c.kind === 'rest') return `잠깐 쉬어 갑니다. 최대 체력 +${REST.hp} (런 끝까지 유지)`;
  if (c.kind === 'armor') return `${ARMOR[c.part].what} -${Math.round(ARMOR[c.part].red[c.lv] * 100)}% (경기 끝까지 유지)`;
  if (c.kind === 'item') return `${ITEMS[c.part].desc}. ${ITEMS[c.part].key}번 키로 사용`;
  return '고른 칸에 붙음. 그 칸의 총을 바꿔도 따라감';
}
export const cardIcon = c => c.kind === 'rest' ? REST.icon : (c.kind === 'part' ? PARTS : c.kind === 'armor' ? ARMOR : ITEMS)[c.part].icon;
// level: 0~3 (뒤로 갈수록 높은 단계가 잘 나옴)
export function rollLoot(n = 3, level = 0, rnd = Math.random) {
  const out = [], seen = new Set();
  const lvW = [[70, 25, 5], [45, 40, 15], [30, 45, 25], [20, 40, 40]][Math.max(0, Math.min(3, level))];
  const pickLv = () => { let r = rnd() * 100; for (let i = 0; i < 3; i++) { r -= lvW[i]; if (r < 0) return i + 1; } return 1; };
  let guard = 0;
  while (out.length < n && guard++ < 50) {
    const r = rnd();
    let c;
    if (r < 0.55) c = { kind: 'part', part: PART_KINDS[Math.floor(rnd() * 4)], lv: pickLv() };
    else if (r < 0.8) c = { kind: 'armor', part: rnd() < 0.5 ? 'helmet' : 'vest', lv: pickLv() };
    else c = { kind: 'item', part: rnd() < 0.6 ? 'heal' : 'adren' };
    const key = c.kind + c.part;
    if (seen.has(key)) continue;
    seen.add(key); out.push(c);
  }
  return out;
}
// 런 상점 가격 (골드)
export function cardPrice(c) {
  if (c.kind === 'rest') return 0;
  if (c.kind === 'item') return c.part === 'heal' ? 25 : 40;
  return [0, 30, 60, 100][c.lv];
}

// 플레이어 장비 기본값
export const newKit = () => ({ mods: [{ grade: 0, parts: {} }, { grade: 0, parts: {} }], armor: { helmet: 0, vest: 0 }, items: { heal: 0, adren: 0 } });
