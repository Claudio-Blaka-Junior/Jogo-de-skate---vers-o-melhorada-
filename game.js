// =====================================================================
//  Skate 3D — Three.js 0.160.0 (carregado via importmap no index.html)
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ---------------------------------------------------------------------
// 1) CONFIGURAÇÕES (ajuste aqui sem mexer no resto do código)
// ---------------------------------------------------------------------
const CFG = {
  modelo: 'models/skatista.glb',
  sons: {
    pulo: 'sounds/pulo.mp3',
    aterrissar: 'sounds/aterrissar.mp3',
    musica: 'sounds/musica.mp3',
  },
  alturaPersonagem: 1.8,   // o modelo é redimensionado para esta altura (metros)
  rotacaoModelo: 0,        // se o modelo olhar para o lado errado, use Math.PI, Math.PI/2...
  velocidadeMax: 9,        // m/s
  aceleracao: 22,          // quanto rápido ganha velocidade
  atrito: 2.5,             // quanto rápido perde velocidade ao soltar as teclas
  gravidade: 24,           // m/s²
  impulsoPulo: 9,          // velocidade vertical inicial do pulo
  tempoAgachar: 0.2,       // segundos agachado antes de pular
  tempoAterrissarPadrao: 0.25, // usado se não houver clipe de aterrissagem
  tempoFade: 0.2,          // duração do crossfade entre animações
  limiteMapa: 95,          // o chão vai de -100 a +100
};

// Nomes possíveis de cada animação dentro do GLB (minúsculas).
// A busca tenta o nome exato e depois "contém". Se nada for achado,
// usa a ordem dos clipes: [parado, agachar, pulo, aterrissar].
const NOMES_ANIM = {
  aterrissar: ['aterrissar', 'aterrisar', 'landing', 'land'],
  agachar:    ['agachar', 'crouch', 'squat', 'prep'],
  pulo:       ['pulo', 'jump', 'ollie'],
  parado:     ['parado', 'idle', 'stand'],
};
const ORDEM_ANIM = ['parado', 'agachar', 'pulo', 'aterrissar'];

// ---------------------------------------------------------------------
// 2) ÁUDIO — se o arquivo não existir, o som simplesmente fica mudo
// ---------------------------------------------------------------------
function criarSom(url, { loop = false, volume = 1 } = {}) {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = loop;
  audio.volume = volume;
  let ok = true;

  // Arquivo ausente ou inválido: desativa este som e segue o jogo
  audio.addEventListener('error', () => {
    ok = false;
    console.warn(`[som] não foi possível carregar "${url}" — ficará em silêncio.`);
  });
  audio.src = url;

  return {
    // Toca do início (usado nos efeitos e na música)
    tocar() {
      if (!ok) return;
      try {
        audio.currentTime = 0;
        const p = audio.play();
        if (p) p.catch(() => {}); // o navegador pode bloquear: ignoramos
      } catch (_) { /* silêncio */ }
    },
    // Chamado no clique inicial: "destrava" o elemento para tocar depois
    liberar() {
      if (!ok) return;
      try {
        audio.muted = true;
        const p = audio.play();
        if (p) {
          p.then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; })
           .catch(() => { audio.muted = false; });
        }
      } catch (_) { audio.muted = false; }
    },
  };
}

const somPulo = criarSom(CFG.sons.pulo, { volume: 0.8 });
const somAterrissar = criarSom(CFG.sons.aterrissar, { volume: 0.9 });
const somMusica = criarSom(CFG.sons.musica, { loop: true, volume: 0.4 });

// ---------------------------------------------------------------------
// 3) CENA, CÂMERA, LUZ E CHÃO
// ---------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ad5ff);
scene.fog = new THREE.Fog(0x9ad5ff, 40, 140);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 5, 10);

// Luz ambiente (céu/chão) + luz direcional com sombra que segue o jogador
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.9));
const sol = new THREE.DirectionalLight(0xffffff, 1.4);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 60 });
scene.add(sol, sol.target);

// Chão simples + grade (ajuda a perceber o movimento)
const chao = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x5d6470, roughness: 0.9 })
);
chao.rotation.x = -Math.PI / 2;
chao.receiveShadow = true;
scene.add(chao);

