// 총기 / 캐릭터 모델 (기본 도형 조합, 직접 디자인)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PLAYER } from './map.js';

const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.42, metalness: 0.55 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.5, metalness: 0.5 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x3a3b36, roughness: 0.75, metalness: 0.05 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x8b7a58, roughness: 0.7, metalness: 0.05 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xff7a2f, roughness: 0.5, metalness: 0.2 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0b1a2a, roughness: 0.05, metalness: 0.9, envMapIntensity: 2 }),
  redDot: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(4), toneMapped: false }),
  glove: new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x4b5240, roughness: 0.95 }),
};

function box(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; return m;
}
function cyl(r, len, mat, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); m.castShadow = true; return m;
}

// 돌격소총: 길이 약 0.85
export function makeRifle() {
  const g = new THREE.Group();
  g.add(box(0.07, 0.09, 0.38, M.metal, 0, 0, 0));                 // 리시버
  g.add(box(0.075, 0.085, 0.3, M.polymer, 0, -0.003, -0.33));     // 핸드가드
  for (let i = 0; i < 5; i++) g.add(box(0.077, 0.012, 0.03, M.darkMetal, 0, 0.035, -0.22 - i * 0.05)); // 레일 홈
  g.add(cyl(0.012, 0.25, M.darkMetal, 0, 0.005, -0.58));           // 총열
  g.add(cyl(0.02, 0.06, M.darkMetal, 0, 0.005, -0.72, 6));         // 소염기
  g.add(box(0.03, 0.015, 0.4, M.darkMetal, 0, 0.055, -0.08));      // 상부 레일
  const mag = new THREE.Group();
  mag.add(box(0.045, 0.2, 0.08, M.tan, 0, -0.1, 0, 0.18));
  mag.add(box(0.047, 0.03, 0.085, M.darkMetal, 0, -0.2, 0.02, 0.18));
  mag.position.set(0, -0.04, -0.06); g.add(mag);
  g.add(box(0.045, 0.13, 0.06, M.polymer, 0, -0.09, 0.12, -0.35)); // 손잡이
  g.add(box(0.03, 0.03, 0.08, M.darkMetal, 0, -0.06, 0.05));       // 방아쇠울
  g.add(box(0.05, 0.08, 0.26, M.polymer, 0, -0.015, 0.3));         // 개머리판
  g.add(box(0.055, 0.11, 0.04, M.darkMetal, 0, -0.02, 0.43));
  // 도트 사이트
  const sight = new THREE.Group();
  sight.add(box(0.05, 0.012, 0.09, M.darkMetal, 0, 0, 0));
  sight.add(box(0.008, 0.055, 0.07, M.darkMetal, -0.024, 0.03, 0));
  sight.add(box(0.008, 0.055, 0.07, M.darkMetal, 0.024, 0.03, 0));
  sight.add(box(0.05, 0.008, 0.07, M.darkMetal, 0, 0.058, 0));
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.045), new THREE.MeshStandardMaterial({ color: 0x88aacc, transparent: true, opacity: 0.18, roughness: 0, metalness: 1 }));
  lens.position.set(0, 0.03, 0); sight.add(lens);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 8), M.redDot); dot.position.set(0, 0.03, -0.01); sight.add(dot);
  sight.position.set(0, 0.068, -0.02); g.add(sight);
  g.add(box(0.012, 0.03, 0.05, M.accent, 0.04, 0.0, 0.1));          // 장식 포인트
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, -0.76); g.add(muzzle);
  g.userData = { mag, muzzle, optic: sight, opticBase: 0.062, sightHeight: 0.098, kind: 'rifle', len: 1.2 };
  boxAnims(g);
  register(g);
  return g;
}

