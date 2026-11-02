// 플레이어/봇 공용 이동 + 충돌 처리
import { PLAYER, solidAABBs } from './map.js';

export const SOLIDS = solidAABBs();
export const MOVE = { walk: 6, run: 9, ads: 3.2, gravity: 25, jump: 8.2 };
const R = PLAYER.radius;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function overlapsXZ(p, b) {
  const cx = clamp(p.x, b.min[0], b.max[0]);
  const cz = clamp(p.z, b.min[2], b.max[2]);
  return (p.x - cx) ** 2 + (p.z - cz) ** 2 < R * R;
}

// ent: { pos:{x,y,z}, vel:{x,y,z}, onGround }
// input: { f(-1~1 앞뒤), s(-1~1 좌우), yaw, speed, jump }
export function stepMovement(ent, input, dt) {
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  let vx = -sin * input.f + cos * input.s, vz = -cos * input.f - sin * input.s;
  const len = Math.hypot(vx, vz);
  if (len > 0) { vx = vx / len * input.speed; vz = vz / len * input.speed; }
  const accel = input.accel ?? (ent.onGround ? 14 : 3);
  ent.vel.x += (vx - ent.vel.x) * Math.min(1, accel * dt);
  ent.vel.z += (vz - ent.vel.z) * Math.min(1, accel * dt);
  if (input.jump && ent.onGround) { ent.vel.y = MOVE.jump; ent.onGround = false; }

  // 수평 이동 + 밀어내기
  const p = ent.pos;
  p.x += ent.vel.x * dt;
  p.z += ent.vel.z * dt;
  let blocked = false;
  for (const b of SOLIDS) {
    if (p.y >= b.max[1] - 0.05 || p.y + 1.8 <= b.min[1]) continue;
    const cx = clamp(p.x, b.min[0], b.max[0]);
    const cz = clamp(p.z, b.min[2], b.max[2]);
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    blocked = true;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = cx + dx / d * R; p.z = cz + dz / d * R;
    } else {
      const pushes = [b.min[0] - R - p.x, b.max[0] + R - p.x, b.min[2] - R - p.z, b.max[2] + R - p.z];
      const i = pushes.reduce((bi, v, j) => Math.abs(v) < Math.abs(pushes[bi]) ? j : bi, 0);
      if (i < 2) p.x += pushes[i]; else p.z += pushes[i];
    }
  }

  // 수직 이동 (박스 위에 올라설 수 있음)
  const prevY = p.y;
  ent.vel.y -= MOVE.gravity * dt;
  p.y += ent.vel.y * dt;
  let ground = 0;
  for (const b of SOLIDS) if (prevY >= b.max[1] - 0.05 && overlapsXZ(p, b)) ground = Math.max(ground, b.max[1]);
  if (p.y <= ground) { p.y = ground; ent.vel.y = 0; ent.onGround = true; }
  else ent.onGround = false;
  return blocked;
}
