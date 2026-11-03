// 총 20종 정의 (모델: CC0 Flat Guns West/East, Pichuliru / OpenGameArt)
// 판정은 방장 쪽 game.js가 이 값을 씁니다.
//
// 값 설명
//  body/head: 한 발(샷건은 산탄 1알) 데미지, interval: 발사 간격(초), mag: 탄창, reload: 재장전(초)
//  spread/adsSpread: 퍼짐(지향/정조준), recoil: 반동, fov: 정조준 시야각(작을수록 확대)
//  auto: 누르고 있으면 연사, burst: 한 번 클릭에 몇 발(점사), burstGap: 점사 사이 간격
//  pellets/pelletSpread: 산탄 수와 퍼짐, range: [이 거리까지 100%, 이 거리부터 최소, 최소 배율]
//  move: 들고 있을 때 이동 속도 배율, ads: 정조준 속도 배율, swap: 꺼내는 시간
//  cycle: 'bolt'(노리쇠) | 'pump'(펌프) — 쏠 때마다 장전 동작, optic: 'dot' | 'scope' | 'none'
//  snd/rate: 총소리 묶음과 재생 속도
export const CLASSES = {
  ar: '돌격소총', br: '배틀라이플', dmr: '지정사수 소총', smg: '기관단총', pistol: '권총', sg: '샷건', sniper: '저격총',
};

const base = { spread: 0.012, adsSpread: 0.003, recoil: 0.01, fov: 55, auto: false, move: 1, ads: 1, swap: 0.45, optic: 'dot', rate: 1 };
const def = (id, o) => ({ id, ...base, ...o });