// 저격총: 길이 약 1.25
export function makeSniper() {
  const g = new THREE.Group();
  g.add(box(0.07, 0.08, 0.32, M.darkMetal, 0, 0, 0));              // 리시버
  g.add(box(0.08, 0.1, 0.5, M.tan, 0, -0.02, -0.33));              // 총몸(우드/폴리머)
  g.add(cyl(0.016, 0.6, M.metal, 0, 0.01, -0.82));                 // 긴 총열
  g.add(cyl(0.026, 0.09, M.darkMetal, 0, 0.01, -1.15, 8));         // 머즐브레이크
  g.add(box(0.06, 0.012, 0.03, M.darkMetal, 0, 0.01, -1.15));
  // 노리쇠 손잡이
  const bolt = new THREE.Group();
  bolt.add(cyl(0.008, 0.08, M.metal, 0, 0, 0)); bolt.children[0].rotation.set(0, 0, Math.PI / 2);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 10), M.metal); knob.position.x = 0.045; bolt.add(knob);
  bolt.position.set(0.04, 0.02, 0.08); g.add(bolt);
  // 스코프
  const scope = new THREE.Group();
  scope.add(cyl(0.022, 0.32, M.darkMetal, 0, 0, 0, 20));
  scope.add(cyl(0.032, 0.08, M.darkMetal, 0, 0, -0.17, 20));
  scope.add(cyl(0.028, 0.06, M.darkMetal, 0, 0, 0.16, 20));
  const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), M.glass); lensF.position.z = -0.211; lensF.rotation.y = Math.PI; scope.add(lensF);
  scope.add(cyl(0.012, 0.04, M.darkMetal, 0, 0.03, 0));            // 다이얼
  scope.add(box(0.02, 0.04, 0.03, M.darkMetal, 0, -0.035, -0.08));  // 마운트
  scope.add(box(0.02, 0.04, 0.03, M.darkMetal, 0, -0.035, 0.08));
  scope.position.set(0, 0.085, -0.02); g.add(scope);
  const mag = new THREE.Group(); mag.add(box(0.05, 0.08, 0.1, M.darkMetal, 0, -0.04, 0)); mag.position.set(0, -0.05, -0.04); g.add(mag);
  g.add(box(0.045, 0.13, 0.06, M.polymer, 0, -0.09, 0.14, -0.3));  // 손잡이
  g.add(box(0.06, 0.1, 0.32, M.tan, 0, -0.03, 0.33));              // 개머리판
  g.add(box(0.05, 0.04, 0.16, M.polymer, 0, 0.035, 0.3));          // 볼받침
  g.add(box(0.065, 0.13, 0.03, M.polymer, 0, -0.03, 0.5));
  // 접힌 양각대
  g.add(box(0.012, 0.012, 0.2, M.metal, 0.03, -0.07, -0.5)); g.add(box(0.012, 0.012, 0.2, M.metal, -0.03, -0.07, -0.5));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -1.2); g.add(muzzle);
  g.userData = { mag, muzzle, bolt, optic: scope, opticBase: 0.03, sightHeight: 0.085, kind: 'sniper', len: 1.55 };
  boxAnims(g);
  register(g);
  return g;
}

