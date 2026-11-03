// 총기 모델 + 대체용 상자 병사 (1인칭 팔은 사용자 결정으로 뺌, 2026-11-02)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PLAYER } from './map.js';
import { GUNS, DEFAULT_LOADOUT } from './guns.js';

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

// ---------- 총 (CC0 Flat Guns West/East, Pichuliru / OpenGameArt) ----------
// 총 그룹 좌표: 앞 = -Z, 위 = +Y. 기준점 = 총 윗면(레일) 높이, 방아쇠 앞뒤 위치.
// 모델 파일이 오기 전에는 상자 모양을 잠깐 보여 주고, 로드되면 모델로 바꿉니다.
const VIEW_SCALE = 1.714;   // 1인칭 화면용 크기 (기존 돌격소총과 같은 비율)
const MAX_LEN = 1.6;        // 너무 긴 총은 화면을 가리지 않게 줄임
const TRIGGER_Z = 0.06;
// 조준선 높이(총 윗면 기준): 도트사이트, 스코프, 가늠쇠
const SIGHT = { dot: 0.036, scope: 0.055, none: 0.018 };
// 모델이 오기 전 상자 길이 (모델 실제 길이 × VIEW_SCALE과 비슷하게)
const ROUGH_LEN = { ar: 1.2, br: 1.35, dmr: 1.3, smg: 0.9, pistol: 0.36, sg: 1.3, sniper: 1.6 };

function makeDot() {
  const sight = new THREE.Group();
  sight.add(box(0.05, 0.012, 0.09, M.darkMetal, 0, 0, 0));
  sight.add(box(0.008, 0.055, 0.07, M.darkMetal, -0.024, 0.03, 0));
  sight.add(box(0.008, 0.055, 0.07, M.darkMetal, 0.024, 0.03, 0));
  sight.add(box(0.05, 0.008, 0.07, M.darkMetal, 0, 0.058, 0));
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.045), new THREE.MeshStandardMaterial({ color: 0x88aacc, transparent: true, opacity: 0.18, roughness: 0, metalness: 1 }));
  lens.position.set(0, 0.03, 0); sight.add(lens);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 8), M.redDot); dot.position.set(0, 0.03, -0.01); sight.add(dot);
  sight.position.set(0, 0.006, -0.02);
  return sight;
}
function makeScope() {
  const scope = new THREE.Group();
  scope.add(cyl(0.022, 0.32, M.darkMetal, 0, 0, 0, 20));
  scope.add(cyl(0.032, 0.08, M.darkMetal, 0, 0, -0.17, 20));
  scope.add(cyl(0.028, 0.06, M.darkMetal, 0, 0, 0.16, 20));
  const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), M.glass); lensF.position.z = -0.211; lensF.rotation.y = Math.PI; scope.add(lensF);
  scope.add(cyl(0.012, 0.04, M.darkMetal, 0, 0.03, 0));
  scope.add(box(0.02, 0.04, 0.03, M.darkMetal, 0, -0.035, -0.08));
  scope.add(box(0.02, 0.04, 0.03, M.darkMetal, 0, -0.035, 0.08));
  scope.position.set(0, 0.055, -0.02);
  return scope;
}

export function makeGun(id) {
  const G = GUNS[id] || GUNS[DEFAULT_LOADOUT[0]];
  const g = new THREE.Group();
  const L = ROUGH_LEN[G.cls] || 1.2;
  // 임시 상자 모양
  const tmp = new THREE.Group();
  tmp.add(box(0.06, 0.08, L * 0.75, M.metal, 0, -0.045, TRIGGER_Z - L * 0.25));
  tmp.add(box(0.045, 0.12, 0.06, M.polymer, 0, -0.12, TRIGGER_Z + 0.06, -0.3));
  g.add(tmp);
  const mag = new THREE.Group(); mag.add(box(0.04, 0.14, 0.07, M.tan, 0, -0.07, 0)); mag.position.set(0, -0.08, TRIGGER_Z - 0.1); g.add(mag);
  let optic = null;
  if (G.optic === 'dot') optic = makeDot();
  if (G.optic === 'scope') optic = makeScope();
  if (optic) g.add(optic);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.03, TRIGGER_Z - L * 0.62); g.add(muzzle);
  g.userData = { id: G.id, cls: G.cls, mag, muzzle, optic, tmp, sightHeight: SIGHT[G.optic], len: L };
  const magY = mag.position.y;
  g.userData.magDrop = amt => { mag.position.y = magY - amt; };
  g.userData.boltPull = () => {};
  g.userData.slideKick = () => {};
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  loadGunModel(G.file).then(scene => upgradeGun(g, scene)).catch(e => console.warn('총 모델 로드 실패', G.file, e));
  return g;
}

