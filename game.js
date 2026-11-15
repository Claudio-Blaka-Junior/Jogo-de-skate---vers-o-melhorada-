// =====================================================================
//  Skate 3D estilo Tony Hawk — Three.js 0.160.0 (importmap no index.html)
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ---------- Configurações (ajuste aqui) ----------
const CFG = {
  modelo: 'models/skatista.glb',
  imagem: 'images/simbolo.png',          // símbolo SK8 (cartazes, chão e fundo do skate)
  sons: { pulo: 'sounds/pulo.mp3', aterrissar: 'sounds/aterrissar.mp3', musica: 'sounds/musica.mp3' },
  alturaPersonagem: 1.8, rotacaoModelo: 0,
  vMax: 14, acel: 10, freio: 14, giroRumo: 2.4,   // movimento no chão
  gravidade: 20, impulsoPulo: 8, tempoAgachar: 0.2,
  giroAr: 7,             // rad/s de giro no ar (A/D)
  tempoManobra: 0.55,    // duração de cada manobra de skate (J/K/L)
  tempoCombo: 1.8,       // tempo no chão até o combo ser "fechado" e somado
  grindIntervalo: 0.1, grindPontos: 10,
  grindMultiplica: false, // true = multiplica por 10 a cada 0,1 s (cresce MUITO rápido)
  limite: 40,
};
const MANOBRAS = {
  KeyJ: { nome: 'Kickflip', pts: 150, eixo: 'z', sinal: 1 },
  KeyK: { nome: 'Heelflip', pts: 150, eixo: 'z', sinal: -1 },
  KeyL: { nome: 'Pop Shove-it', pts: 100, eixo: 'y', sinal: 1 },
};

// ---------- Áudio (arquivo ausente = silêncio) ----------
function criarSom(url, { loop = false, volume = 1 } = {}) {
  const a = new Audio(); a.loop = loop; a.volume = volume; let ok = true;
  a.addEventListener('error', () => { ok = false; console.warn(`[som] "${url}" indisponível: silêncio.`); });
  a.src = url;
  return {
    tocar() { if (!ok) return; try { a.currentTime = 0; a.play()?.catch(() => {}); } catch (_) {} },
    liberar() { // destrava o som no clique inicial
      if (!ok) return;
      try { a.muted = true; a.play()?.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; }); } catch (_) { a.muted = false; }
    },
  };
}
const somPulo = criarSom(CFG.sons.pulo, { volume: 0.8 });
const somAterrissar = criarSom(CFG.sons.aterrissar, { volume: 0.9 });
const somMusica = criarSom(CFG.sons.musica, { loop: true, volume: 0.4 });

// ---------- Cena, luz e câmera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7ee);
scene.fog = new THREE.Fog(0x8fc7ee, 50, 150);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 300);
scene.add(new THREE.HemisphereLight(0xffffff, 0x55606e, 0.95));
const sol = new THREE.DirectionalLight(0xffffff, 1.4);
sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 70 });
scene.add(sol, sol.target);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// ---------- Texturas ----------
function texCanvas(w, h, desenhar) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  desenhar(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// Símbolo SK8: começa com um desenho reserva e troca pela imagem real quando ela carregar
const matsSimbolo = [];
const texReserva = texCanvas(128, 128, (g, w, h) => {
  g.fillStyle = '#ff3d7f'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.fillText('SK8', w / 2, h / 2 + 20);
});
function matSimbolo(basico = true) {
  const m = basico ? new THREE.MeshBasicMaterial({ map: texReserva, transparent: true, side: THREE.DoubleSide })
                   : new THREE.MeshStandardMaterial({ map: texReserva });
  matsSimbolo.push(m); return m;
}
new THREE.TextureLoader().load(CFG.imagem, (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  matsSimbolo.forEach((m) => { m.map = t; m.needsUpdate = true; });
}, undefined, () => console.warn(`[imagem] "${CFG.imagem}" não encontrada: usando o símbolo reserva.`));

// ---------- Cenário: chão, prédios e cartazes ----------
const texChao = texCanvas(256, 256, (g, w, h) => {
  g.fillStyle = '#6f737b'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) { g.fillStyle = Math.random() < 0.5 ? '#7b8089' : '#62666d'; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  g.strokeStyle = '#4b4f56'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
});
texChao.repeat.set(30, 30);
const chao = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: texChao }));
chao.rotation.x = -Math.PI / 2; chao.receiveShadow = true; scene.add(chao);

