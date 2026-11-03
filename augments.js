// 증강 카드 정의 + 효과 계산 (방장 판정과 화면 표시가 같이 씁니다)
import { GUNS, DEFAULT_LOADOUT } from './guns.js';

export const TIERS = {
  silver: { name: '실버', color: '#c9d3df', lv: 0 },
  gold: { name: '골드', color: '#ffc845', lv: 1 },
  prism: { name: '프리즘', color: '#d07bff', lv: 2 },
};
export const CURSE_COLOR = '#ff4d5e';

// 효과마다 [실버, 골드, 프리즘] 수치. desc(v)로 등급별 설명을 만듭니다.
const pct = v => Math.round(v * 100);
export const AUGMENTS = {
  bigmag:    { name: '확장 탄창', v: [0.2, 0.35, 0.5], desc: v => `탄창 용량 +${pct(v)}%` },
  fasthand:  { name: '빠른 손', v: [0.15, 0.25, 0.4], desc: v => `재장전 ${pct(v)}% 빨라짐` },
  lightfoot: { name: '가벼운 발', v: [0.06, 0.1, 0.16], desc: v => `이동 속도 +${pct(v)}%` },
  vest:      { name: '방탄복', v: [15, 25, 40], desc: v => `최대 체력 +${v}` },
  steady:    { name: '흔들림 없는 조준', v: [0.2, 0.35, 0.55], desc: v => `반동 ${pct(v)}% 감소` },
  breath:    { name: '저격수의 호흡', v: [0.3, 0.5, 0.8], desc: v => `정조준 속도 +${pct(v)}%, 노리쇠·펌프 시간 ${pct(v * 0.6)}% 감소` },
  headhunter:{ name: '헤드헌터', v: [0.2, 0.4, 0.65], desc: v => `헤드샷 데미지 +${pct(v)}%` },
  vamp:      { name: '흡혈', v: [0.12, 0.22, 0.35], desc: v => `준 데미지의 ${pct(v)}%만큼 체력 회복` },
  djump:     { name: '이단 점프', v: [0.65, 0.85, 1.05], desc: v => `공중에서 한 번 더 점프 (높이 ${pct(v)}%)` },
  lastfive:  { name: '마지막 탄', v: [3, 5, 8], desc: v => `탄창의 마지막 ${v}발 데미지 2배` },
  dash:      { name: '대시', v: [7, 5, 3], desc: v => `Shift 두 번 빠르게 눌러 돌진 (쿨타임 ${v}초)` },
  radar:     { name: '첨단 시야', v: [1, 2, 3.5], desc: v => `맞힌 상대가 ${v}초 동안 벽 너머로 보임` },
  pierce:    { name: '관통탄', v: [0.3, 0.5, 0.75], desc: v => `총알이 엄폐물 1개를 뚫음 (뚫은 뒤 데미지 ${pct(v)}%)` },
  revive:    { name: '재생', v: [1, 25, 50], desc: v => `라운드마다 1번, 죽을 피해를 체력 ${v}로 버티고 2초 무적` },
  ghost:     { name: '유령', v: [[0.6, 10], [1, 8], [1.6, 6]], desc: v => `맞으면 ${v[0]}초 동안 투명 (쿨타임 ${v[1]}초)` },
  quickbolt: { name: '빠른 격발', v: [0.75, 0.6, 0.45], desc: v => `단발 총(저격총·권총·샷건 등) 발사 간격 ×${v}` },
  // 저주: 그 판 등급에 맞춰 위험과 보상이 같이 커짐
  glass:     { name: '유리대포', curse: true, v: [[1.3, 80], [1.6, 60], [1.9, 45]], desc: v => `데미지 ×${v[0]}, 대신 최대 체력 ${v[1]}` },
  gambler:   { name: '도박사', curse: true, v: [[0.7, 1.5], [0.5, 2], [0.3, 2.6]], desc: v => `매 발 데미지가 ${pct(v[0])}%~${pct(v[1])}% 사이에서 랜덤` },
};

// 카드 아이콘 (Kenney UI Pack Sci-fi, CC0)
const ICONS = {"bigmag": "plus", "fasthand": "fastForward", "lightfoot": "fastForward", "vest": "medal1", "steady": "target", "breath": "zoom", "headhunter": "target", "vamp": "plus", "djump": "star", "lastfive": "target", "dash": "fastForward", "radar": "zoom", "pierce": "target", "revive": "plus", "ghost": "star", "quickbolt": "wrench", "glass": "warning", "gambler": "warning"};

// 가진 증강은 "id@등급" 문자열로 저장 (예: "bigmag@gold")
export const augKey = (id, tier) => `${id}@${tier}`;
export function parseAug(key) {
  const [id, tier = 'silver'] = String(key).split('@');
  return AUGMENTS[id] && TIERS[tier] ? { id, tier, lv: TIERS[tier].lv, a: AUGMENTS[id] } : null;
}
export function augText(key) {
  const p = parseAug(key); if (!p) return null;
  const v = p.a.v[p.lv];
  return { ...p, icon: ICONS[p.id] || 'star', name: p.a.name, desc: p.a.desc(v), curse: !!p.a.curse, color: p.a.curse ? CURSE_COLOR : TIERS[p.tier].color };
}

