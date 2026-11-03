// 렌더러, 하늘, 조명, 맵, 후처리, 이펙트
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { ARENA, BOXES } from './map.js';
import { SOLIDS } from './physics.js';

// ---------- 렌더러 ----------
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

// 1인칭 총은 별도 씬/카메라로 그려서 벽에 파묻히지 않게 함
export const viewScene = new THREE.Scene();
export const viewCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);

// ---------- 하늘 + 환경광 ----------
const sky = new Sky();
sky.scale.setScalar(1000);
const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(140));
sky.material.uniforms.turbidity.value = 2.2;
sky.material.uniforms.rayleigh.value = 1.1;
sky.material.uniforms.mieCoefficient.value = 0.002;
sky.material.uniforms.mieDirectionalG.value = 0.85;
sky.material.uniforms.sunPosition.value.copy(sun);
scene.add(sky);

const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene(); const sky2 = sky.clone(); skyScene.add(sky2);
const envMap = pmrem.fromScene(skyScene, 0.02).texture;
scene.environment = envMap;
viewScene.environment = envMap;
scene.environmentIntensity = 0.45;
viewScene.environmentIntensity = 0.3;
scene.fog = new THREE.FogExp2(0x9fb2c4, 0.0032);

const sunLight = new THREE.DirectionalLight(0xfff1dd, 2.6);
sunLight.position.copy(sun).multiplyScalar(60);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.03;
Object.assign(sunLight.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 150 });
scene.add(sunLight);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a3a, 0.45); scene.add(hemi);

const vSun = new THREE.DirectionalLight(0xfff1dd, 2.2); vSun.position.set(1, 2, 1); viewScene.add(vSun);
viewScene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a4036, 0.6));

// ---------- 절차적 텍스처 ----------
function canvas(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function noise(g, size, rnd, alpha, count, minR, maxR, colors) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.globalAlpha = alpha * rnd();
    const r = minR + rnd() * (maxR - minR);
    g.beginPath(); g.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}