const grade = new THREE.GridHelper(200, 100, 0x9aa3b2, 0x7a8292);
grade.position.y = 0.01;
scene.add(grade);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------
// 4) JOGADOR: grupo que se move + "visual" (modelo GLB ou cubo reserva)
// ---------------------------------------------------------------------
const jogador = new THREE.Group();   // posição e rotação (yaw) do skatista
const visual = new THREE.Group();    // contém o modelo; pode ser escalado (cubo)
jogador.add(visual);
scene.add(jogador);

let animacaoProcedural = false; // true se não há animações no GLB (ou se usa o cubo): agacha/estica por escala
let mixer = null;         // AnimationMixer (só existe com GLB que tenha animações)
const acoes = {};         // { parado, agachar, pulo, aterrissar } -> AnimationAction
let acaoAtual = null;
let duracaoAterrissar = CFG.tempoAterrissarPadrao;

const avisoEl = document.getElementById('aviso');
function avisar(texto) { avisoEl.textContent = texto; }

// Cubo reserva (usado se models/skatista.glb não existir)
function usarCubo() {
  animacaoProcedural = true;
  const cubo = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.6, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xff3d7f })
  );
  cubo.position.y = 0.8; // base do cubo no chão
  cubo.castShadow = true;
  visual.add(cubo);
}

// Procura um clipe pelo nome (exato primeiro, depois "contém"), ignorando os já usados
function acharClipe(clipes, apelidos, usados) {
  const livres = clipes.filter((c) => !usados.has(c));
  for (const ap of apelidos) {
    const exato = livres.find((c) => c.name.toLowerCase() === ap);
    if (exato) return exato;
  }
  for (const ap of apelidos) {
    const parcial = livres.find((c) => c.name.toLowerCase().includes(ap));
    if (parcial) return parcial;
  }
  return null;
}

async function carregarModelo() {
  try {
    // Loader com suporte a GLB comprimido (Draco e Meshopt), comum em exportações
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await loader.loadAsync(CFG.modelo);
    const modelo = gltf.scene;

    // Mostra no console o nome de todas as animações do GLB
    const clipes = gltf.animations;
    console.log('Animações no GLB:', clipes.map((c) => c.name));
    if (clipes.length === 0) {
      console.warn('O GLB não tem animações: usando efeito procedural (agachar/esticar).');
      animacaoProcedural = true;
    }

    modelo.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // evita o modelo "sumir" por caixa de colisão errada
      }
    });

    // Normaliza o tamanho e coloca os pés em y = 0, centrado em x/z
    // (o 2º parâmetro "true" mede a malha com precisão, útil para models com esqueleto)
    modelo.updateMatrixWorld(true);
    const caixa = new THREE.Box3().setFromObject(modelo, true);
    const tamanho = caixa.getSize(new THREE.Vector3());
    console.log('Tamanho original do modelo (x, y, z):', tamanho.x, tamanho.y, tamanho.z);
    if (!isFinite(tamanho.y) || tamanho.y <= 0) {
      console.warn('Tamanho do modelo inválido: ele pode estar vazio ou invisível.');
      avisar('Modelo carregou, mas o tamanho é inválido (veja o console).');
    }
    modelo.scale.setScalar(CFG.alturaPersonagem / (tamanho.y || 1));
    modelo.updateMatrixWorld(true);
    const caixa2 = new THREE.Box3().setFromObject(modelo, true);
    const centro = caixa2.getCenter(new THREE.Vector3());
    modelo.position.set(-centro.x, -caixa2.min.y, -centro.z);
    console.log('Modelo carregado. Malhas encontradas:',
      (() => { let n = 0; modelo.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) n++; }); return n; })());

    // Gira o modelo dentro do grupo, se necessário
    visual.rotation.y = CFG.rotacaoModelo;
    visual.add(modelo);

    // Monta o mixer e associa cada animação ao seu papel
    if (clipes.length > 0) {
      mixer = new THREE.AnimationMixer(modelo);
      const usados = new Set();
      const escolhidos = {};

      // 1ª tentativa: por nome (aterrissar vem primeiro para não "roubar" o clipe do pulo)
      for (const papel of ['aterrissar', 'agachar', 'pulo', 'parado']) {
        const clipe = acharClipe(clipes, NOMES_ANIM[papel], usados);
        if (clipe) { escolhidos[papel] = clipe; usados.add(clipe); }
      }
      // 2ª tentativa: pela ordem dos clipes, para os papéis que faltaram
      ORDEM_ANIM.forEach((papel, i) => {
        if (!escolhidos[papel] && clipes[i] && !usados.has(clipes[i])) {
          escolhidos[papel] = clipes[i];
          usados.add(clipes[i]);
        }
      });

      for (const papel of ORDEM_ANIM) {
        if (escolhidos[papel]) acoes[papel] = mixer.clipAction(escolhidos[papel]);
      }
      console.log('Mapeamento das animações:',
        Object.fromEntries(Object.entries(escolhidos).map(([k, v]) => [k, v.name])));

      if (escolhidos.aterrissar) {
        // Duração da aterrissagem segue o clipe (limitada para não travar o jogo)
        duracaoAterrissar = Math.min(Math.max(escolhidos.aterrissar.duration, 0.2), 0.6);
      }
      trocarAnimacao('parado');
    }
  } catch (erro) {
    console.warn(`[modelo] não foi possível carregar "${CFG.modelo}" — usando um cubo.`, erro);
    // Mostra o motivo real na tela, sem precisar abrir o console
    const motivo = (erro && (erro.message || String(erro))) || 'erro desconhecido';
    avisar(`Falha ao carregar o modelo (usando cubo): ${motivo}`.slice(0, 220));
    usarCubo();
  }
}