// ---------- 총 3D 모델 (CC0 Flat Guns, Pichuliru / OpenGameArt) ----------
// 상자 총을 먼저 보여 주고, 모델 파일이 로드되면 겉모습만 바꿉니다.
// 조준경(도트사이트/스코프)과 총구 위치 기준은 그대로 두고, 모델을 거기에 맞춰 붙입니다.
const GUN_FILES = { rifle: 'assets/guns/rifle.glb', sniper: 'assets/guns/sniper.glb' };
const gunAssets = {};
const madeGuns = [];
function register(g) { madeGuns.push(g); if (gunAssets[g.userData.kind]) upgradeGun(g); }
// 상자 총용 탄창 빼기/노리쇠 동작
function boxAnims(g) {
  const ud = g.userData, magY = ud.mag.position.y;
  ud.magDrop = amt => { ud.mag.position.y = magY - amt; };
  ud.boltPull = e => { if (ud.bolt) { ud.bolt.position.z = 0.08 + 0.08 * e; ud.bolt.rotation.z = -0.8 * e; } };
}
let gunsLoading = null;
export function loadGunModels() {
  if (!gunsLoading) gunsLoading = Promise.all(Object.entries(GUN_FILES).map(async ([kind, url]) => {
    const gltf = await new GLTFLoader().loadAsync(url);
    gunAssets[kind] = gltf.scene;
    for (const g of madeGuns) if (g.userData.kind === kind) upgradeGun(g);
  }));
  return gunsLoading;
}
// GLTFLoader가 이름의 '.'과 공백을 바꾸므로 정리한 이름으로 비교
const clean = n => n.replace(/[\s.:\/\[\]_]/g, '').toLowerCase();
function findBone(root, name) { const k = clean(name); let b = null; root.traverse(o => { if (!b && clean(o.name) === k) b = o; }); return b; }
function upgradeGun(g) {
  const ud = g.userData;
  if (ud.upgraded) return;
  const model = SkeletonUtils.clone(gunAssets[ud.kind]);
  const holder = new THREE.Group(); holder.add(model);
  // 원본 모델에서 크기와 방향 재기
  model.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(model);
  const mz = findBone(model, 'Attach_Muzzle').getWorldPosition(new THREE.Vector3());
  const lenZ = bb.max.z - bb.min.z;
  // 총구가 -Z(게임의 앞)로 오게
  if (mz.z > (bb.min.z + bb.max.z) / 2) model.rotation.y = Math.PI;
  const s = ud.len / lenZ;
  holder.scale.setScalar(s);
  g.add(holder);
  // 총구를 기존 총구 위치에, 조준경 받침을 기존 조준경 높이에 맞춤
  g.updateMatrixWorld(true);
  const toG = v => g.worldToLocal(v);
  const muzzleG = toG(findBone(model, 'Attach_Muzzle').getWorldPosition(new THREE.Vector3()));
  const scopeG = toG(findBone(model, 'Attach_Scope').getWorldPosition(new THREE.Vector3()));
  holder.position.set(-muzzleG.x, ud.opticBase - scopeG.y, ud.muzzle.position.z - muzzleG.z);
  g.updateMatrixWorld(true);
  ud.muzzle.position.copy(toG(findBone(model, 'Attach_Muzzle').getWorldPosition(new THREE.Vector3())));
  // 상자 부품 숨기기 (조준경, 총구 기준점은 유지)
  for (const c of g.children) if (c !== holder && c !== ud.optic && c !== ud.muzzle) c.visible = false;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  // 손 위치 (사람 모델의 팔 IK용): 방아쇠 뒤 손잡이, 총열 덮개 아래 레일
  const trig = toG(findBone(model, 'Trigger').getWorldPosition(new THREE.Vector3()));
  const rail = toG(findBone(model, 'Attach_Rail.Bottom').getWorldPosition(new THREE.Vector3()));
  ud.grip = trig.clone().add(new THREE.Vector3(0, -0.08, 0.11));
  ud.fore = rail.clone().add(new THREE.Vector3(0, -0.02, 0));
  // 탄창/노리쇠 뼈를 움직여 재장전/볼트 동작
  const dirIn = (bone, v) => {
    const a = bone.parent.worldToLocal(g.localToWorld(new THREE.Vector3()));
    const b = bone.parent.worldToLocal(g.localToWorld(v.clone()));
    return b.sub(a);
  };
  const mag = findBone(model, 'Magazine');
  if (mag) { const rest = mag.position.clone(), down = dirIn(mag, new THREE.Vector3(0, -1, 0)); ud.magDrop = amt => mag.position.copy(rest).addScaledVector(down, amt); }
  const bolt = findBone(model, 'Bolt');
  if (bolt) { const rest = bolt.position.clone(), back = dirIn(bolt, new THREE.Vector3(0, 0, 1)); ud.boltPull = e => bolt.position.copy(rest).addScaledVector(back, 0.09 * e); }
  ud.upgraded = true;
}

// 두 점 사이를 잇는 원통 (팔뚝 등)
function limb(a, b, r1, r2, mat, seg = 12) {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(r2, r1, len, seg);
  geo.translate(0, len / 2, 0); geo.rotateX(Math.PI / 2); // +z 방향으로 길이
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a); m.lookAt(b); m.castShadow = true;
  return m;
}
function capsule(r, len, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}

const HM = {
  glove: new THREE.MeshStandardMaterial({ color: 0x8a7656, roughness: 0.85 }),   // 코요테 탄 색 장갑
  palm: new THREE.MeshStandardMaterial({ color: 0x5d5140, roughness: 0.95 }),
  pad: new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.6 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc08a68, roughness: 0.7 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x505842, roughness: 0.95 }),
  cuff: new THREE.MeshStandardMaterial({ color: 0x3b4131, roughness: 0.95 }),
  watch: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.6 }),
};

// 오른손: 권총 손잡이를 감싸 쥐고 검지는 방아쇠에
function rightHand() {
  const h = new THREE.Group();
  // 손등 (손잡이 오른쪽 면)
  h.add(box(0.026, 0.095, 0.08, HM.glove, 0.036, -0.01, 0.005));
  h.add(box(0.012, 0.07, 0.05, HM.pad, 0.05, 0.0, -0.005)); // 손등 보호대
  // 손바닥 뒤쪽 (손잡이 뒤)
  h.add(box(0.07, 0.09, 0.03, HM.palm, 0.005, -0.012, 0.045));
  // 중지/약지/소지: 손잡이 앞을 감쌈
  for (let i = 0; i < 3; i++) {
    const y = -0.025 - i * 0.026;
    h.add(capsule(0.0105, 0.045, HM.glove, 0.0, y, -0.036, 0, 0, Math.PI / 2));
    h.add(capsule(0.0105, 0.014, HM.pad, -0.03, y, -0.02, Math.PI / 2, 0, 0)); // 손끝 (왼쪽 면)
    h.add(capsule(0.011, 0.01, HM.pad, 0.032, y, -0.032, 0, 0, Math.PI / 2)); // 관절
  }
  // 검지: 방아쇠 위로 뻗음
  h.add(capsule(0.0095, 0.04, HM.glove, 0.026, 0.03, -0.045, Math.PI / 2, 0, 0.15));
  h.add(capsule(0.009, 0.02, HM.glove, 0.01, 0.03, -0.085, Math.PI / 2, 0.5, 0));
  // 엄지: 손잡이 왼쪽 위
  h.add(capsule(0.011, 0.035, HM.glove, -0.03, 0.035, -0.01, Math.PI / 2 - 0.3, 0, 0));
  return h;
}