const texJanela = texCanvas(64, 64, (g, w, h) => {
  g.fillStyle = '#2b2f3a'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = Math.random() < 0.4 ? '#ffd98a' : '#46506a'; g.fillRect(6 + x * 30, 6 + y * 30, 22, 22); }
});
let semente = 7; const rnd = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
for (let i = -5; i <= 5; i++) {
  for (const [ex, ez, ax, az] of [[1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0]]) {
    const w = 10 + rnd() * 3, h = 14 + rnd() * 24, t = texJanela.clone(); t.needsUpdate = true; t.repeat.set(w / 6, h / 6);
    const p = new THREE.Mesh(new THREE.BoxGeometry(ax ? w : 12, h, az ? w : 12),
      new THREE.MeshStandardMaterial({ map: t, color: new THREE.Color().setHSL(rnd(), 0.35, 0.65) }));
    p.position.set(ex * 58 + ax * i * 11, h / 2, ez * 58 + az * i * 11); scene.add(p);
  }
}
// Símbolo SK8 em vários pontos: cartazes nas paredes, painéis no meio da praça e adesivos no chão
function cartaz(x, y, z, tam, rotY, rotX = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(tam, tam), matSimbolo());
  m.position.set(x, y, z); m.rotation.set(rotX, rotY, 0); scene.add(m);
}
[[-22, -51.8, 0], [22, -51.8, 0], [-14, 51.8, Math.PI], [26, 51.8, Math.PI], [51.8, -10, -Math.PI / 2], [51.8, 24, -Math.PI / 2], [-51.8, 6, Math.PI / 2], [-51.8, -30, Math.PI / 2]]
  .forEach(([x, z, r]) => cartaz(x, 6, z, 7, r));
[[-34, 0, Math.PI / 2], [34, -26, -Math.PI / 2]].forEach(([x, z, r]) => { // painéis com poste
  const poste = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), new THREE.MeshStandardMaterial({ color: 0x333a44 }));
  poste.position.set(x, 1.5, z); scene.add(poste); cartaz(x, 4.6, z, 4.5, r); cartaz(x + Math.sign(Math.cos(r)) * 0.05, 4.6, z, 4.5, r + Math.PI);
});
cartaz(0, 0.03, 14, 5, 0, -Math.PI / 2); cartaz(-30, 0.03, -30, 6, 0.6, -Math.PI / 2);

// ---------- Rampas (cunhas) e corrimãos ----------
// Cada rampa sobe na direção +z local; "rot" gira a rampa no eixo Y.
const RAMPAS = [
  { x: 0, z: -20, w: 6, l: 5, h: 2.2, rot: Math.PI },
  { x: -18, z: -6, w: 5, l: 4.5, h: 1.8, rot: -Math.PI / 2 },
  { x: 18, z: -6, w: 5, l: 4.5, h: 1.8, rot: Math.PI / 2 },
  { x: 0, z: 24, w: 6, l: 5, h: 2.2, rot: 0 },
  { x: -24, z: 18, w: 4, l: 4, h: 1.5, rot: Math.PI / 4 },
];
const matRampa = new THREE.MeshStandardMaterial({ color: 0xb7bcc6, side: THREE.DoubleSide });
RAMPAS.forEach((r) => {
  const forma = new THREE.Shape(); forma.moveTo(-r.l / 2, 0); forma.lineTo(r.l / 2, 0); forma.lineTo(r.l / 2, r.h);
  const geo = new THREE.ExtrudeGeometry(forma, { depth: r.w, bevelEnabled: false });
  geo.translate(0, 0, -r.w / 2); geo.rotateY(-Math.PI / 2); // comprimento passa para o eixo z local
  const m = new THREE.Mesh(geo, matRampa); m.position.set(r.x, 0, r.z); m.rotation.y = r.rot;
  m.castShadow = m.receiveShadow = true; scene.add(m);
});
// Altura do terreno em (x,z): chão = 0, rampas sobem linearmente
function alturaEm(x, z) {
  let h = 0;
  for (const r of RAMPAS) {
    const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot), s = Math.sin(r.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) <= r.w / 2 && Math.abs(lz) <= r.l / 2) h = Math.max(h, r.h * (lz + r.l / 2) / r.l);
  }
  return h;
}
const CORRIMAOS = [];
const matMetal = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.7, roughness: 0.3 });
function criarCorrimao(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), r = { ax, az, dx: dx / len, dz: dz / len, len, y: 0.9 };
  CORRIMAOS.push(r);
  const barra = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8).rotateX(Math.PI / 2), matMetal);
  barra.position.set((ax + bx) / 2, r.y, (az + bz) / 2); barra.rotation.y = Math.atan2(dx, dz); barra.castShadow = true; scene.add(barra);
  for (let t = 0; t <= len; t += 3) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, r.y, 0.08), matMetal); p.position.set(ax + r.dx * t, r.y / 2, az + r.dz * t); scene.add(p);
  }
}
criarCorrimao(-9, -2, -9, -16); criarCorrimao(9, -2, 9, -16); criarCorrimao(-12, 8, 12, 8); criarCorrimao(22, 10, 22, 30);