// 밝기(높이) 캔버스로 노멀맵 생성
function normalFrom(src, strength = 2) {
  const s = src.width, g = src.getContext('2d');
  const d = g.getImageData(0, 0, s, s).data;
  const [c, o] = canvas(s);
  const out = o.createImageData(s, s);
  const hgt = (x, y) => d[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * strength, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
    out.data[i] = (-dx / len * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / len * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  o.putImageData(out, 0, 0);
  return c;
}
function tex(c, repeatX = 1, repeatY = repeatX, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function concreteSet(base, seed, tiles = 4, seams = true) {
  const S = 512, rnd = rand(seed);
  const [c, g] = canvas(S); const [h, hg] = canvas(S);
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  noise(g, S, rnd, 0.12, 5000, 0.5, 3, ['#000', '#fff', '#555']);
  noise(g, S, rnd, 0.05, 60, 20, 70, ['#000', '#3a3a3a', '#6b6255']);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  noise(hg, S, rnd, 0.25, 4000, 1, 3, ['#000', '#fff']);
  if (seams) {
    const step = S / tiles;
    for (const ctx of [g, hg]) {
      ctx.strokeStyle = ctx === g ? 'rgba(0,0,0,.3)' : '#000'; ctx.lineWidth = 2;
      for (let i = 0; i <= tiles; i++) {
        ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(S, i * step); ctx.stroke();
      }
    }
  }
  return { color: c, normal: normalFrom(h, 3) };
}

function woodSet(seed) {
  const S = 512, rnd = rand(seed);
  const [c, g] = canvas(S); const [h, hg] = canvas(S);
  const planks = 5, pw = S / planks;
  hg.fillStyle = '#888'; hg.fillRect(0, 0, S, S);
  for (let i = 0; i < planks; i++) {
    const l = 38 + rnd() * 12;
    g.fillStyle = `hsl(30, 38%, ${l}%)`; g.fillRect(0, i * pw, S, pw);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(60,35,15,${0.1 + rnd() * 0.2})`; g.lineWidth = 1 + rnd() * 2;
      const y = i * pw + rnd() * pw; g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 3);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, i * pw, S, 4);
    hg.fillStyle = '#000'; hg.fillRect(0, i * pw, S, 5);
  }
  // 테두리 프레임
  g.strokeStyle = '#3b2814'; g.lineWidth = 34; g.strokeRect(0, 0, S, S);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(S, S); g.stroke();
  hg.strokeStyle = '#fff'; hg.lineWidth = 34; hg.strokeRect(0, 0, S, S);
  hg.beginPath(); hg.moveTo(0, 0); hg.lineTo(S, S); hg.stroke();
  noise(g, S, rnd, 0.15, 1500, 1, 3, ['#000', '#fff']);
  return { color: c, normal: normalFrom(h, 4) };
}

function containerSet(hue, seed) {
  const S = 512, rnd = rand(seed);
  const [c, g] = canvas(S); const [h, hg] = canvas(S);
  g.fillStyle = `hsl(${hue}, 45%, 34%)`; g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 32) {
    const grd = g.createLinearGradient(x, 0, x + 32, 0);
    grd.addColorStop(0, 'rgba(0,0,0,.25)'); grd.addColorStop(0.5, 'rgba(255,255,255,.08)'); grd.addColorStop(1, 'rgba(0,0,0,.25)');
    g.fillStyle = grd; g.fillRect(x, 0, 32, S);
    const hgd = hg.createLinearGradient(x, 0, x + 32, 0);
    hgd.addColorStop(0, '#000'); hgd.addColorStop(0.5, '#fff'); hgd.addColorStop(1, '#000');
    hg.fillStyle = hgd; hg.fillRect(x, 0, 32, S);
  }
  noise(g, S, rnd, 0.35, 120, 2, 18, ['#5a3a20', '#3a2a1a', '#7a4a25']); // 녹
  noise(g, S, rnd, 0.12, 2000, 1, 2, ['#000', '#fff']);
  g.fillStyle = 'rgba(20,20,20,.8)'; g.fillRect(0, 0, S, 14); g.fillRect(0, S - 14, S, 14);
  return { color: c, normal: normalFrom(h, 2.5) };
}

function hazardSet() {
  const [c, g] = canvas(256);
  g.fillStyle = '#6e6e6a'; g.fillRect(0, 0, 256, 256);
  noise(g, 256, rand(9), 0.2, 800, 1, 3, ['#000', '#fff']);
  g.save(); g.beginPath(); g.rect(0, 200, 256, 56); g.clip();
  for (let x = -256; x < 512; x += 48) { g.fillStyle = '#e8b400'; g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 24, 256); g.lineTo(x + 80, 200); g.lineTo(x + 56, 200); g.fill(); }
  g.restore();
  return { color: c };
}

function mat(set, rx, ry, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(set.color, rx, ry), normalMap: set.normal ? tex(set.normal, rx, ry, false) : null,
    roughness: 0.85, metalness: 0, ...opts,
  });
}

// ---------- 맵 ----------
export const mapMeshes = [];
const S = ARENA.half * 2;
const floorSet = concreteSet('#7d7f80', 1, 8);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), mat(floorSet, S / 8, S / 8, { roughness: 0.92 }));
floor.material.normalScale.set(0.6, 0.6);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor); mapMeshes.push(floor); floor.userData.kind = 'wall';

// 바깥 지면 (아레나 밖이 허공으로 보이지 않게)
const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 1 }));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);

const wallSet = concreteSet('#8a8d90', 2, 3);
const woodS = woodSet(3), contRed = containerSet(8, 4), contBlue = containerSet(205, 5), contGreen = containerSet(120, 6), hazard = hazardSet();

function boxUV(geo, w, h, d, scale) {
  // 면마다 실제 크기에 맞게 UV를 늘려서 텍스처가 찌그러지지 않게
  const uv = geo.attributes.uv, n = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const sx = nx > 0.5 ? d : w, sy = ny > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * sx / scale, uv.getY(i) * sy / scale);
  }
}

const wallMat = mat(wallSet, 1, 1, { roughness: 0.95 });
const mats = {
  wood: mat(woodS, 1, 1, { roughness: 0.8 }),
  red: mat(contRed, 1, 1, { roughness: 0.55, metalness: 0.4 }),
  blue: mat(contBlue, 1, 1, { roughness: 0.55, metalness: 0.4 }),
  green: mat(contGreen, 1, 1, { roughness: 0.55, metalness: 0.4 }),
  pillar: new THREE.MeshStandardMaterial({ map: tex(hazard.color), roughness: 0.8 }),
  center: mat(concreteSet('#75787a', 7, 2), 1, 1, { roughness: 0.9 }),
};

// 맵 장애물 메쉬. 맵이 바뀌면 지우고 다시 만듦 (바닥은 그대로)
const boxMeshes = [];
const KIND_MAT = { wood: () => mats.wood, pillar: () => mats.pillar, center: () => mats.center };
export function buildMapMeshes() {
  for (const m of boxMeshes) { scene.remove(m); m.geometry.dispose(); const k = mapMeshes.indexOf(m); if (k >= 0) mapMeshes.splice(k, 1); }
  boxMeshes.length = 0;
  for (const d of decals.splice(0)) scene.remove(d);   // 이전 맵의 탄흔 지우기
  SOLIDS.forEach((a, i) => {
    const w = a.max[0] - a.min[0], h = a.max[1] - a.min[1], d = a.max[2] - a.min[2];
    const isWall = i >= BOXES.length;
    const b = BOXES[i];
    let m, scale = 4;
    if (isWall) { m = wallMat; scale = 6; }
    else if (b.kind === 'metal') { m = [mats.red, mats.blue, mats.green][i % 3]; scale = 3; }
    else if (KIND_MAT[b.kind]) { m = KIND_MAT[b.kind](); scale = m === mats.wood ? Math.max(1, Math.min(b.w, b.d, 2.5)) : m === mats.pillar ? 1.5 : 3; }
    else if (b.h <= 2) { m = mats.wood; scale = b.w; }
    else if (b.w <= 1.5) { m = mats.pillar; scale = 1.5; }
    else { m = [mats.red, mats.blue, mats.green][i % 3]; scale = 3; }
    const geo = new THREE.BoxGeometry(w, h, d);
    boxUV(geo, w, h, d, scale);
    const mesh = new THREE.Mesh(geo, m);
    mesh.userData.kind = m === mats.wood ? 'wood' : (m === wallMat || m === mats.center) ? 'wall' : 'metal'; // 탄착음 종류
    mesh.position.set((a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, (a.min[2] + a.max[2]) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh); mapMeshes.push(mesh); boxMeshes.push(mesh);
  });
  sunLight.shadow.needsUpdate = true;
}
// 맵마다 하늘·햇빛 분위기
const SKIES = [
  { elev: 58, az: 140, sun: 0xfff1dd, sunI: 2.6, fog: 0x9fb2c4, hemi: 0.45, turb: null },
  { elev: 80, az: 250, sun: 0xffc48a, sunI: 2.2, fog: 0xc9a98a, hemi: 0.4, turb: 4 },
  { elev: 48, az: 300, sun: 0xdfe8ff, sunI: 2.0, fog: 0x7f8b9c, hemi: 0.5, turb: 3 },
];
export function setSky(i) {
  const k = SKIES[i] || SKIES[0];
  const v = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(k.elev), THREE.MathUtils.degToRad(k.az));
  sky.material.uniforms.sunPosition.value.copy(v);
  if (k.turb !== null) sky.material.uniforms.turbidity.value = k.turb; else sky.material.uniforms.turbidity.value = 2.2;
  sunLight.position.copy(v).multiplyScalar(60); sunLight.color.set(k.sun); sunLight.intensity = k.sunI;
  scene.fog.color.set(k.fog); hemi.intensity = k.hemi;
}

// ---------- 실사 텍스처 (ambientCG, CC0) ----------
// 직접 그린 텍스처를 먼저 쓰고, 사진 텍스처가 로드되면 바꿉니다.
const texLoader = new THREE.TextureLoader();
function pbr(material, name, repeat, { color = true, normalScale = 1 } = {}) {
  const load = (kind, srgb, apply) => texLoader.load(`assets/tex/${name}_${kind}.jpg`, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    apply(t); material.needsUpdate = true;
  }, undefined, () => console.warn('텍스처 로드 실패', name, kind));
  if (color) load('Color', true, t => { material.map = t; material.color.set(0xffffff); });
  load('NormalGL', false, t => { material.normalMap = t; material.normalScale.set(normalScale, normalScale); });
  load('Roughness', false, t => { material.roughnessMap = t; material.roughness = 1; });
}
pbr(floor.material, 'Asphalt031', S / 4);              // 바닥: 아스팔트 (4m마다 반복)
pbr(wallMat, 'Concrete034', 2);                         // 외벽: 콘크리트
pbr(mats.center, 'Bricks097', 1);                       // 가운데 건물: 벽돌
for (const k of ['red', 'blue', 'green']) pbr(mats[k], 'Metal049A', 1, { color: false, normalScale: 0.6 }); // 컨테이너: 칠한 색 + 금속 질감
pbr(mats.pillar, 'Metal049A', 1, { color: false });

// 벽 위 조명 기둥 (장식)
const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.7 });
const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 3 });
for (const [x, z] of [[-29, -29], [29, -29], [-29, 29], [29, 29], [0, -29.5], [0, 29.5], [-29.5, 0], [29.5, 0]]) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 9, 8), poleMat);
  pole.position.set(x, 4.5, z); pole.castShadow = true; scene.add(pole);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.5), lampMat);
  lamp.position.set(x * 0.97, 9, z * 0.97); scene.add(lamp);
}

// ---------- 후처리 ----------
// 후처리용 화면 버퍼에도 안티에일리어싱(MSAA 4배)을 켜야 얇은 선이 끊기거나 계단처럼 안 보임
export const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const viewPass = new RenderPass(viewScene, viewCamera);
viewPass.clear = false; viewPass.clearDepth = true;
composer.addPass(viewPass);
export const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.4, 1.6);
composer.addPass(bloom);
export const vignette = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.35 }, red: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; uniform float red; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = distance(vUv, vec2(0.5));
      float v = smoothstep(0.35, 0.85, d);
      c.rgb *= 1.0 - v * amount;
      c.rgb = mix(c.rgb, vec3(0.6, 0.0, 0.0), v * red);
      gl_FragColor = c; }`,
});
composer.addPass(vignette);
composer.addPass(new OutputPass());

export function resize() {
  camera.aspect = viewCamera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); viewCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}

// ---------- 이펙트 ----------
const effects = [];
function spriteTex(draw) {
  const [c, g] = canvas(128); draw(g); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const flashTex = spriteTex(g => {
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.25, 'rgba(255,200,90,.9)'); grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  for (let i = 0; i < 6; i++) {
    g.save(); g.translate(64, 64); g.rotate(i * Math.PI / 3);
    g.beginPath(); g.moveTo(-6, 0); g.lineTo(0, -64); g.lineTo(6, 0); g.fill(); g.restore();
  }
  g.beginPath(); g.arc(64, 64, 30, 0, Math.PI * 2); g.fill();
});
const puffTex = spriteTex(g => {
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(200,200,200,.8)'); grd.addColorStop(1, 'rgba(200,200,200,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
});
const holeTex = spriteTex(g => {
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 60);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.3, 'rgba(10,10,10,.9)'); grd.addColorStop(0.55, 'rgba(40,35,30,.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
});

// ---- Kenney Particle Pack (CC0) 이미지: 총구 화염, 연기, 스파크, 그을음, 탄도선, 섬광 ----
const FX = { muzzle: [], smoke: [], spark: [], scorch: [], trace: [], flare: [] };
const FX_COUNT = { muzzle: 5, smoke: 9, spark: 7, scorch: 3, trace: 7, flare: 1 };
for (const [k, n] of Object.entries(FX_COUNT)) for (let i = 1; i <= n; i++) {
  texLoader.load(`assets/fx/${k}_0${i}.png`, t => { t.colorSpace = THREE.SRGBColorSpace; FX[k].push(t); }, undefined, () => console.warn('파티클 로드 실패', k, i));
}
const pickFx = (k, fallback) => FX[k].length ? FX[k][Math.floor(Math.random() * FX[k].length)] : fallback;
export const muzzleTex = () => pickFx('muzzle', flashTex);
export const flareTex = () => pickFx('flare', flashTex);

// 탄도선: 총알 방향으로 길게 늘인 십자 판 2장 (어느 각도에서 봐도 보이게)
export function tracer(a, b, color = 0xffd27a) {
  const len = a.distanceTo(b);
  if (len < 0.5) return;
  const g = new THREE.Group();
  const tex = pickFx('trace', null);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(tex ? 3 : 4), transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const geo = new THREE.PlaneGeometry(tex ? 0.09 : 0.025, len);
  geo.translate(0, len / 2, 0); geo.rotateX(Math.PI / 2);
  const p1 = new THREE.Mesh(geo, mat), p2 = new THREE.Mesh(geo, mat); p2.rotation.z = Math.PI / 2;
  g.add(p1, p2);
  g.position.copy(a); g.lookAt(b);
  g.material = mat; // updateEffects가 투명도를 조절
  scene.add(g);
  effects.push({ obj: g, life: 0.07, max: 0.07, dispose: true });
}
// 다른 플레이어의 총구 화염: 정면 섬광 + 쏜 방향으로 뻗는 불꽃 + 연기
const flameGeoW = new THREE.PlaneGeometry(1, 1); flameGeoW.translate(0, 0.5, 0); flameGeoW.rotateX(-Math.PI / 2);
export function muzzleFlash(p, size = 0.5, dir = null) {
  const add = map => ({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ ...add(pickFx('flare', flashTex)), color: new THREE.Color(2.2, 1.6, 1), rotation: Math.random() * Math.PI }));
  s.position.copy(p); s.scale.setScalar(size);
  scene.add(s);
  effects.push({ obj: s, life: 0.06, max: 0.06 });
  if (dir) {
    const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ ...add(muzzleTex()), color: new THREE.Color(2.2, 1.6, 1), side: THREE.DoubleSide });
    const a = new THREE.Mesh(flameGeoW, m), b = new THREE.Mesh(flameGeoW, m); b.rotation.z = Math.PI / 2;
    g.add(a, b); g.scale.set(size * 0.6, size * 0.6, size * 1.2);
    g.position.copy(p); g.lookAt(p.clone().add(dir)); g.rotateY(Math.PI);   // lookAt은 +Z를 향하게 하므로 뒤집어서 -Z(불꽃 방향)를 앞으로
    g.material = m; scene.add(g);
    effects.push({ obj: g, life: 0.06, max: 0.06 });
  }
  puff(p, 0xd0ccc4, size * 0.5, 0.45);
}

