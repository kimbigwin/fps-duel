// 총기 / 캐릭터 모델 (기본 도형 조합, 직접 디자인)
import * as THREE from 'three';
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
  g.userData = { mag, muzzle, sightHeight: 0.098 };
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
  g.userData = { mag, muzzle, bolt, sightHeight: 0.085 };
  return g;
}

// 1인칭 팔 (장갑 + 소매)
export function makeArms() {
  const g = new THREE.Group();
  const right = new THREE.Group();
  right.add(box(0.07, 0.07, 0.3, M.sleeve, 0, 0, 0.15));
  right.add(box(0.065, 0.06, 0.1, M.glove, 0, 0, -0.03));
  right.position.set(0.02, -0.1, 0.16); right.rotation.set(0.35, 0.12, 0);
  const left = new THREE.Group();
  left.add(box(0.07, 0.07, 0.42, M.sleeve, 0, 0, 0.21));
  left.add(box(0.07, 0.06, 0.11, M.glove, 0, 0, -0.04));
  left.position.set(-0.05, -0.07, -0.3); left.rotation.set(0.25, -0.35, 0.2);
  g.add(right, left);
  g.userData = { left, right };
  return g;
}

// 3인칭 병사 (히트박스: 몸 0~1.4m, 머리 1.4~1.9m 에 맞춤)
export function makeSoldier(teamColor = 0xb8443a) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x55604a, roughness: 0.95 });
  const vest = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.8 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x1e1c19, roughness: 0.9 });
  const helmetM = new THREE.MeshStandardMaterial({ color: 0x3d4434, roughness: 0.7 });

  const leg = side => {
    const p = new THREE.Group(); p.position.set(side * 0.13, 0.78, 0);
    p.add(box(0.17, 0.42, 0.19, cloth, 0, -0.2, 0));
    p.add(box(0.15, 0.36, 0.16, cloth, 0, -0.56, 0));
    p.add(box(0.16, 0.1, 0.26, boot, 0, -0.73, -0.04));
    return p;
  };
  const legL = leg(-1), legR = leg(1);
  const torso = new THREE.Group(); torso.position.y = 0.78;
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
  const rifle = makeRifle(); rifle.scale.setScalar(0.95); rifle.position.set(0.08, -0.04, -0.4);
  const sniper = makeSniper(); sniper.scale.setScalar(0.95); sniper.position.set(0.08, -0.04, -0.35); sniper.visible = false;
  aim.add(rifle, sniper);
  g.add(legL, legR, torso, head, aim);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { legL, legR, head, aim, torso, guns: { rifle, sniper }, walk: 0 };
  return g;
}