// ---------- Jogador: corpo > (skate + personagem) ----------
const jogador = new THREE.Group(), corpo = new THREE.Group(), visual = new THREE.Group(), skate = new THREE.Group();
function montarSkate() {
  const lado = new THREE.MeshStandardMaterial({ color: 0xff3d7f }), cima = new THREE.MeshStandardMaterial({ color: 0x222831 });
  const tabua = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.9), [lado, lado, cima, matSimbolo(false), lado, lado]);
  tabua.position.y = 0.03; tabua.castShadow = true; skate.add(tabua);
  for (const [x, z] of [[-0.15, -0.3], [0.15, -0.3], [-0.15, 0.3], [0.15, 0.3]]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffd166 }));
    r.position.set(x, -0.04, z); skate.add(r);
  }
}
montarSkate(); skate.position.y = 0.1; visual.position.y = 0.16;
corpo.add(skate, visual); jogador.add(corpo); scene.add(jogador);
const pos = jogador.position; pos.set(0, 0, 8);

// Modelo GLB (sem animações = efeito de escala; com animações = AnimationMixer + crossfade)
let mixer = null, atual = null, animacaoProcedural = false; const acoes = {};
const NOMES = { parado: ['parado', 'idle'], agachar: ['agachar', 'crouch'], pulo: ['pulo', 'jump'], aterrissar: ['aterrissar', 'land'] };
function tocarAnim(papel) {
  const a = acoes[papel]; if (!a || a === atual) return;
  a.reset(); a.setLoop(papel === 'parado' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true; a.play();
  atual ? atual.crossFadeTo(a, 0.2, false) : a.fadeIn(0.2); atual = a;
}
const avisoEl = document.getElementById('aviso');
function usarCubo() {
  animacaoProcedural = true;
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), new THREE.MeshStandardMaterial({ color: 0xff3d7f }));
  c.position.y = 0.8; c.castShadow = true; visual.add(c);
}
(async () => {
  try {
    const loader = new GLTFLoader(), draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
    loader.setDRACOLoader(draco); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(CFG.modelo), modelo = gltf.scene;
    console.log('Animações no GLB:', gltf.animations.map((c) => c.name));
    modelo.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    modelo.rotation.y = CFG.rotacaoModelo; modelo.updateMatrixWorld(true);
    const caixa = new THREE.Box3().setFromObject(modelo, true);
    modelo.scale.setScalar(CFG.alturaPersonagem / (caixa.getSize(new THREE.Vector3()).y || 1)); modelo.updateMatrixWorld(true);
    const c2 = new THREE.Box3().setFromObject(modelo, true), ct = c2.getCenter(new THREE.Vector3());
    modelo.position.set(-ct.x, -c2.min.y, -ct.z); visual.add(modelo);
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(modelo); const usados = new Set();
      for (const p of ['aterrissar', 'agachar', 'pulo', 'parado']) {
        const c = gltf.animations.find((c) => !usados.has(c) && NOMES[p].some((n) => c.name.toLowerCase().includes(n)));
        if (c) { usados.add(c); acoes[p] = mixer.clipAction(c); }
      }
      tocarAnim('parado');
    } else animacaoProcedural = true;
  } catch (e) {
    console.warn(`[modelo] falha ao carregar "${CFG.modelo}": usando cubo.`, e);
    avisoEl.textContent = `Falha ao carregar o modelo (usando cubo): ${e.message || e}`.slice(0, 200); usarCubo();
  }
})();