const sparkGeo = new THREE.BoxGeometry(0.02, 0.02, 0.1);
export function sparks(p, normal, color = 0xffb050, count = 8) {
  // 탄착 순간 번쩍이는 스파크 이미지
  const tex = pickFx('spark', null);
  if (tex) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, rotation: Math.random() * Math.PI }));
    s.position.copy(p).addScaledVector(normal, 0.05); s.scale.setScalar(0.25 + count * 0.03);
    scene.add(s);
    effects.push({ obj: s, life: 0.09, max: 0.09 });
  }
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, toneMapped: false }));
    m.position.copy(p);
    const v = normal.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
    m.lookAt(p.clone().add(v));
    scene.add(m);
    effects.push({ obj: m, life: 0.25 + Math.random() * 0.2, max: 0.45, vel: v, gravity: 9 });
  }
}
export function puff(p, color = 0xcfcac0, size = 0.5, life = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pickFx('smoke', puffTex), color, transparent: true, depthWrite: false, rotation: Math.random() * Math.PI * 2 }));
  s.position.copy(p); s.scale.setScalar(size);
  scene.add(s);
  effects.push({ obj: s, life, max: life, grow: size * 1.8, vel: new THREE.Vector3(0, 0.4, 0) });
}
export function blood(p) {
  // 맞은 순간 붉은 섬광 + 튀는 핏방울 + 핏빛 안개
  const tex = pickFx('spark', null);
  if (tex) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.6, 0.1, 0.05), transparent: true, depthWrite: false, toneMapped: false, rotation: Math.random() * Math.PI }));
    s.position.copy(p); s.scale.setScalar(0.55);
    scene.add(s); effects.push({ obj: s, life: 0.08, max: 0.08 });
  }
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0x9a0000, transparent: true }));
    m.position.copy(p); m.scale.setScalar(1 + Math.random());
    const v = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4);
    scene.add(m);
    effects.push({ obj: m, life: 0.35 + Math.random() * 0.25, max: 0.6, vel: v, gravity: 9 });
  }
  puff(p, 0x8a0000, 0.55, 0.45);
}