const gunCache = {};
export function loadGunModel(file) {
  if (!gunCache[file]) gunCache[file] = new GLTFLoader().loadAsync(`assets/guns/${file}.glb`).then(gl => gl.scene);
  return gunCache[file];
}
// 미리 받아 두기 (총 선택 카드가 뜨기 전 등)
export function preloadGuns(ids) { for (const id of ids) if (GUNS[id]) loadGunModel(GUNS[id].file).catch(() => {}); }

// GLTFLoader가 이름의 '.'과 공백을 바꾸므로 정리한 이름으로 비교
const clean = n => n.replace(/[\s.:\/\[\]_]/g, '').toLowerCase();
function findBone(root, name) { const k = clean(name); let b = null; root.traverse(o => { if (!b && clean(o.name) === k) b = o; }); return b; }

// 모델의 z0~z1 구간(가운데 근처) 정점 중 가장 높은 y (총 그룹 좌표). skip: 무시할 뼈 이름
function topNear(model, g, z0, z1, skip) {
  let top = -Infinity; const v = new THREE.Vector3(), inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  model.updateMatrixWorld(true);
  model.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.attributes.skinIndex, wt = o.geometry.attributes.skinWeight;
    const skipIdx = o.isSkinnedMesh ? o.skeleton.bones.map((b, i) => skip.includes(b.name.toLowerCase().replace(/_/g, ' ')) ? i : -1).filter(i => i >= 0) : [];
    for (let i = 0; i < pos.count; i++) {
      if (skipIdx.length && idx) { let w = 0; for (let k = 0; k < 4; k++) if (skipIdx.includes(idx.getComponent(i, k))) w += wt.getComponent(i, k); if (w > 0.5) continue; }
      v.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      if (v.z > z0 && v.z < z1 && Math.abs(v.x) < 0.03 && v.y > top) top = v.y;
    }
  });
  return top;
}