// 왼손: 총열 덮개 아래를 받치고 손가락이 왼쪽 면을 감쌈
function leftHand() {
  const h = new THREE.Group();
  h.add(box(0.075, 0.025, 0.1, HM.palm, 0.0, -0.052, 0.0));          // 손바닥 (아래)
  h.add(box(0.026, 0.06, 0.095, HM.glove, 0.045, -0.035, 0.0));      // 엄지쪽 두툼한 부분 (오른쪽)
  for (let i = 0; i < 4; i++) {
    const z = -0.036 + i * 0.024;
    h.add(capsule(0.0105, 0.035, HM.glove, -0.044, -0.022, z, 0, 0, 0)); // 왼쪽 면으로 올라온 손가락
    h.add(capsule(0.0105, 0.012, HM.pad, -0.038, 0.012, z, 0, 0, 0.9));  // 손끝
  }
  h.add(capsule(0.011, 0.04, HM.glove, 0.044, 0.005, -0.03, Math.PI / 2, 0, 0)); // 엄지 (오른쪽 면 위)
  return h;
}

// 1인칭 팔 + 손. update(weapon, 재장전 진행도)로 손 위치를 무기에 맞춤
export function makeArms() {
  const g = new THREE.Group();
  const R = rightHand(), L = leftHand();
  g.add(R, L);
  const armR = new THREE.Group(), armL = new THREE.Group();
  g.add(armR, armL);
  const GRIP = { rifle: { p: new THREE.Vector3(0, -0.1, 0.12), rx: -0.35 }, sniper: { p: new THREE.Vector3(0, -0.1, 0.14), rx: -0.3 } };
  const FORE = { rifle: new THREE.Vector3(0, -0.012, -0.34), sniper: new THREE.Vector3(0, -0.035, -0.4) };
  const ELBOW_R = new THREE.Vector3(0.2, -0.24, 0.42), ELBOW_L = new THREE.Vector3(-0.22, -0.3, 0.02);
  const MAG = { rifle: new THREE.Vector3(0, -0.2, -0.05), sniper: new THREE.Vector3(0, -0.12, -0.04) };

  function rebuildArm(group, wrist, elbow, watch) {
    group.clear();
    const w = wrist.clone(), e = elbow.clone();
    group.add(limb(w, e, 0.03, 0.047, HM.sleeve));
    // 손목 근처 소매 끝단 + 피부 살짝
    const cuffPos = w.clone().lerp(e, 0.18);
    group.add(limb(w.clone().lerp(e, 0.06), cuffPos, 0.026, 0.028, HM.skin));
    group.add(limb(cuffPos, w.clone().lerp(e, 0.3), 0.036, 0.039, HM.cuff));
    if (watch) group.add(limb(w.clone().lerp(e, 0.1), w.clone().lerp(e, 0.15), 0.031, 0.031, HM.watch));
  }

  let key = '';
  g.userData.update = (weapon, reloadT = -1, bolt = 0) => {
    const gp = GRIP[weapon];
    R.position.copy(gp.p); R.rotation.set(gp.rx, 0, 0);
    // 왼손: 재장전 중이면 탄창으로 갔다가 돌아옴
    const fore = FORE[weapon].clone();
    let lt = 0;
    if (reloadT >= 0) lt = reloadT < 0.15 ? reloadT / 0.15 : reloadT < 0.75 ? 1 : Math.max(0, 1 - (reloadT - 0.75) / 0.2);
    const lp = fore.lerp(MAG[weapon], lt);
    L.position.copy(lp); L.rotation.set(lt * 0.6, 0, lt * 0.4);
    // 저격 노리쇠: 오른손이 잠깐 노리쇠로
    if (bolt > 0) { R.position.lerp(new THREE.Vector3(0.06, 0.0, 0.08), bolt); R.rotation.z = -bolt * 0.8; }
    const k = `${weapon}|${lt.toFixed(2)}|${bolt.toFixed(2)}`;
    if (k !== key) {
      key = k;
      const wristR = R.position.clone().add(new THREE.Vector3(0.03, -0.05, 0.07));
      const wristL = L.position.clone().add(new THREE.Vector3(-0.01, -0.07, 0.06));
      rebuildArm(armR, wristR, ELBOW_R, false);
      rebuildArm(armL, wristL, ELBOW_L, true);
    }
  };
  g.userData.update('rifle');
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// 3인칭 병사 (히트박스: 몸 0~1.4m, 머리 1.4~1.9m 에 맞춤)
// 다리는 엉덩이-무릎 두 관절, 상체는 걸을 때 위아래로 흔들림
export function makeSoldier(teamColor = 0xb8443a) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x55604a, roughness: 0.95 });
  const vest = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.8 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x1e1c19, roughness: 0.9 });
  const helmetM = new THREE.MeshStandardMaterial({ color: 0x3d4434, roughness: 0.7 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x2a2c26, roughness: 0.8 });

  const leg = side => {
    const hip = new THREE.Group(); hip.position.set(side * 0.12, 0.82, 0);
    hip.add(box(0.17, 0.44, 0.19, cloth, 0, -0.21, 0));
    const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
    knee.add(box(0.13, 0.11, 0.06, pad, 0, -0.01, -0.09)); // 무릎 보호대
    knee.add(box(0.15, 0.36, 0.16, cloth, 0, -0.18, 0));
    knee.add(box(0.16, 0.09, 0.27, boot, 0, -0.355, -0.04));
    hip.userData.knee = knee;
    return hip;
  };
  const legL = leg(-1), legR = leg(1);
  const upper = new THREE.Group(); // 걸을 때 위아래로 흔들리는 상체
  const torso = new THREE.Group(); torso.position.y = 0.78;
  torso.add(box(0.36, 0.14, 0.22, cloth, 0, 0.04, 0));               // 골반
  torso.add(box(0.44, 0.58, 0.26, cloth, 0, 0.3, 0));
  torso.add(box(0.48, 0.42, 0.32, vest, 0, 0.33, 0));                // 방탄조끼
  for (let i = -1; i <= 1; i++) torso.add(box(0.1, 0.12, 0.06, vest, i * 0.13, 0.2, -0.18)); // 탄창 파우치
  torso.add(box(0.36, 0.3, 0.14, cloth, 0, 0.36, 0.22));             // 배낭
  const head = new THREE.Group(); head.position.y = PLAYER.bodyHeight + 0.2;
  head.add(box(0.24, 0.27, 0.25, skin, 0, 0, 0));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmetM);
  helmet.position.y = 0.06; helmet.scale.set(1, 0.9, 1.08); helmet.castShadow = true; head.add(helmet);
  head.add(box(0.26, 0.07, 0.04, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.6 }), 0, 0.02, -0.13)); // 고글
  // 팔 + 총 (상하 조준 피벗)
  const aim = new THREE.Group(); aim.position.y = 1.3;
  aim.add(box(0.11, 0.11, 0.36, cloth, 0.2, -0.05, -0.12, 0.2));
  aim.add(box(0.11, 0.11, 0.42, cloth, -0.15, -0.06, -0.24, 0.15));
  aim.add(box(0.08, 0.08, 0.09, HM.glove, 0.12, -0.1, -0.3));  // 오른손
  aim.add(box(0.08, 0.08, 0.09, HM.glove, -0.02, -0.08, -0.55)); // 왼손
  const rifle = makeRifle(); rifle.scale.setScalar(0.95); rifle.position.set(0.08, -0.04, -0.4);
  const sniper = makeSniper(); sniper.scale.setScalar(0.95); sniper.position.set(0.08, -0.04, -0.35); sniper.visible = false;
  aim.add(rifle, sniper);
  upper.add(torso, head, aim);
  g.add(legL, legR, upper);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { legL, legR, head, aim, torso, upper, guns: { rifle, sniper }, walk: 0 };
  return g;
}

// 벽 너머로 보이는 실루엣용 재질 (첨단 시야 증강)
export const XRAY = new THREE.MeshBasicMaterial({ color: 0xff3048, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
export function setXray(mesh, on) {
  mesh.traverse(o => {
    if (!o.isMesh) return;
    if (on && !o.userData.orig) { o.userData.orig = o.material; o.material = XRAY; o.renderOrder = 999; }
    if (!on && o.userData.orig) { o.material = o.userData.orig; o.userData.orig = null; o.renderOrder = 0; }
  });
}