export function statsFor(augs = []) {
  const L = {};
  for (const k of augs) { const p = parseAug(k); if (p) L[p.id] = p.a.v[p.lv]; }
  const g = id => L[id];
  return {
    magMul: 1 + (g('bigmag') || 0),
    reloadMul: 1 - (g('fasthand') || 0),
    speedMul: 1 + (g('lightfoot') || 0),
    maxHp: (g('glass') ? g('glass')[1] : 100) + (g('vest') || 0),
    recoilMul: 1 - (g('steady') || 0),
    adsMul: 1 + (g('breath') || 0),
    boltMul: 1 - (g('breath') || 0) * 0.6,
    headMul: 1 + (g('headhunter') || 0),
    lifesteal: g('vamp') || 0,
    doubleJump: g('djump') || 0,          // 0이면 없음, 아니면 점프 높이 배율
    lastFive: g('lastfive') || 0,         // 마지막 몇 발
    dash: g('dash') || 0,                 // 쿨타임(초)
    radar: g('radar') || 0,               // 보이는 시간(초)
    pierce: g('pierce') || 0,             // 뚫은 뒤 데미지 배율
    revive: g('revive') || 0,             // 버틴 뒤 체력
    ghost: g('ghost') || null,            // [지속, 쿨타임]
    sniperMul: g('quickbolt') || 1,
    dmgMul: g('glass') ? g('glass')[0] : 1,
    gambler: g('gambler') || null,        // [최소, 최대]
  };
}

// 증강이 반영된 무기 수치
// 단발 총(누르고 있어도 한 발만 나가는 총)은 '빠른 격발', 노리쇠/펌프 총은 '저격수의 호흡'이 간격을 줄임
export function effWeapon(name, stats) {
  const W = GUNS[name] || GUNS[DEFAULT_LOADOUT[0]];
  let interval = W.interval;
  if (!W.auto && !W.burst) interval *= stats.sniperMul;
  if (W.cycle) interval *= stats.boltMul;
  return {
    ...W,
    mag: Math.round(W.mag * stats.magMul),
    reload: W.reload * stats.reloadMul,
    interval,
    recoil: W.recoil * stats.recoilMul,
  };
}

// 이번 증강 선택의 등급 (나와 상대가 같은 등급을 받음)
// 대결: 몇 번째 선택인지(0,1,2)에 따라 뒤로 갈수록 높은 등급이 잘 나옴
// 런: 스테이지가 오를수록 높은 등급, 보스(5) 클리어는 프리즘 확정
export function rollTier(mode, n, rnd = Math.random) {
  let w;
  if (mode === 'run') {
    if (n === 5) return 'prism';
    w = n <= 2 ? [60, 35, 5] : n <= 4 ? [35, 50, 15] : n <= 7 ? [20, 50, 30] : [10, 45, 45];
  } else {
    w = [[55, 37, 8], [30, 50, 20], [15, 45, 40]][Math.min(n, 2)];
  }
  let r = rnd() * (w[0] + w[1] + w[2]);
  return r < w[0] ? 'silver' : r < w[0] + w[1] ? 'gold' : 'prism';
}
// 저주 카드가 추가로 뜨는 선택인지 (선택마다 번갈아: 두 번째, 네 번째 …, n은 0부터)
export const hasCurse = n => n % 2 === 1;

// 아직 없는 효과 중에서 서로 다른 3장 (+ 저주 1장) 뽑기
export function rollOptions(owned = [], tier = 'silver', curse = false, rnd = Math.random, exclude = []) {
  const have = new Set(owned.map(k => String(k).split('@')[0]));
  const pool = Object.keys(AUGMENTS).filter(id => !have.has(id) && !exclude.includes(id));
  const take = (list, n) => { const out = []; list = [...list]; while (out.length < n && list.length) out.push(list.splice(Math.floor(rnd() * list.length), 1)[0]); return out; };
  const out = take(pool.filter(id => !AUGMENTS[id].curse), 3);
  if (curse) out.push(...take(pool.filter(id => AUGMENTS[id].curse), 1));
  return out.map(id => augKey(id, tier));
}

// ---------- 봇전 로그라이크 런 ----------
export const RUN = { stages: 10 };
// 스테이지별 봇 설정 (난이도 0~1.2, 보스 정보)
export function stageInfo(stage) {
  if (stage === 5) return { name: '보스: 저격수', boss: true, level: 0.75, hpBonus: 50, weapon: 'snm_w', loadout: ['ar_w', 'snm_w'], augs: 1 };
  if (stage === 10) return { name: '최종 보스: 중장갑', boss: true, level: 1.0, hpBonus: 200, weapon: 'sga_e', loadout: ['sga_e', 'ar_w'], rush: true, augs: 3 };
  const level = Math.min(1.1, 0.05 + (stage - 1) * 0.12);
  // 스테이지마다 봇 총 구성이 달라짐 (앞: 근중거리, 뒤: 원거리)
  const LOAD = { 1: ['ar_w', 'snm_w'], 2: ['smg_w', 'pis_w'], 3: ['ar_e', 'snr_w'], 4: ['sgp_w', 'br_e'], 6: ['br_w', 'snr_e'], 7: ['smgc_e', 'snm_w'], 8: ['sga_w', 'snr_w'], 9: ['ar_e', 'snm_e'] };
  return { name: `스테이지 ${stage}`, boss: false, level, hpBonus: 0, weapon: null, loadout: LOAD[stage] || ['ar_w', 'snm_w'], augs: Math.floor((stage - 1) / 3) };
}