// ---------- Entrada e HUD ----------
const tecla = new Set(); let jogando = false, pedPulo = false, pedManobra = null;
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat) { if (e.code === 'Space') pedPulo = true; if (MANOBRAS[e.code]) pedManobra = e.code; }
  tecla.add(e.code);
});
addEventListener('keyup', (e) => tecla.delete(e.code));
addEventListener('blur', () => tecla.clear());
const k = (...c) => c.some((x) => tecla.has(x));
const telaInicio = document.getElementById('inicio');
const comecar = () => { if (jogando) return; jogando = true; telaInicio.style.display = 'none'; somPulo.liberar(); somAterrissar.liberar(); somMusica.tocar(); };
telaInicio.addEventListener('click', comecar);
telaInicio.addEventListener('keydown', (e) => { if (e.code === 'Enter') comecar(); });

const elTotal = document.getElementById('total'), elCombo = document.getElementById('combo'), elMsg = document.getElementById('msg');
let msgT = 0;
function msg(t, ms = 1300) { elMsg.textContent = t; clearTimeout(msgT); msgT = setTimeout(() => { elMsg.textContent = ''; }, ms); }

// ---------- Estado do jogo ----------
let estado = 'chao';           // chao | agachando | ar | grind | queda
let tEst = 0, tAterr = 0, rumo = Math.PI, vel = 0, vy = 0, vyChao = 0;
const vh = new THREE.Vector2(); // velocidade horizontal no ar (x, z)
let trick = null, voltas = 0, giroAcum = 0, comboT = 0, gT = 0, gCD = 0;
let rail = null, railT = 0, railSinal = 1, railVel = 0;
let total = 0, pontosCombo = 0, mult = 1;
const PAPEL = { chao: 'parado', agachando: 'agachar', ar: 'pulo', grind: 'parado', queda: 'aterrissar' };
function setEstado(e) { estado = e; if (mixer) tocarAnim(PAPEL[e]); }
const limitar = (v) => THREE.MathUtils.clamp(v, -CFG.limite, CFG.limite);
function girarAte(a, alvo, f) { const d = ((alvo - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * Math.min(1, f); }

function terminarManobra() { // soma os pontos e volta a tábua para a posição normal
  if (!trick) return;
  pontosCombo += trick.def.pts; msg(`${trick.def.nome}! +${trick.def.pts}`); skate.rotation.set(0, 0, 0); trick = null;
}
function cair(motivo) { // queda: perde combo e multiplicador
  terminarManobra(); somAterrissar.tocar();
  pontosCombo = 0; mult = 1; comboT = 0; vel = 0; vh.set(0, 0); vy = 0; rail = null;
  visual.rotation.x = -1.3; visual.position.y = 0.4; skate.rotation.set(0.4, 0.8, 1.2);
  tEst = 1.1; setEstado('queda'); msg(`CAIU! ${motivo} — combo perdido`, 1600);
}
function aterrissar(gy) {
  pos.y = gy; vy = 0; vyChao = 0; terminarManobra();
  const sp = vh.length(), yaw = jogador.rotation.y;
  // Aterrissou de lado (60°–120° em relação ao movimento)? Então cai.
  if (sp > 2 && Math.abs((Math.sin(yaw) * vh.x + Math.cos(yaw) * vh.y) / sp) < 0.5) return cair('Aterrissou de lado!');
  if (sp > 0.5) { rumo = Math.atan2(vh.x, vh.y); vel = sp; }
  somAterrissar.tocar(); tAterr = 0.25; if (mixer) tocarAnim('aterrissar');
  if (pontosCombo > 0) comboT = CFG.tempoCombo;
  estado = 'chao'; voltas = 0;
}
function iniciarGrind(r, t) {
  const yaw = jogador.rotation.y, sp = vh.length();
  if (Math.abs(Math.sin(yaw) * r.dx + Math.cos(yaw) * r.dz) < 0.5) return cair('Entrou de lado no corrimão!');
  terminarManobra();
  rail = r; railT = t; railSinal = (vh.x * r.dx + vh.y * r.dz) >= 0 ? 1 : -1; railVel = Math.max(sp, 6);
  rumo = Math.atan2(railSinal * r.dx, railSinal * r.dz); vy = 0; gT = 0; comboT = 0; setEstado('grind'); msg('GRIND!', 700);
}
function sairGrind(pulo) {
  vh.set(rail.dx * railSinal * railVel, rail.dz * railSinal * railVel); vy = pulo ? CFG.impulsoPulo * 0.8 : 3;
  if (pulo) somPulo.tocar(); rail = null; gCD = 0.4; voltas = 0; giroAcum = 0; setEstado('ar');
}

function atualizar(dt) {
  const on = jogando, W = on && k('KeyW', 'ArrowUp'), S = on && k('KeyS', 'ArrowDown');
  const dirX = on ? (k('KeyA', 'ArrowLeft') ? 1 : k('KeyD', 'ArrowRight') ? -1 : 0) : 0; // esquerda = +1
  const pulo = on && pedPulo, manobra = on ? pedManobra : null; pedPulo = false; pedManobra = null;
  gCD -= dt;

  if (estado === 'chao' || estado === 'agachando') {
    vel = THREE.MathUtils.clamp((vel + (W ? CFG.acel : 0) * dt - (S ? CFG.freio * dt : 0)) * Math.exp(-0.4 * dt), -3, CFG.vMax);
    rumo += dirX * CFG.giroRumo * Math.min(1, Math.abs(vel) / 3 + 0.3) * dt;
    const fx = Math.sin(rumo), fz = Math.cos(rumo), nx = limitar(pos.x + fx * vel * dt), nz = limitar(pos.z + fz * vel * dt), g = alturaEm(nx, nz);
    if (g - pos.y > 0.5) vel *= 0.2;                                  // bateu na parte de trás da rampa
    else if (pos.y - g > 0.5) {                                       // saiu do topo da rampa: decola
      pos.x = nx; pos.z = nz; vy = Math.max(0, vyChao * 1.25); vh.set(fx * vel, fz * vel); giroAcum = 0; voltas = 0; setEstado('ar');
    } else { vyChao = (g - pos.y) / dt; pos.set(nx, g, nz); }
    if (pulo && estado === 'chao') { tEst = CFG.tempoAgachar; setEstado('agachando'); }
    if (estado === 'agachando' && (tEst -= dt) <= 0) {                // impulso do pulo
      vy = CFG.impulsoPulo + Math.max(0, vyChao); vh.set(fx * vel, fz * vel); giroAcum = 0; voltas = 0; somPulo.tocar(); setEstado('ar');
    }
    const p = Math.atan2(alturaEm(pos.x + fx * 0.6, pos.z + fz * 0.6) - alturaEm(pos.x - fx * 0.6, pos.z - fz * 0.6), 1.2);
    corpo.rotation.x += (-p - corpo.rotation.x) * Math.min(1, 12 * dt);  // inclina junto com a rampa
    jogador.rotation.y = girarAte(jogador.rotation.y, rumo, 12 * dt);
    if (estado === 'chao' && pontosCombo > 0 && (comboT -= dt) <= 0) {  // fecha o combo: soma e dobra o multiplicador
      const ganho = pontosCombo * mult; total += ganho; msg(`COMBO! +${ganho.toLocaleString('pt-BR')} (x${mult})`, 1800);
      mult = Math.min(mult * 2, 1024); pontosCombo = 0;
    }
  } else if (estado === 'ar') {
    vy -= CFG.gravidade * dt;
    if (dirX) { // giro aéreo: 50 pontos por meia-volta (180°), cada meia-volta vale mais que a anterior
      const d = dirX * CFG.giroAr * dt; jogador.rotation.y += d; giroAcum += Math.abs(d);
      while (giroAcum >= Math.PI) { giroAcum -= Math.PI; voltas++; pontosCombo += 50 * voltas; msg(`Giro ${voltas * 180}°  +${50 * voltas}`, 800); }
    }
    pos.x = limitar(pos.x + vh.x * dt); pos.z = limitar(pos.z + vh.y * dt); pos.y += vy * dt;
    corpo.rotation.x += (0 - corpo.rotation.x) * Math.min(1, 8 * dt);
    if (manobra && !trick) trick = { def: MANOBRAS[manobra], t: 0 };
    if (trick) {
      trick.t += dt / CFG.tempoManobra; const e = 1 - Math.pow(1 - Math.min(trick.t, 1), 2), d = trick.def;
      if (d.eixo === 'z') skate.rotation.z = d.sinal * 2 * Math.PI * e; else skate.rotation.y = 2 * Math.PI * e;
      if (trick.t >= 1) terminarManobra();
    }
    if (vy <= 1.5 && gCD <= 0) {
      for (const r of CORRIMAOS) {
        const rx = pos.x - r.ax, rz = pos.z - r.az, t = rx * r.dx + rz * r.dz;
        if (t > 0 && t < r.len && Math.abs(rx * r.dz - rz * r.dx) < 0.7 && Math.abs(pos.y - r.y) < 0.4) { iniciarGrind(r, t); break; }
      }
    }
    if (estado === 'ar') {
      const g = alturaEm(pos.x, pos.z);
      if (pos.y <= g) {
        if (g - pos.y > 0.6) { pos.x -= vh.x * dt; pos.z -= vh.y * dt; vh.set(0, 0); }  // bateu na lateral da rampa
        else if (vy <= 0) aterrissar(g);
      }
    }
  } else if (estado === 'grind') {
    railT += railSinal * railVel * dt;
    if (railT < 0 || railT > rail.len) { railT = THREE.MathUtils.clamp(railT, 0, rail.len); pos.x = rail.ax + rail.dx * railT; pos.z = rail.az + rail.dz * railT; sairGrind(false); }
    else {
      pos.set(rail.ax + rail.dx * railT, rail.y, rail.az + rail.dz * railT);
      for (gT += dt; gT >= CFG.grindIntervalo; gT -= CFG.grindIntervalo) pontosCombo = CFG.grindMultiplica ? Math.max(pontosCombo, 1) * 10 : pontosCombo + CFG.grindPontos;
      jogador.rotation.y = girarAte(jogador.rotation.y, rumo, 15 * dt);
      if (pulo) sairGrind(true);
    }
  } else if (estado === 'queda' && (tEst -= dt) <= 0) {
    visual.rotation.x = 0; visual.position.y = 0.16; skate.rotation.set(0, 0, 0); setEstado('chao');
  }

  // Efeito de escala quando o modelo não tem animações
  if (animacaoProcedural) {
    let aY = 1, aXZ = 1;
    if (estado === 'agachando') { aY = 0.75; aXZ = 1.1; } else if (estado === 'ar') { aY = 1.08; aXZ = 0.95; } else if (tAterr > 0) { aY = 0.82; aXZ = 1.08; }
    const f = Math.min(1, 20 * dt); visual.scale.y += (aY - visual.scale.y) * f; visual.scale.x += (aXZ - visual.scale.x) * f; visual.scale.z = visual.scale.x;
  }
  if (tAterr > 0 && (tAterr -= dt) <= 0 && mixer && estado === 'chao') tocarAnim('parado');

  elTotal.textContent = Math.floor(total).toLocaleString('pt-BR');
  elCombo.textContent = pontosCombo > 0 || mult > 1 ? `${pontosCombo.toLocaleString('pt-BR')} × ${mult}` : '';
}

// ---------- Câmera e loop ----------
let camYaw = Math.PI; const alvoCam = new THREE.Vector3(), relogio = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(relogio.getDelta(), 0.05);
  atualizar(dt); if (mixer) mixer.update(dt);
  camYaw = girarAte(camYaw, rumo, 3 * dt);
  alvoCam.set(pos.x - Math.sin(camYaw) * 9, pos.y * 0.5 + 4.5, pos.z - Math.cos(camYaw) * 9);
  camera.position.lerp(alvoCam, 1 - Math.exp(-8 * dt)); camera.lookAt(pos.x, pos.y + 1.2, pos.z);
  sol.position.set(pos.x + 12, 25, pos.z + 10); sol.target.position.copy(pos);
  renderer.render(scene, camera);
});