// Troca de animação com crossfade
function trocarAnimacao(papel, { umaVez = false } = {}) {
  const nova = acoes[papel];
  if (!nova || nova === acaoAtual) return;

  nova.reset();
  nova.setEffectiveWeight(1);
  nova.setLoop(umaVez ? THREE.LoopOnce : THREE.LoopRepeat, umaVez ? 1 : Infinity);
  nova.clampWhenFinished = umaVez; // congela no último quadro
  nova.play();

  if (acaoAtual) acaoAtual.crossFadeTo(nova, CFG.tempoFade, false);
  else nova.fadeIn(CFG.tempoFade);

  acaoAtual = nova;
}

carregarModelo();

// ---------------------------------------------------------------------
// 5) ENTRADA (teclado) E TELA INICIAL
// ---------------------------------------------------------------------
const teclas = new Set();
let jogando = false;   // só vira true depois do clique inicial
let pediuPulo = false;

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  teclas.add(e.code);
  if (e.code === 'Space' && !e.repeat) pediuPulo = true;
});
window.addEventListener('keyup', (e) => teclas.delete(e.code));
window.addEventListener('blur', () => teclas.clear()); // evita tecla "presa" ao trocar de aba

const telaInicio = document.getElementById('inicio');
function comecar() {
  if (jogando) return;
  jogando = true;
  telaInicio.style.display = 'none';

  // O clique do usuário libera o áudio no navegador
  somPulo.liberar();
  somAterrissar.liberar();
  somMusica.tocar();
}
telaInicio.addEventListener('click', comecar);
telaInicio.addEventListener('keydown', (e) => { if (e.code === 'Enter') comecar(); });

// ---------------------------------------------------------------------
// 6) LÓGICA DO JOGO
// ---------------------------------------------------------------------
// Estados: 'parado' (no chão) -> 'agachando' (0,2 s) -> 'no_ar' -> 'aterrissando' -> 'parado'
let estado = 'parado';
let temporizador = 0;
let velY = 0;
const velocidade = new THREE.Vector2(0, 0); // velocidade horizontal (x, z)

function eixo(positivas, negativas) {
  const p = positivas.some((c) => teclas.has(c)) ? 1 : 0;
  const n = negativas.some((c) => teclas.has(c)) ? 1 : 0;
  return p - n;
}