export const GUNS = Object.fromEntries([
  // ---- 돌격소총 / 배틀라이플 ----
  def('ar_w', { file: 'Rifle_Assault_West', cls: 'ar', name: 'AR 카빈', desc: '무난한 연사와 반동. 어디서나 쓸 만함',
    body: 22, head: 45, interval: 0.11, mag: 30, reload: 2.0, auto: true, snd: 'rifle' }),
  def('ar_e', { file: 'Rifle_Assault_East', cls: 'ar', name: 'AK 소총', desc: '한 발이 더 세지만 반동이 큼',
    body: 27, head: 55, interval: 0.125, mag: 30, reload: 2.3, spread: 0.015, adsSpread: 0.004, recoil: 0.016, auto: true, snd: 'ak' }),
  def('br_w', { file: 'Rifle_Battle_West', cls: 'br', name: '배틀라이플', desc: '무겁고 강한 연사. 20발',
    body: 34, head: 70, interval: 0.15, mag: 20, reload: 2.4, spread: 0.013, recoil: 0.02, fov: 50, auto: true, move: 0.95, snd: 'ak', rate: 0.85 }),
  def('br_e', { file: 'Rifle_Battle_East', cls: 'dmr', name: '지정사수 소총', desc: '반자동. 몸 2발, 머리 1발. 확대 조준',
    body: 50, head: 105, interval: 0.3, mag: 15, reload: 2.4, spread: 0.02, adsSpread: 0.0015, recoil: 0.025, fov: 36, move: 0.97, snd: 'rifle', rate: 0.82 }),
  // ---- 기관단총 ----
  def('smg_w', { file: 'SMG_Full_West', cls: 'smg', name: 'SMG', desc: '빠른 연사와 이동. 멀면 약해짐',
    body: 17, head: 34, interval: 0.075, mag: 30, reload: 1.8, spread: 0.016, adsSpread: 0.006, recoil: 0.008, fov: 62, auto: true, move: 1.08, ads: 1.3, swap: 0.35, range: [12, 30, 0.6], snd: 'pistol', rate: 1.15 }),
  def('smg_e', { file: 'SMG_Full_East', cls: 'smg', name: '드럼 SMG', desc: '50발 탄창. 재장전이 느림',
    body: 15, head: 30, interval: 0.07, mag: 50, reload: 3.0, spread: 0.02, adsSpread: 0.008, recoil: 0.009, fov: 62, auto: true, move: 1.05, ads: 1.2, swap: 0.4, range: [12, 30, 0.6], snd: 'pistol', rate: 1.1 }),
  def('smgc_w', { file: 'SMG_Compact_West', cls: 'smg', name: '소형 SMG', desc: '가장 빠른 연사. 근거리 전용',
    body: 13, head: 26, interval: 0.055, mag: 25, reload: 1.6, spread: 0.024, adsSpread: 0.01, recoil: 0.007, fov: 65, auto: true, move: 1.12, ads: 1.4, swap: 0.3, range: [8, 25, 0.5], optic: 'none', snd: 'pistol', rate: 1.3 }),
  def('smgc_e', { file: 'SMG_Compact_East', cls: 'smg', name: '점사 SMG', desc: '클릭 한 번에 3점사. 정확함',
    body: 20, head: 40, interval: 0.06, burst: 3, burstGap: 0.32, mag: 30, reload: 1.8, spread: 0.012, adsSpread: 0.004, recoil: 0.012, fov: 60, move: 1.08, ads: 1.3, swap: 0.35, range: [15, 35, 0.6], snd: 'rifle', rate: 1.2 }),
  // ---- 권총 ----
  def('pis_w', { file: 'Pistol_Full_West', cls: 'pistol', name: '권총', desc: '반자동. 가볍고 꺼내기 빠름',
    body: 30, head: 62, interval: 0.17, mag: 15, reload: 1.3, spread: 0.012, adsSpread: 0.004, recoil: 0.02, fov: 65, move: 1.12, ads: 1.5, swap: 0.25, range: [15, 40, 0.6], optic: 'none', snd: 'pistol' }),
  def('pis_e', { file: 'Pistol_Full_East', cls: 'pistol', name: '기관권총', desc: '권총인데 연사가 됨',
    body: 16, head: 32, interval: 0.08, mag: 20, reload: 1.5, spread: 0.022, adsSpread: 0.01, recoil: 0.012, fov: 65, auto: true, move: 1.12, ads: 1.5, swap: 0.25, range: [8, 25, 0.5], optic: 'none', snd: 'pistol', rate: 1.2 }),
  def('pisc_w', { file: 'Pistol_Compact_West', cls: 'pistol', name: '소형 권총', desc: '가장 빠른 이동과 재장전',
    body: 26, head: 55, interval: 0.15, mag: 10, reload: 0.9, spread: 0.014, adsSpread: 0.005, recoil: 0.018, fov: 65, move: 1.18, ads: 1.6, swap: 0.2, range: [12, 35, 0.6], optic: 'none', snd: 'pistol', rate: 1.1 }),
  def('pisc_e', { file: 'Pistol_Compact_East', cls: 'pistol', name: '대구경 권총', desc: '6발. 한 발 한 발이 묵직함',
    body: 52, head: 110, interval: 0.45, mag: 6, reload: 2.0, spread: 0.01, adsSpread: 0.003, recoil: 0.07, fov: 60, move: 1.1, ads: 1.4, swap: 0.25, range: [20, 45, 0.7], optic: 'none', snd: 'ak', rate: 0.9 }),
  // ---- 샷건 (데미지는 산탄 1알 기준) ----
  def('sgp_w', { file: 'Shotgun_Pump_West', cls: 'sg', name: '펌프 샷건', desc: '가까우면 한 방. 쏠 때마다 펌프',
    body: 13, head: 18, pellets: 8, pelletSpread: 0.055, interval: 0.9, cycle: 'pump', mag: 6, reload: 2.6, spread: 0.004, adsSpread: 0.002, recoil: 0.05, fov: 65, ads: 1.2, range: [6, 18, 0.25], optic: 'none', snd: 'shotgun' }),
  def('sgp_e', { file: 'Shotgun_Pump_East', cls: 'sg', name: '장탄 펌프 샷건', desc: '8발 장전. 산탄이 넓게 퍼짐',
    body: 11, head: 16, pellets: 10, pelletSpread: 0.07, interval: 0.8, cycle: 'pump', mag: 8, reload: 3.0, spread: 0.004, adsSpread: 0.002, recoil: 0.05, fov: 65, ads: 1.2, range: [5, 16, 0.25], optic: 'none', snd: 'shotgun', rate: 1.05 }),
  def('sga_w', { file: 'Shotgun_Auto_West', cls: 'sg', name: '반자동 샷건', desc: '펌프 없이 빠르게 쏘는 샷건',
    body: 11, head: 16, pellets: 7, pelletSpread: 0.06, interval: 0.3, mag: 8, reload: 2.8, spread: 0.004, adsSpread: 0.002, recoil: 0.04, fov: 65, ads: 1.2, range: [6, 18, 0.25], snd: 'shotgun', rate: 1.1 }),
  def('sga_e', { file: 'Shotgun_Auto_East', cls: 'sg', name: '자동 샷건', desc: '누르고 있으면 연사되는 샷건',
    body: 9, head: 13, pellets: 6, pelletSpread: 0.065, interval: 0.22, mag: 10, reload: 2.4, spread: 0.004, adsSpread: 0.002, recoil: 0.035, fov: 65, auto: true, ads: 1.2, range: [5, 15, 0.25], snd: 'shotgun', rate: 1.15 }),
  // ---- 저격총 ----
  def('snm_w', { file: 'Sniper_Material_West', cls: 'sniper', name: '대물 저격총', desc: '머리 한 방. 기본 저격총',
    body: 85, head: 150, interval: 1.3, cycle: 'bolt', mag: 5, reload: 2.8, spread: 0.06, adsSpread: 0, recoil: 0.06, fov: 18, move: 0.95, optic: 'scope', snd: 'sniper' }),
  def('snm_e', { file: 'Sniper_Material_East', cls: 'sniper', name: '중대물 저격총', desc: '몸에 맞아도 한 방. 대신 아주 느림',
    body: 100, head: 200, interval: 2.0, cycle: 'bolt', mag: 4, reload: 3.6, spread: 0.07, adsSpread: 0, recoil: 0.09, fov: 15, move: 0.88, ads: 0.75, swap: 0.6, optic: 'scope', snd: 'sniper', rate: 0.85 }),
  def('snr_w', { file: 'Sniper_Rifle_West', cls: 'sniper', name: '볼트 저격총', desc: '조준이 빠르고 6발',
    body: 75, head: 140, interval: 1.0, cycle: 'bolt', mag: 6, reload: 2.4, spread: 0.05, adsSpread: 0, recoil: 0.05, fov: 22, move: 0.98, ads: 1.35, optic: 'scope', snd: 'sniper', rate: 1.08 }),
  def('snr_e', { file: 'Sniper_Rifle_East', cls: 'sniper', name: '반자동 저격총', desc: '노리쇠 없이 연속 사격. 10발',
    body: 55, head: 110, interval: 0.38, mag: 10, reload: 2.6, spread: 0.05, adsSpread: 0.0008, recoil: 0.035, fov: 25, move: 0.97, optic: 'scope', snd: 'sniper', rate: 1.15 }),
].map(g => [g.id, g]));