const decals = [];
const holeGeo = new THREE.PlaneGeometry(0.14, 0.14);
const holeMat = new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
// 탄흔: 가운데 구멍 + 그 주변 그을음(Kenney scorch)
const scorchGeo = new THREE.PlaneGeometry(0.3, 0.3);
const scorchMats = [];
export function bulletHole(p, normal) {
  if (FX.scorch.length && scorchMats.length < FX.scorch.length) for (const t of FX.scorch.slice(scorchMats.length)) scorchMats.push(new THREE.MeshStandardMaterial({ map: t, color: 0x1a1612, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 1 }));
  if (scorchMats.length) {
    const sc = new THREE.Mesh(scorchGeo, scorchMats[Math.floor(Math.random() * scorchMats.length)]);
    sc.position.copy(p).addScaledVector(normal, 0.004); sc.lookAt(p.clone().add(normal)); sc.rotateZ(Math.random() * Math.PI * 2);
    sc.scale.setScalar(0.6 + Math.random() * 0.5);
    scene.add(sc); decals.push(sc);
  }
  const m = new THREE.Mesh(holeGeo, holeMat);
  m.position.copy(p).addScaledVector(normal, 0.005);
  m.lookAt(p.clone().add(normal));
  m.rotateZ(Math.random() * Math.PI);
  scene.add(m); decals.push(m);
  while (decals.length > 120) scene.remove(decals.shift());
}