// Gira suavemente um ângulo atual em direção ao alvo, pelo caminho mais curto
function girarAte(atual, alvo, fator) {
  const diff = ((alvo - atual + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return atual + diff * Math.min(1, fator);
}

function atualizar(dt) {
  // --- Movimento horizontal (relativo à câmera, que olha para -Z) ---
  let ix = jogando ? eixo(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) : 0;
  let iz = jogando ? eixo(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) : 0;
  const tamanho = Math.hypot(ix, iz);
  if (tamanho > 0) { ix /= tamanho; iz /= tamanho; }

  // Controle reduzido enquanto agacha, aterrissa ou está no ar
  const controle = estado === 'parado' ? 1 : estado === 'no_ar' ? 0.6 : 0.5;
  velocidade.x += ix * CFG.aceleracao * controle * dt;
  velocidade.y += iz * CFG.aceleracao * controle * dt;

  // Atrito (mais forte quando não há tecla pressionada) e limite de velocidade
  const atrito = Math.exp(-CFG.atrito * (tamanho > 0 ? 0.4 : 1) * dt);
  velocidade.multiplyScalar(atrito);
  if (velocidade.length() > CFG.velocidadeMax) velocidade.setLength(CFG.velocidadeMax);

  // Aplica a posição, mantendo o jogador dentro do mapa
  jogador.position.x = THREE.MathUtils.clamp(jogador.position.x + velocidade.x * dt, -CFG.limiteMapa, CFG.limiteMapa);
  jogador.position.z = THREE.MathUtils.clamp(jogador.position.z + velocidade.y * dt, -CFG.limiteMapa, CFG.limiteMapa);

  // O skatista olha para onde está indo (o modelo deve "olhar" para +Z)
  if (velocidade.length() > 0.5) {
    jogador.rotation.y = girarAte(jogador.rotation.y, Math.atan2(velocidade.x, velocidade.y), 10 * dt);
  }

  // --- Máquina de estados do pulo ---
  if (pediuPulo && jogando && estado === 'parado') {
    estado = 'agachando';
    temporizador = CFG.tempoAgachar;
    trocarAnimacao('agachar', { umaVez: true });
  }
  pediuPulo = false;

  switch (estado) {
    case 'agachando':
      temporizador -= dt;
      if (temporizador <= 0) {
        // Impulso: sai do chão
        velY = CFG.impulsoPulo;
        estado = 'no_ar';
        trocarAnimacao('pulo', { umaVez: true });
        somPulo.tocar();
      }
      break;

    case 'no_ar':
      velY -= CFG.gravidade * dt;
      jogador.position.y += velY * dt;
      if (jogador.position.y <= 0 && velY < 0) {
        // Tocou o chão: aterrissa
        jogador.position.y = 0;
        velY = 0;
        estado = 'aterrissando';
        temporizador = duracaoAterrissar;
        trocarAnimacao('aterrissar', { umaVez: true });
        somAterrissar.tocar();
      }
      break;

    case 'aterrissando':
      temporizador -= dt;
      if (temporizador <= 0) {
        estado = 'parado';
        trocarAnimacao('parado');
      }
      break;
  }

  // Sem animações no GLB (ou com o cubo): simula agachar, esticar no ar e amassar ao aterrissar.
  // A escala é aplicada no grupo "visual", cuja origem fica nos pés do personagem.
  if (animacaoProcedural) {
    let alvoY = 1, alvoXZ = 1;
    if (estado === 'agachando')    { alvoY = 0.75; alvoXZ = 1.1; }
    if (estado === 'no_ar')        { alvoY = 1.08; alvoXZ = 0.95; }
    if (estado === 'aterrissando') { alvoY = 0.82; alvoXZ = 1.08; }
    const k = Math.min(1, 20 * dt);
    visual.scale.y += (alvoY - visual.scale.y) * k;
    visual.scale.x += (alvoXZ - visual.scale.x) * k;
    visual.scale.z = visual.scale.x;
  }
}

// ---------------------------------------------------------------------
// 7) CÂMERA EM TERCEIRA PESSOA
// ---------------------------------------------------------------------
const deslocamentoCamera = new THREE.Vector3(0, 4.5, 9); // atrás e acima do jogador
const alvoCamera = new THREE.Vector3();
const pontoOlhar = new THREE.Vector3();

function atualizarCamera(dt) {
  alvoCamera.copy(jogador.position).add(deslocamentoCamera);
  camera.position.lerp(alvoCamera, 1 - Math.exp(-6 * dt)); // segue com suavidade
  pontoOlhar.set(jogador.position.x, 1.2 + jogador.position.y * 0.5, jogador.position.z);
  camera.lookAt(pontoOlhar);

  // A luz com sombra acompanha o jogador
  sol.position.set(jogador.position.x + 10, 20, jogador.position.z + 8);
  sol.target.position.copy(jogador.position);
}

// ---------------------------------------------------------------------
// 8) LOOP PRINCIPAL
// ---------------------------------------------------------------------
const relogio = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(relogio.getDelta(), 0.05); // limita saltos de tempo (ex.: troca de aba)
  atualizar(dt);
  if (mixer) mixer.update(dt);
  atualizarCamera(dt);
  renderer.render(scene, camera);
});