export const GUN_IDS = Object.keys(GUNS);
export const DEFAULT_LOADOUT = ['ar_w', 'snm_w'];
export const isGun = id => Object.prototype.hasOwnProperty.call(GUNS, id);

// 거리 감소 배율
export function rangeMul(W, dist) {
  if (!W.range) return 1;
  const [a, b, min] = W.range;
  if (dist <= a) return 1;
  if (dist >= b) return min;
  return 1 - (1 - min) * (dist - a) / (b - a);
}

// 카드에 보여 줄 0~1 막대 수치
export function gunBars(W) {
  const perShot = W.body * (W.pellets || 1);
  const dps = perShot / (W.burst ? (W.burstGap + W.interval * (W.burst - 1)) / W.burst : W.interval);
  return {
    dmg: Math.min(1, perShot / 100),
    rate: Math.min(1, dps / 330),
    range: W.range ? Math.min(1, W.range[1] / 50) : W.cls === 'sniper' || W.cls === 'dmr' ? 1 : 0.8,
    move: Math.max(0, Math.min(1, (W.move - 0.85) / 0.35)),
  };
}

// 아직 없는 총 중에서 무작위 n개
export function rollGuns(loadout = [], n = 3, rnd = Math.random) {
  const pool = GUN_IDS.filter(id => !loadout.includes(id));
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
