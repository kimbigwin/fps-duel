// 서버와 클라이언트가 함께 쓰는 아레나 정의 (좌표 단위: 미터)
export const ARENA = { half: 30, wallHeight: 6 };

// 장애물: 중심 x,z / 크기 w(x축), d(z축), h(높이)
export const BOXES = [
  // 중앙 구조물
  { x: 0, z: 0, w: 6, d: 6, h: 4 },
  // 대각선 엄폐물
  { x: -12, z: -10, w: 2, d: 8, h: 3 },
  { x: 12, z: 10, w: 2, d: 8, h: 3 },
  { x: 10, z: -14, w: 8, d: 2, h: 3 },
  { x: -10, z: 14, w: 8, d: 2, h: 3 },
  // 낮은 상자 (머리 위로 쏠 수 있음)
  { x: -5, z: -18, w: 2.5, d: 2.5, h: 1.2 },
  { x: 5, z: 18, w: 2.5, d: 2.5, h: 1.2 },
  { x: -20, z: 4, w: 2.5, d: 2.5, h: 1.2 },
  { x: 20, z: -4, w: 2.5, d: 2.5, h: 1.2 },
  { x: 18, z: 20, w: 3, d: 3, h: 2 },
  { x: -18, z: -20, w: 3, d: 3, h: 2 },
  // 기둥
  { x: -8, z: 4, w: 1.5, d: 1.5, h: 5 },
  { x: 8, z: -4, w: 1.5, d: 1.5, h: 5 },
];

// 스폰 후보 (가장자리/구석). 라운드마다 서로 안 보이고 먼 두 곳을 고릅니다.
export const SPAWN_POINTS = [
  [-26, -26], [26, -26], [-26, 26], [26, 26],
  [0, -26.5], [0, 26.5], [-26.5, 0], [26.5, 0],
  [-26, -12], [26, 12], [-14, 26], [14, -26],
  [-26, 13], [26, -13], [13, 26], [-13, -26],
];
// 맵 중앙을 바라보는 방향
export const faceCenter = (x, z) => Math.atan2(x, z);

export const PLAYER = {
  radius: 0.4,
  eye: 1.6,
  bodyHeight: 1.47, // 발~턱 (사람 모델 키 1.70m, 조준 자세 기준)
  headSize: 0.25,  // 턱~정수리
  hitRadius: 0.28, // 몸통 판정 반폭 (어깨+팔 포함)
  headHalf: 0.14,  // 머리 판정 반폭 (조준 자세로 머리가 앞으로 나온 만큼 포함)
};

export const RULES = {
  maxHp: 100,
  winRounds: 7,          // 먼저 7라운드 이기면 승리 (킬 1번 = 1라운드)
  countdown: 3,          // 라운드 시작 전 카운트다운 (초)
  roundEndTime: 2,       // 킬 후 다음 단계까지 (초)
  pickTime: 12,          // 증강 선택 제한 시간 (초)
  augmentRounds: [1, 4, 8], // 이 라운드가 끝난 뒤 증강 선택
};

// 무기 정의 (판정은 방장 쪽 game.js가 이 값을 사용)
export const WEAPONS = {
  rifle: {
    name: '돌격소총', body: 22, head: 45, interval: 0.11, mag: 30, reload: 2.0,
    spread: 0.012, adsSpread: 0.003, recoil: 0.010, fov: 55, auto: true,
  },
  sniper: {
    name: '저격총', body: 85, head: 150, interval: 1.3, mag: 5, reload: 2.8,
    spread: 0.06, adsSpread: 0.0, recoil: 0.06, fov: 18, auto: false,
  },
};
export const WEAPON_ORDER = ['rifle', 'sniper'];

// 축 정렬 박스(AABB) 목록: 벽 + 장애물
export function solidAABBs() {
  const list = BOXES.map(b => ({
    min: [b.x - b.w / 2, 0, b.z - b.d / 2],
    max: [b.x + b.w / 2, b.h, b.z + b.d / 2],
  }));
  const h = ARENA.half, H = ARENA.wallHeight, t = 1;
  list.push({ min: [-h - t, 0, -h - t], max: [h + t, H, -h] });
  list.push({ min: [-h - t, 0, h], max: [h + t, H, h + t] });
  list.push({ min: [-h - t, 0, -h], max: [-h, H, h] });
  list.push({ min: [h, 0, -h], max: [h + t, H, h] });
  return list;
}

// 광선과 AABB 교차 거리 (없으면 Infinity)
export function rayAABB(o, d, box) {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < box.min[i] || o[i] > box.max[i]) return Infinity;
    } else {
      let t1 = (box.min[i] - o[i]) / d[i];
      let t2 = (box.max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// 플레이어 피격 판정용 박스 (발 위치 기준)
export function playerHitboxes(p) {
  const r = PLAYER.hitRadius, hs = PLAYER.headHalf;
  return {
    body: { min: [p[0] - r, p[1], p[2] - r], max: [p[0] + r, p[1] + PLAYER.bodyHeight, p[2] + r] },
    head: {
      min: [p[0] - hs, p[1] + PLAYER.bodyHeight, p[2] - hs],
      max: [p[0] + hs, p[1] + PLAYER.bodyHeight + PLAYER.headSize, p[2] + hs],
    },
  };
}

// 두 점 사이에 벽/장애물이 없는지
const _SOLIDS = solidAABBs();
export function lineOfSight(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dist = Math.hypot(...d);
  if (dist < 1e-6) return true;
  const n = d.map(v => v / dist);
  for (const box of _SOLIDS) if (rayAABB(a, n, box) < dist) return false;
  return true;
}

// 서로 보이는지 (눈높이/몸통 높이 몇 군데 확인)
export function canSee(p, q) {
  for (const ha of [1.6, 0.9]) for (const hb of [1.6, 0.9]) {
    if (lineOfSight([p[0], p[1] + ha, p[2]], [q[0], q[1] + hb, q[2]])) return true;
  }
  return false;
}

// 라운드 시작 스폰 2곳: 서로 안 보이면서 가장 먼 쌍 중 랜덤
export function pickSpawnPair(rnd = Math.random) {
  const pts = SPAWN_POINTS.map(([x, z]) => [x, 0, z]);
  const pairs = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][2] - pts[j][2]);
    pairs.push({ a: pts[i], b: pts[j], d, hidden: !canSee(pts[i], pts[j]) });
  }
  const hidden = pairs.filter(p => p.hidden);
  const list = (hidden.length ? hidden : pairs).sort((x, y) => y.d - x.d);
  // 가장 먼 쌍들 중 상위 몇 개에서 골라서 매번 같은 자리만 나오지 않게
  const top = list.filter(p => p.d >= list[0].d - 8).slice(0, 8);
  const pick = top[Math.floor(rnd() * top.length)];
  return rnd() < 0.5 ? [pick.a, pick.b] : [pick.b, pick.a];
}