// 탄착 지점의 면 방향 찾기 (맵 메쉬에 레이캐스트)
const ray = new THREE.Raycaster();
export function surfaceAt(from, to) {
  const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
  ray.set(from, dir); ray.far = dist + 0.3;
  const hit = ray.intersectObjects(mapMeshes, false)[0];
  if (!hit) return null;
  return { point: hit.point, normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld), kind: hit.object.userData.kind || 'wall' };
}

export function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.vel) {
      if (e.gravity) e.vel.y -= e.gravity * dt;
      e.obj.position.addScaledVector(e.vel, dt);
    }
    if (e.grow) e.obj.scale.setScalar(e.obj.scale.x + e.grow * dt);
    e.obj.material.opacity = Math.max(0, e.life / e.max);
    if (e.life <= 0) {
      scene.remove(e.obj);
      if (e.dispose) { if (e.obj.geometry) e.obj.geometry.dispose(); else e.obj.children[0]?.geometry.dispose(); }
      e.obj.material.dispose();
      effects.splice(i, 1);
    }
  }
}

// 나무 상자 부서짐: 메쉬를 치우고 나뭇조각을 흩뿌림
const chunkGeo = new THREE.BoxGeometry(0.22, 0.06, 0.12);
export function hideBox(i) {
  const m = boxMeshes[i]; if (!m || !m.parent) return null;
  scene.remove(m);
  const k = mapMeshes.indexOf(m); if (k >= 0) mapMeshes.splice(k, 1);
  const c = m.position.clone(), size = m.geometry.parameters;
  for (let n = 0; n < 16; n++) {
    const ch = new THREE.Mesh(chunkGeo, new THREE.MeshStandardMaterial({ color: n % 3 ? 0x8a5a2b : 0x6b4420, roughness: 0.9, transparent: true }));
    ch.position.set(c.x + (Math.random() - 0.5) * size.width, c.y + (Math.random() - 0.3) * size.height, c.z + (Math.random() - 0.5) * size.depth);
    ch.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    ch.scale.setScalar(0.7 + Math.random() * 1.2);
    scene.add(ch);
    effects.push({ obj: ch, life: 1.1 + Math.random() * 0.5, max: 1.6, vel: new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6), gravity: 14 });
  }
  puff(c, 0xa08a6a, 1.6, 0.9);
  sparks(c, new THREE.Vector3(0, 1, 0), 0xc08040, 10);
  return c;
}
// 수류탄 폭발 / 섬광탄 터짐
export function explosion(p, kind) {
  if (kind === 'frag') {
    // 불덩이: 커지면서 0.5초 동안 사라짐
    for (let n = 0; n < 5; n++) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: pickFx('flare', flashTex), color: new THREE.Color(2.4, 1.3 + Math.random() * 0.4, 0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, rotation: Math.random() * 6 }));
      f.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 1.0, (Math.random() - 0.5) * 1.2));
      f.scale.setScalar(2 + Math.random() * 1.5);
      scene.add(f);
      effects.push({ obj: f, life: 0.35 + Math.random() * 0.25, max: 0.6, grow: 5, dispose: false });
    }
    muzzleFlash(p.clone().add(new THREE.Vector3(0, 0.4, 0)), 4.5);
    sparks(p, new THREE.Vector3(0, 1, 0), 0xffa040, 40);
    for (let n = 0; n < 6; n++) puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.3 + Math.random() * 1.2, (Math.random() - 0.5) * 2)), 0x55504a, 2.2 + Math.random(), 1.6);
    bulletHole(new THREE.Vector3(p.x, 0.01, p.z), new THREE.Vector3(0, 1, 0));
  } else {
    muzzleFlash(p.clone().add(new THREE.Vector3(0, 0.3, 0)), 6);
    sparks(p, new THREE.Vector3(0, 1, 0), 0xffffff, 24);
    puff(p.clone().add(new THREE.Vector3(0, 0.4, 0)), 0xd8d8d8, 1.8, 1.4);
  }
}

// 처음 맵 메쉬 (탄흔 목록이 위에서 만들어진 뒤에 호출)
buildMapMeshes();