function upgradeGun(g, src) {
  const ud = g.userData;
  if (ud.upgraded) return;
  const model = SkeletonUtils.clone(src);
  const holder = new THREE.Group(); holder.add(model); g.add(holder);
  const wp = o => o.getWorldPosition(new THREE.Vector3());
  const bone = n => findBone(model, n);
  model.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(model);
  const trig = bone('Trigger'), muzB = bone('Attach_Muzzle'), scopeB = bone('Attach_Scope');
  const railB = bone('Attach_Rail.Bottom'), pumpB = bone('Pump');
  // 총구가 -Z(게임의 앞)로 오게: 총구(없으면 펌프/아래 레일)가 방아쇠보다 앞
  const front = muzB || pumpB || railB;
  const tz = trig ? wp(trig).z : (bb.min.z + bb.max.z) / 2;
  const fz = front ? wp(front).z : bb.min.z;
  if (fz > tz) model.rotation.y = Math.PI;
  const lenZ = bb.max.z - bb.min.z;
  const s = Math.min(VIEW_SCALE, MAX_LEN / lenZ);
  holder.scale.setScalar(s);
  g.updateMatrixWorld(true);
  const toG = v => g.worldToLocal(v);
  // 기준 맞추기: 방아쇠 → z=TRIGGER_Z, 총 윗면(조준경 받침) → y=0, 가운데 → x=0
  const box2 = new THREE.Box3().setFromObject(model); const bMin = toG(box2.min.clone()), bMax = toG(box2.max.clone());
  const trigG = trig ? toG(wp(trig)) : new THREE.Vector3(0, 0, (bMin.z + bMax.z) / 2);
  const topY = scopeB ? toG(wp(scopeB)).y : Math.max(bMin.y, bMax.y) - 0.01;
  holder.position.set(-trigG.x, -topY, TRIGGER_Z - trigG.z);
  g.updateMatrixWorld(true);
  // 총구 위치
  if (muzB) ud.muzzle.position.copy(toG(wp(muzB)));
  else { const bb3 = new THREE.Box3().setFromObject(model); const a = toG(bb3.min.clone()), b = toG(bb3.max.clone()); ud.muzzle.position.set(0, -0.03, Math.min(a.z, b.z)); }
  ud.len = Math.abs(ud.muzzle.position.z - TRIGGER_Z) * 1.4;
  // 상자 부품 숨기기 (조준경, 총구 기준점은 유지)
  ud.tmp.visible = false; ud.mag.visible = false;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  // 손 위치 (상대 사람 모델의 팔 IK용)
  const trigP = toG(wp(trig || model));
  const pistol = ud.cls === 'pistol';
  ud.grip = trigP.clone().add(pistol ? new THREE.Vector3(0, -0.075, 0.07) : new THREE.Vector3(0, -0.08, 0.11));
  if (pistol) ud.fore = ud.grip.clone().add(new THREE.Vector3(-0.035, -0.01, -0.02));     // 왼손은 오른손을 감쌈
  else if (pumpB) ud.fore = toG(wp(pumpB)).add(new THREE.Vector3(0, -0.02, 0));
  else if (railB) ud.fore = toG(wp(railB)).add(new THREE.Vector3(0, -0.02, 0));
  else ud.fore = trigP.clone().lerp(ud.muzzle.position, 0.45).add(new THREE.Vector3(0, -0.05, 0));
  // 탄창/노리쇠/펌프/슬라이드 뼈를 움직여 재장전/장전 동작
  const dirIn = (b, v) => {
    const a = b.parent.worldToLocal(g.localToWorld(new THREE.Vector3()));
    const c = b.parent.worldToLocal(g.localToWorld(v.clone()));
    return c.sub(a);
  };
  const slide = (b, v, amt) => { const rest = b.position.clone(), d = dirIn(b, v); return e => b.position.copy(rest).addScaledVector(d, amt * e); };
  const magB = bone('Magazine');
  if (magB) { const f = slide(magB, new THREE.Vector3(0, -1, 0), 1); ud.magDrop = amt => f(amt); }
  const boltB = bone('Bolt');
  const back = new THREE.Vector3(0, 0, 1);
  const pump = pumpB ? slide(pumpB, back, 0.12) : null, bolt = boltB ? slide(boltB, back, 0.09) : null;
  ud.boltPull = e => { pump?.(e); bolt?.(e); };
  const slideB = bone('Slide');
  if (slideB) ud.slideKick = slide(slideB, back, 0.05);
  // 조준경 받침이 총 몸통보다 낮게 묻히는 모델이 있어서, 조준경 자리의 실제 윗면을 재서 그 위로 올림
  if (ud.optic) {
    const hs = ud.cls === 'sniper' ? 0.18 : 0.06, oz = ud.optic.position.z;
    // 조준경 자리부터 눈 쪽(뒤)까지: 뒤쪽이 더 높으면 조준선을 가리므로
    const top = topNear(model, g, oz - hs, 9, ['rear sights', 'front sights']);
    if (top > 0.002) { ud.optic.position.y += top; ud.sightHeight += top; }
  }
  else ud.sightHeight = topNear(model, g, -9, 9, []) + 0.004;   // 가늠자: 총에서 가장 높은 곳이 조준선
  ud.stock = bone('Stock');
  // 도트사이트/스코프를 단 총은 원래 가늠자·가늠쇠를 접음 (뼈 크기를 0으로: 그 뼈에 붙은 부분만 사라짐)
  if (ud.optic) for (const n of ['Rear Sights', 'Front Sights']) { const sb = bone(n); if (sb) sb.scale.setScalar(1e-4); }
  ud.upgraded = true;
}

const HM = { glove: new THREE.MeshStandardMaterial({ color: 0x8a7656, roughness: 0.85 }) };

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
  // 총은 필요할 때 만듦 (getGun)
  const guns = {};
  const getGun = id => {
    if (!guns[id]) { const gg = makeGun(id); gg.scale.setScalar(0.72); gg.position.set(0.08, 0.0, -0.3); gg.visible = false; aim.add(gg); guns[id] = gg; }
    return guns[id];
  };
  upper.add(torso, head, aim);
  g.add(legL, legR, upper);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { legL, legR, head, aim, torso, upper, guns, getGun, walk: 0 };
  g.userData.setWeapon = id => { for (const k in guns) guns[k].visible = false; getGun(id).visible = true; };
  g.userData.setWeapon(DEFAULT_LOADOUT[0]);
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
