// 사람 캐릭터 (MakeHuman CC0 모델) + 애니메이션 리타겟 + 소총 잡는 자세(팔 IK)
//
// 왜 직접 리타겟하나:
//  - MakeHuman 모델의 기본자세는 다리를 벌린 A자세, 애니메이션(Quaternius UAL, CC0)의 기본자세는 T자세입니다.
//    뼈 회전값을 이름대로 그대로 복사하면 기본자세 차이만큼 무릎이 벌어지고 팔이 몸을 뚫습니다.
//  - 그래서 assets/motion.json 에는 "모델과 무관한 값"만 넣었습니다.
//      몸통(골반~머리): 기본자세 대비 월드 회전 변화량
//      팔다리: 매 프레임 뼈가 가리키는 월드 방향
//    여기서 이 값을 모델의 실제 뼈 구조에 맞게 다시 계산합니다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeGun } from './models.js';
import { GUNS, DEFAULT_LOADOUT } from './guns.js';

export const HUMAN_SCALE = 0.96; // 조준 자세에서 눈높이가 게임 시점(1.6m)과 같도록 (모델 키 1.82m → 1.75m)

let assets = null, loading = null;
export function loadHuman() {
  if (!loading) loading = (async () => {
    const [gltf, motion] = await Promise.all([
      new GLTFLoader().loadAsync('assets/soldier.glb'),
      fetch('assets/motion.json').then(r => { if (!r.ok) throw new Error('motion.json ' + r.status); return r.json(); }),
    ]);
    const scene = gltf.scene;
    scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      // 작업복을 군복 느낌(올리브/카키)으로 물들임 — 텍스처 무늬는 그대로, 색만 곱함
      const n = o.material.name || '';
      if (/suit/i.test(n)) militarize(o.material, [0.42, 0.45, 0.3]);
      if (/shoes/i.test(n)) militarize(o.material, [0.22, 0.2, 0.18]);
    });
    assets = { scene, clips: buildClips(scene, motion) };
    return assets;
  })();
  return loading;
}
export const humanReady = () => !!assets;

// 옷 텍스처를 흑백으로 바꾼 뒤 색을 입힘 (파란 작업복 → 올리브 군복 느낌, 주름/무늬는 유지)
function militarize(mat, rgb) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.tint = { value: new THREE.Color(...rgb) };
    sh.fragmentShader = 'uniform vec3 tint;\n' + sh.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\n diffuseColor.rgb = tint * (0.3 + lum * 0.9);');
  };
  mat.customProgramCacheKey = () => 'mil' + rgb.join();
  mat.needsUpdate = true;
}

