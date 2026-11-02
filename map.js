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

export const SPAWNS = [
  { x: 0, z: 25, yaw: 0 },        // -z 방향(중앙)을 바라봄
  { x: 0, z: -25, yaw: Math.PI },
];

export const PLAYER = {
  radius: 0.4,
  eye: 1.6,
  bodyHeight: 1.4, // 발~어깨
  headSize: 0.5,
};

export const RULES = {
  maxHp: 100,
  respawnTime: 3,     // 초
  winScore: 5,
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
  const r = PLAYER.radius, hs = PLAYER.headSize / 2;
  return {
    body: { min: [p[0] - r, p[1], p[2] - r], max: [p[0] + r, p[1] + PLAYER.bodyHeight, p[2] + r] },
    head: {
      min: [p[0] - hs, p[1] + PLAYER.bodyHeight, p[2] - hs],
      max: [p[0] + hs, p[1] + PLAYER.bodyHeight + PLAYER.headSize, p[2] + hs],
    },
  };
}
