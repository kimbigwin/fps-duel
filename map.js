// 서버와 클라이언트가 함께 쓰는 아레나 정의 (좌표 단위: 미터)
export const ARENA = { half: 30, wallHeight: 6 };

// 맵 여러 개: 라운드(런은 스테이지)마다 바뀜
// 장애물: 중심 x,z / 크기 w(x축), d(z축), h(높이), kind(겉모양: wood 나무 상자, metal 컨테이너, pillar 기둥, center 벽돌 건물)
// 점프 높이가 약 1.3m라서 0.6m씩 올라가는 상자 계단으로 높은 곳(2.4m)에 올라갈 수 있음
// (x,z) = 단 가장자리, (dx,dz) = 바깥쪽 방향. 단에 붙은 칸이 가장 높고 바깥으로 갈수록 0.6m씩 낮아짐
const stairs = (x, z, dx, dz, top = 2.4, kind = 'wood') => {
  const out = [];
  for (let k = 0, h = top - 0.6; h > 0.01; k++, h -= 0.6) out.push({ x: x + dx * (k + 0.5), z: z + dz * (k + 0.5), w: dx ? 1 : 2, d: dz ? 1 : 2, h: +h.toFixed(2), kind });
  return out;
};
export const MAPS = [
  {
    name: '컨테이너 야드', sky: 0,
    boxes: [
      { x: 0, z: 0, w: 6, d: 6, h: 4, kind: 'center' },
      { x: -12, z: -10, w: 2, d: 8, h: 3 }, { x: 12, z: 10, w: 2, d: 8, h: 3 },
      { x: 10, z: -14, w: 8, d: 2, h: 3 }, { x: -10, z: 14, w: 8, d: 2, h: 3 },
      { x: -5, z: -18, w: 2.5, d: 2.5, h: 1.2 }, { x: 5, z: 18, w: 2.5, d: 2.5, h: 1.2 },
      { x: -20, z: 4, w: 2.5, d: 2.5, h: 1.2 }, { x: 20, z: -4, w: 2.5, d: 2.5, h: 1.2 },
      { x: 18, z: 20, w: 3, d: 3, h: 2 }, { x: -18, z: -20, w: 3, d: 3, h: 2 },
      { x: -8, z: 4, w: 1.5, d: 1.5, h: 5 }, { x: 8, z: -4, w: 1.5, d: 1.5, h: 5 },
    ],
  },
  {
    // 네 구석 건물 사이로 십자 골목, 가운데 높은 단(계단 2곳)
    name: '십자 골목', sky: 1,
    boxes: [
      { x: -13, z: -13, w: 9, d: 9, h: 5, kind: 'center' }, { x: 13, z: -13, w: 9, d: 9, h: 5, kind: 'center' },
      { x: -13, z: 13, w: 9, d: 9, h: 5, kind: 'center' }, { x: 13, z: 13, w: 9, d: 9, h: 5, kind: 'center' },
      { x: 0, z: 0, w: 4, d: 4, h: 2.4, kind: 'metal' },
      ...stairs(0, -2, 0, -1), ...stairs(0, 2, 0, 1),
      { x: -20, z: 0, w: 2.5, d: 2.5, h: 1.2 }, { x: 20, z: 0, w: 2.5, d: 2.5, h: 1.2 },
      { x: 0, z: 20, w: 6, d: 1, h: 1.2 }, { x: 0, z: -20, w: 6, d: 1, h: 1.2 },
      { x: -6, z: 26, w: 8, d: 2.5, h: 2.6, kind: 'metal' }, { x: 6, z: -26, w: 8, d: 2.5, h: 2.6, kind: 'metal' },
      { x: -25, z: -25, w: 3, d: 3, h: 2 }, { x: 25, z: 25, w: 3, d: 3, h: 2 },
      { x: -7, z: 7, w: 1.5, d: 1.5, h: 1.2 }, { x: 7, z: -7, w: 1.5, d: 1.5, h: 1.2 },
    ],
  },
  {
    // 기둥이 촘촘한 폐허. 낮은 벽 너머로 쏘고, 가운데 낮은 단 위가 유리함
    name: '기둥 폐허', sky: 2,
    boxes: [
      ...[-18, -6, 6, 18].flatMap(x => [-18, -6, 6, 18].filter(z => !(Math.abs(x) === 6 && Math.abs(z) === 6)).map(z => ({ x, z, w: 1.6, d: 1.6, h: 5, kind: 'pillar' }))),
      { x: 0, z: 0, w: 7, d: 7, h: 1.2, kind: 'center' },
      { x: 0, z: 0, w: 1.2, d: 3, h: 2.4, kind: 'wood' },
      { x: -12, z: 0, w: 6, d: 0.8, h: 1.2, kind: 'wood' }, { x: 12, z: 0, w: 6, d: 0.8, h: 1.2, kind: 'wood' },
      { x: 0, z: -12, w: 0.8, d: 6, h: 1.2, kind: 'wood' }, { x: 0, z: 12, w: 0.8, d: 6, h: 1.2, kind: 'wood' },
      { x: -23, z: 10, w: 2, d: 10, h: 3, kind: 'metal' }, { x: 23, z: -10, w: 2, d: 10, h: 3, kind: 'metal' },
      { x: 12, z: 23, w: 10, d: 2, h: 3, kind: 'metal' }, { x: -12, z: -23, w: 10, d: 2, h: 3, kind: 'metal' },
    ],
  },
];