function decode(b64) {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer);
}
function boneMap(root) {
  const m = {};
  root.traverse(o => { if (o.isBone) m[o.name.toLowerCase()] = o; });
  return m;
}
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function buildClips(root, M) {
  root.updateMatrixWorld(true);
  const B = boneMap(root);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const restW = {}, restPos = {};
  for (const [k, b] of Object.entries(B)) {
    const mw = new THREE.Matrix4().multiplyMatrices(rootInv, b.matrixWorld);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    mw.decompose(p, q, s); restW[k] = q; restPos[k] = p;
  }
  const parentW0 = b => {
    // 애니메이션 대상이 아닌 부모(Root 등)의 고정 월드 회전
    const p = b.parent; const mw = new THREE.Matrix4().multiplyMatrices(rootInv, p.matrixWorld);
    const q = new THREE.Quaternion(); mw.decompose(_v, q, _v2); return q;
  };
  const CHILD = { clavicle_l: 'upperarm_l', upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', hand_l: 'middle_01_l',
    clavicle_r: 'upperarm_r', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r', hand_r: 'middle_01_r',
    thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'ball_l', thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'ball_r' };
  const tgtLeg = restPos.thigh_l.distanceTo(restPos.calf_l) + restPos.calf_l.distanceTo(restPos.foot_l);
  const legScale = tgtLeg / M.srcLeg;
  const pelvis = B.pelvis, pelvisParentInv = parentW0(pelvis).invert();
  const clips = {};
  for (const [name, c] of Object.entries(M.clips)) {
    const tq = decode(c.tq), ld = decode(c.ld), pp = decode(c.pp);
    const nT = M.torso.length, nL = M.limbs.length;
    const times = new Float32Array(c.n);
    const qv = {}; for (const b of [...M.torso, ...M.limbs]) qv[b] = new Float32Array(c.n * 4);
    const pv = new Float32Array(c.n * 3);
    for (let f = 0; f < c.n; f++) {
      times[f] = Math.min(c.dur, f / M.fps);
      const W = {}; // 이번 프레임 모델 공간 월드 회전
      M.torso.forEach((b, i) => {
        const o = (f * nT + i) * 4;
        const d = new THREE.Quaternion(tq[o] / 32767, tq[o + 1] / 32767, tq[o + 2] / 32767, tq[o + 3] / 32767).normalize();
        W[b] = d.multiply(restW[b]);
      });
      M.limbs.forEach((b, i) => {
        const bone = B[b], pn = bone.parent.name.toLowerCase();
        const pW = W[pn] || parentW0(bone);
        const carried = pW.clone().multiply(bone.quaternion);            // 부모를 따라간 기본자세
        const cdir = B[CHILD[b]].position.clone().normalize().applyQuaternion(carried);
        const o = (f * nL + i) * 3;
        const want = new THREE.Vector3(ld[o], ld[o + 1], ld[o + 2]).normalize();
        W[b] = new THREE.Quaternion().setFromUnitVectors(cdir, want).multiply(carried);
      });
      for (const b of [...M.torso, ...M.limbs]) {
        const bone = B[b], pn = bone.parent.name.toLowerCase();
        const pW = W[pn] || parentW0(bone);
        const local = pW.clone().invert().multiply(W[b]);
        local.toArray(qv[b], f * 4);
      }
      // 골반 위치: 원본 이동량을 다리 길이 비율로 맞춤
      const d = new THREE.Vector3(pp[f * 3], pp[f * 3 + 1], pp[f * 3 + 2]).multiplyScalar(legScale / 1000);
      const wp = restPos.pelvis.clone().add(d);
      // 부모(Root) 공간으로
      const parentMw = new THREE.Matrix4().multiplyMatrices(rootInv, pelvis.parent.matrixWorld);
      wp.applyMatrix4(parentMw.clone().invert());
      wp.toArray(pv, f * 3);
    }
    const tracks = [];
    for (const b of [...M.torso, ...M.limbs]) tracks.push(new THREE.QuaternionKeyframeTrack(B[b].name + '.quaternion', times, qv[b]));
    tracks.push(new THREE.VectorKeyframeTrack(pelvis.name + '.position', times, pv));
    clips[name] = new THREE.AnimationClip(name, c.dur, tracks);
  }
  void pelvisParentInv;
  return clips;
}

// 클립별 한 걸음 주기 동안 이동하는 거리(m) — 발 미끄러짐을 줄이려고 재생 속도를 이동 속도에 맞춤
const CYCLE = { walk: 1.29, jog: 2.33, sprint: 2.2 };
// 총 위치 (가슴 뼈 기준, 캐릭터 공간: 앞 = -Z, 오른쪽 = +X). 총 기준점 = 총 윗면, 방아쇠 위치
const GUN_OFS = {
  long: new THREE.Vector3(0.13, 0.175, -0.28),     // 소총/샷건/저격총: 개머리판을 어깨에
  smg: new THREE.Vector3(0.12, 0.17, -0.32),
  pistol: new THREE.Vector3(0.07, 0.17, -0.5),     // 권총: 두 팔을 앞으로 뻗음
};
const ofsFor = cls => GUN_OFS[cls === 'pistol' ? 'pistol' : cls === 'smg' ? 'smg' : 'long'];
// 모델이 오기 전 임시 손 위치 (총 기준)
const GRIP = new THREE.Vector3(0, -0.12, 0.17), FORE = new THREE.Vector3(0, -0.06, -0.3);

export class Human {
  constructor() {
    this.group = new THREE.Group();                         // 바깥: 게임 좌표 (앞 = -Z)
    this.body = SkeletonUtils.clone(assets.scene);
    this.body.scale.setScalar(HUMAN_SCALE);
    this.body.rotation.y = Math.PI;                         // 모델은 +Z를 봄 → 뒤집기
    this.group.add(this.body);
    this.B = boneMap(this.body);
    this.mixer = new THREE.AnimationMixer(this.body);
    this.act = {};
    for (const [k, clip] of Object.entries(assets.clips)) {
      const a = this.mixer.clipAction(clip);
      if (k === 'death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play(); a.setEffectiveWeight(0); a.timeScale = 0;
      this.act[k] = a;
    }
    this.mount = new THREE.Group(); this.group.add(this.mount);
    this.guns = {};
    this.group.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) { o.castShadow = true; } });
    this.phase = 0; this.legYaw = 0; this.idleT = 0; this.deadT = -1;
    this.setWeapon(DEFAULT_LOADOUT[0]);
    this.restLocal = {}; for (const [k, b] of Object.entries(this.B)) this.restLocal[k] = b.quaternion.clone();
    this.armLen = {};
    for (const side of ['l', 'r']) {
      this.armLen[side] = [this.B['lowerarm_' + side].position.length() * HUMAN_SCALE, this.B['hand_' + side].position.length() * HUMAN_SCALE];
    }
  }

  // 총은 처음 들 때 만듦. 크기 0.72 = 실제 총 길이에 가깝게
  getGun(id) {
    if (!this.guns[id]) { const g = makeGun(id); g.scale.setScalar(0.72); this.mount.add(g); this.guns[id] = g; }
    return this.guns[id];
  }
  setWeapon(w) {
    if (!GUNS[w]) w = DEFAULT_LOADOUT[0];
    this.weapon = w; this.getGun(w);
    for (const k in this.guns) this.guns[k].visible = k === w;
  }

  // st: { speed, fN, sN, air, pitch, flinch, flinchHead, dead }
  update(dt, st) {
    const A = this.act;
    if (st.dead) {
      if (this.deadT < 0) {
        this.deadT = 0;
        for (const k in A) A[k].setEffectiveWeight(0);
        A.death.reset(); A.death.timeScale = 1; A.death.setEffectiveWeight(1); A.death.play();
        this.legYaw = 0; this.body.rotation.y = this.deathFlip ? 0 : Math.PI;
      }
      this.deadT += dt;
      this.mixer.update(dt);
      // 총은 떨어뜨린 것처럼 바닥으로
      this.mount.position.y = Math.max(0.05, this.mount.position.y - dt * 3);
      this.mount.rotation.z = Math.min(1.5, this.mount.rotation.z + dt * 5);
      return;
    }
    if (this.deadT >= 0) { this.deadT = -1; A.death.stop(); A.death.setEffectiveWeight(0); this.mount.rotation.z = 0; }

    // ---- 하체: 이동 방향으로 다리 돌리기 (뒤로 걸으면 역재생) ----
    const sp = st.speed;
    let ang = sp > 0.4 ? Math.atan2(st.sN, st.fN) : 0, dir = 1;
    if (Math.abs(ang) > 1.75) { ang = ang - Math.sign(ang) * Math.PI; dir = -1; }
    ang = Math.max(-1.1, Math.min(1.1, ang));
    this.legYaw += (ang - this.legYaw) * (1 - Math.exp(-10 * dt));
    this.body.rotation.y = Math.PI - this.legYaw;

    // ---- 블렌드 가중치 ----
    const tri = (x, a, b, c) => x <= a || x >= c ? 0 : x < b ? (x - a) / (b - a) : (c - x) / (c - b);
    let w = { idle: 0, walk: 0, jog: 0, sprint: 0, jump: 0 };
    if (st.air) w.jump = 1;
    else {
      w.idle = Math.max(0, 1 - sp / 1.2);
      w.walk = tri(sp, 0, 1.4, 4);
      w.jog = tri(sp, 1.4, 4, 7.5);
      w.sprint = sp >= 7.5 ? 1 : tri(sp, 4, 7.5, 99);
    }
    const tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    // 걸음 주기를 하나로 맞춰 섞어도 발이 꼬이지 않게
    let cyc = 0, cw = 0;
    for (const k of ['walk', 'jog', 'sprint']) { cyc += CYCLE[k] * w[k]; cw += w[k]; }
    if (cw > 0) {
      let rate = sp / (cyc / cw);                 // 초당 걸음 주기
      rate = Math.min(rate, 2.6);                 // 게임 이동이 빨라서 너무 빨리 발을 놀리지 않게 제한
      this.phase = (this.phase + dir * rate * dt + 1) % 1;
    }
    this.idleT += dt;
    for (const k of ['idle', 'walk', 'jog', 'sprint', 'jump']) {
      const a = A[k]; a.setEffectiveWeight(w[k] / tot);
      const d = a.getClip().duration;
      a.time = k === 'idle' || k === 'jump' ? this.idleT % d : this.phase * d;
    }
    this.mixer.update(0);

    // ---- 상체: 조준 방향으로 비틀기 + 숙이기 ----
    this.group.updateMatrixWorld(true);
    const B = this.B;
    const up = _v.set(0, 1, 0);
    const gq = this.group.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(gq);
    // 상체 세우기: 달리기 클립은 몸을 많이 숙여서 머리가 판정 박스 밖으로 나감 → 머리를 골반 위로 되돌림
    {
      const hip = B.spine_01.getWorldPosition(new THREE.Vector3());
      const hd = B.head.getWorldPosition(new THREE.Vector3());
      this.group.worldToLocal(hip); this.group.worldToLocal(hd);
      const cur = hd.sub(hip);
      const len = cur.length();
      const want = new THREE.Vector3(cur.x * 0.4, 0, -0.07).setY(Math.sqrt(Math.max(0.01, len * len - (cur.x * 0.4) ** 2 - 0.0049)));
      const r = new THREE.Quaternion().setFromUnitVectors(cur.normalize(), want.normalize());
      rotWorld(B.spine_01, gq.clone().multiply(r).multiply(gq.clone().invert()));
    }
    const spines = ['spine_01', 'spine_02', 'spine_03'];
    const flinch = st.flinch || 0;
    for (const s of spines) {
      rotWorld(B[s], new THREE.Quaternion().setFromAxisAngle(up, this.legYaw / 3));
      rotWorld(B[s], new THREE.Quaternion().setFromAxisAngle(right, st.pitch * (st.pitch < 0 ? 0.04 : 0.1) + flinch * 0.1));
    }
    // 머리는 조준 방향을 봄: 클립이 숙인 몸을 보상하려고 고개를 젖힌 것까지 되돌려 머리 축을 직접 맞춤
    {
      const hq = B.head.getWorldQuaternion(new THREE.Quaternion());
      const curUp = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
      const a = st.pitch * (st.pitch < 0 ? 0.3 : 0.5) + (st.flinchHead ? flinch * 0.6 : 0);
      const wantUp = new THREE.Vector3(0, Math.cos(a), Math.sin(a)).applyQuaternion(gq); // 위로 볼수록 뒤로 젖힘
      rotWorld(B.head, new THREE.Quaternion().setFromUnitVectors(curUp, wantUp));
    }

    // ---- 총: 가슴 앞, 조준 각도 그대로 ----
    const chest = B.spine_03.getWorldPosition(new THREE.Vector3());
    this.group.worldToLocal(chest);
    const pr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), st.pitch);
    // 어깨 높이를 축으로 돌려서 위/아래를 봐도 개머리판이 어깨에 붙어 있게
    const gun = this.guns[this.weapon], o = ofsFor(gun.userData.cls);
    const pivot = chest.clone().add(new THREE.Vector3(o.x, o.y, 0));
    this.mount.position.copy(pivot).add(new THREE.Vector3(0, 0, o.z + flinch * 0.05).applyQuaternion(pr));
    this.mount.quaternion.copy(pr);
    this.mount.updateMatrixWorld(true);

    // ---- 팔: 두 관절 IK로 손을 손잡이/총열 덮개에 ----
    const gripW = gun.localToWorld((gun.userData.grip || GRIP).clone());
    const foreW = gun.localToWorld((gun.userData.fore || FORE).clone());
    const gunQ = gun.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(gunQ);
    const gUp = new THREE.Vector3(0, 1, 0).applyQuaternion(gunQ);
    const gRight = new THREE.Vector3(1, 0, 0).applyQuaternion(gunQ);
    // 손 방향(손가락 = 손목→손가락뿌리, 손바닥이 향하는 쪽)
    const fR = fwd.clone().multiplyScalar(0.75).addScaledVector(gUp, -0.66).normalize();
    const nR = gRight.clone().negate();                                 // 오른손 손바닥은 손잡이(왼쪽)를 향함
    const fL = fwd.clone().multiplyScalar(0.8).addScaledVector(gRight, 0.6).normalize();
    const nL = gUp.clone().addScaledVector(gRight, 0.3).normalize();   // 왼손 손바닥은 위(총열 덮개 밑)
    // 손목 위치: 손바닥이 손잡이를 감싸도록 손목을 뒤/옆으로 뺌
    const wristR = gripW.clone().addScaledVector(fR, -0.06).addScaledVector(gRight, 0.035);
    const wristL = foreW.clone().addScaledVector(fL, -0.06).addScaledVector(gUp, -0.045);
    // 팔꿈치 방향: 오른팔은 아래·바깥, 왼팔은 아래·약간 바깥
    this.ik('r', wristR, gRight.clone().multiplyScalar(0.6).addScaledVector(gUp, -1).addScaledVector(fwd, -0.3));
    this.ik('l', wristL, gRight.clone().multiplyScalar(-0.4).addScaledVector(gUp, -1));
    this.orientHand('r', fR, nR);
    this.orientHand('l', fL, nL);
    this.curlFingers();
  }

  // 두 관절 IK: 어깨-팔꿈치-손목
  ik(side, target, pole) {
    const B = this.B, ua = B['upperarm_' + side], la = B['lowerarm_' + side], hd = B['hand_' + side];
    const [L1, L2] = this.armLen[side];
    ua.parent.updateMatrixWorld(true);
    const S = ua.getWorldPosition(new THREE.Vector3());
    const toT = target.clone().sub(S);
    let d = toT.length();
    d = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-3, d));
    const dirT = toT.normalize();
    const a = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const ang = Math.acos(Math.max(-1, Math.min(1, a)));
    const bendN = pole.clone().sub(dirT.clone().multiplyScalar(pole.dot(dirT))).normalize();
    const elbowDir = dirT.clone().multiplyScalar(Math.cos(ang)).addScaledVector(bendN, Math.sin(ang));
    const E = S.clone().addScaledVector(elbowDir, L1);
    const W = S.clone().addScaledVector(dirT, d);
    aimBone(ua, la, E);
    aimBone(la, hd, W);
  }

  orientHand(side, fingerDir, palmUp) {
    const hd = this.B['hand_' + side], mid = this.B['middle_01_' + side];
    hd.updateMatrixWorld(true);
    // 현재 손가락 방향, 손바닥 법선 = 손가락을 굽히는 쪽(손가락 뼈의 로컬 +Z, +X축으로 굽힘)
    const hq = hd.getWorldQuaternion(new THREE.Quaternion());
    const f0 = mid.position.clone().normalize().applyQuaternion(hq);
    const mq = hq.clone().multiply(this.restLocal['middle_01_' + side]);
    const n0 = new THREE.Vector3(0, 0, 1).applyQuaternion(mq);
    n0.sub(f0.clone().multiplyScalar(n0.dot(f0))).normalize();
    const f1 = fingerDir.normalize();
    const n1 = palmUp.sub(f1.clone().multiplyScalar(palmUp.dot(f1))).normalize();
    const m0 = basis(f0, n0), m1 = basis(f1, n1);
    const r = new THREE.Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose()));
    rotWorld(hd, r);
  }

  curlFingers() {
    for (const side of ['l', 'r']) {
      for (const f of ['index', 'middle', 'ring', 'pinky']) {
        for (let i = 1; i <= 3; i++) {
          const b = this.B[`${f}_0${i}_${side}`]; if (!b) continue;
          const curl = side === 'r' && f === 'index' ? 0.35 : i === 1 ? 0.9 : 1.0; // 오른손 검지는 방아쇠 위
          b.quaternion.copy(this.restLocal[`${f}_0${i}_${side}`]).multiply(_q.setFromAxisAngle(_v2.set(1, 0, 0), curl));
        }
      }
    }
  }
}

function basis(f, n) {
  const s = new THREE.Vector3().crossVectors(f, n).normalize();
  const n2 = new THREE.Vector3().crossVectors(s, f).normalize();
  return new THREE.Matrix4().makeBasis(f, n2, s);
}
// 월드 회전 r을 뼈에 덧붙임
function rotWorld(bone, r) {
  bone.parent.updateMatrixWorld(true);
  const pq = bone.parent.getWorldQuaternion(_q2);
  const wq = pq.clone().multiply(bone.quaternion);
  wq.premultiply(r);
  bone.quaternion.copy(pq.invert().multiply(wq));
  bone.updateMatrixWorld(true);
}
// bone이 child 쪽을 target 점으로 향하게
function aimBone(bone, child, target) {
  bone.updateMatrixWorld(true);
  const p = bone.getWorldPosition(new THREE.Vector3());
  const c = child.getWorldPosition(new THREE.Vector3());
  const cur = c.sub(p).normalize();
  const want = target.clone().sub(p).normalize();
  rotWorld(bone, new THREE.Quaternion().setFromUnitVectors(cur, want));
}