// 지금 맵 (내용을 바꿔 끼우는 배열이라 다른 파일이 들고 있는 참조가 그대로 유효함)
export const BOXES = [];
export const SPAWN_POINTS = [];
const SOLID_LIST = [];
let mapIndex = -1;
export const currentMap = () => mapIndex;

// 스폰 후보 (가장자리/구석). 라운드마다 서로 안 보이고 먼 두 곳을 고릅니다.
const SPAWN_ALL = [
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
  roundEndTime: 4.5,     // 킬 후 다음 단계까지 (초). 킬캠·라운드 결과를 볼 시간 (2026-11-04: 3.4초는 결과를 읽기에 짧아서 늘림)
  pickTime: 12,          // 증강 선택 제한 시간 (초)
  gunPickTime: 10,       // 증강 뒤 총 선택 제한 시간 (초)
  augmentRounds: [1, 4, 8], // 이 라운드가 끝난 뒤 증강 선택
};

// 무기 정의는 guns.js (총 20종)

// 축 정렬 박스(AABB) 목록: 벽 + 장애물. 모든 파일이 같은 배열을 쓰고, 맵이 바뀌면 내용만 바뀜
export function solidAABBs() { return SOLID_LIST; }
// 부서지는 나무 상자 (나무 겉모양인 장애물)
export const isWood = b => b && (b.kind === 'wood' || (!b.kind && b.h <= 2));
export const CRATE_HP = 140;
// 부서진 상자는 판정을 아주 먼 곳으로 치움 (번호는 그대로 유지)
export function breakBox(i) {
  const a = SOLID_LIST[i]; if (!a || a.broken) return false;
  a.min = [0, -1000, 0]; a.max = [0, -999, 0]; a.broken = true;
  return true;
}
// 맵 바꾸기. 바뀌었으면 true
export function setMap(i, force = false) {
  i = ((i % MAPS.length) + MAPS.length) % MAPS.length;
  if (i === mapIndex && !force) return false;
  mapIndex = i;
  BOXES.length = 0; BOXES.push(...MAPS[i].boxes);
  SOLID_LIST.length = 0;
  for (const b of BOXES) SOLID_LIST.push({ min: [b.x - b.w / 2, 0, b.z - b.d / 2], max: [b.x + b.w / 2, b.h, b.z + b.d / 2] });
  const h = ARENA.half, H = ARENA.wallHeight, t = 1;
  SOLID_LIST.push({ min: [-h - t, 0, -h - t], max: [h + t, H, -h] });
  SOLID_LIST.push({ min: [-h - t, 0, h], max: [h + t, H, h + t] });
  SOLID_LIST.push({ min: [-h - t, 0, -h], max: [-h, H, h] });
  SOLID_LIST.push({ min: [h, 0, -h], max: [h + t, H, h] });
  // 장애물과 겹치는 스폰 자리는 뺌
  SPAWN_POINTS.length = 0;
  for (const [x, z] of SPAWN_ALL) if (!BOXES.some(b => Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8)) SPAWN_POINTS.push([x, z]);
  return true;
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

// 자세: cr = 앉기(0~1), ln = 기울이기(-1 왼쪽 ~ 1 오른쪽), yaw = 바라보는 방향
export const POSE = { crouchDrop: 0.5, eyeDrop: 0.55, leanHead: 0.3, leanEye: 0.35, legFrac: 0.45, legMul: 0.75 };
export const eyeHeight = (cr = 0) => PLAYER.eye - POSE.eyeDrop * cr;
// 오른쪽 방향 (x, z)
export const rightOf = yaw => [Math.cos(yaw), -Math.sin(yaw)];
// 플레이어 피격 판정용 박스 (발 위치 기준). 앉으면 낮아지고, 기울이면 머리가 옆으로 감
export function playerHitboxes(p, pose) {
  const r = PLAYER.hitRadius, hs = PLAYER.headHalf;
  const cr = pose?.cr || 0, ln = pose?.ln || 0;
  const bh = PLAYER.bodyHeight - POSE.crouchDrop * cr;
  const [rx, rz] = rightOf(pose?.yaw || 0), hx = p[0] + rx * ln * POSE.leanHead, hz = p[2] + rz * ln * POSE.leanHead;
  return {
    body: { min: [p[0] - r, p[1], p[2] - r], max: [p[0] + r, p[1] + bh, p[2] + r] },
    head: {
      min: [hx - hs, p[1] + bh, hz - hs],
      max: [hx + hs, p[1] + bh + PLAYER.headSize, hz + hs],
    },
    legTop: p[1] + bh * POSE.legFrac,   // 이 높이 아래 몸통 판정은 다리
  };
}
// 점이 장애물 안에 있는지 (기울일 때 카메라가 벽에 박히지 않게)
export function insideSolid(x, y, z, pad = 0.15) {
  for (const b of SOLID_LIST) if (x > b.min[0] - pad && x < b.max[0] + pad && y > b.min[1] && y < b.max[1] + pad && z > b.min[2] - pad && z < b.max[2] + pad) return true;
  return false;
}

// 두 점 사이에 벽/장애물이 없는지
const _SOLIDS = SOLID_LIST;
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

setMap(0);
