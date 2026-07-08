/* IRRT v1.0 — Servidor (Node.js sin dependencias)
 * PeakU × Vilü · Instrumento de Riesgo de Rotación Temprana
 * Correr local:  node server.js  →  http://localhost:3000
 * En Render:     Start Command = node server.js  (PORT lo pone Render)
 *
 * IMPORTANTE: la clave de puntuación vive SOLO aquí (servidor).
 * El cliente nunca recibe pesos, claves ni umbrales.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ================= CONFIG CALIBRABLE (sección 7 y 10 del documento IRRT) ================= */
const CONFIG = {
  PESOS: { B: 0.40, A: 0.25, C: 0.20, E: 0.15 },
  CORTE_VERDE: 40,        // < 40 → verde (proxy p70; recalibrar con base real)
  CORTE_ROJO: 55,         // >= 55 → rojo (proxy p85)
  MULT_SIN_ANCLAS: 1.15,
  UMBRAL_DRIVER_PUENTE: 3,     // sobre 4.5
  UMBRAL_AMARILLO_V: 22,       // D compuesto 6–30 (proxy p75; recalibrar)
  UMBRAL_EST: 2 / 3,           // proporción de terminaciones estructurales
  // pisos de tiempo por bloque en segundos (V5): por debajo = flag de velocidad
  PISOS_TIEMPO: { A: 25, B: 45, C: 15, D: 20, E: 8, F: 10 }
};

/* ================= CATÁLOGO DE ÍTEMS (lo que SÍ ve el cliente: sin claves) ================= */
const LIKERT = ['1 · Nada de acuerdo', '2', '3', '4', '5 · Totalmente de acuerdo'];
const CATALOGO = {
  intro: {
    titulo: 'Queremos conocer tu experiencia laboral real',
    texto: 'No hay respuestas buenas ni malas: hay respuestas tuyas. Tus datos están protegidos por la ley de habeas data (Ley 1581 de 2012) y solo se usan en este proceso de selección. Ten en cuenta que la información de tu historial laboral se confirma con tus referencias, así que responde con tranquilidad y con la verdad.',
    consentimiento: 'Autorizo el tratamiento de mis datos personales para este proceso de selección.'
  },
  A: {
    titulo: 'Tu historial laboral',
    nEmpleos: { texto: 'Sin contar este proceso, ¿en cuántos empleos has trabajado en los últimos 3 años?', opciones: ['Ninguno (este sería mi primer empleo reciente)', '1', '2', '3 o más'] },
    porEmpleo: [
      { id: 'a1', texto: '¿Cuánto tiempo trabajaste ahí?', opciones: ['Menos de 3 meses', '3 a 6 meses', '6 a 12 meses', '1 a 2 años', 'Más de 2 años'] },
      { id: 'a2', texto: '¿Qué tipo de vínculo tenías?', opciones: ['Contrato indefinido', 'Contrato fijo', 'Obra o labor', 'Temporal / por agencia', 'Informal / sin contrato', 'Independiente'] },
      { id: 'a3', texto: '¿Cómo terminó?', opciones: ['Sigo trabajando ahí', 'Se terminó el contrato o la obra', 'La empresa cerró, recortó o quebró', 'Me despidieron', 'Renuncié porque tenía otra oferta', 'Renuncié sin tener otra cosa', 'Fue de mutuo acuerdo'] },
      { id: 'a4', texto: 'Si renunciaste: desde que sentiste que algo no funcionaba, ¿cuánto pasó hasta que saliste?', opciones: ['Menos de 1 mes', '1 a 3 meses', 'Más de 3 meses', 'No renuncié yo'], condicional: true },
      { id: 'a5', texto: 'Entre ese empleo y el siguiente, ¿cuánto estuviste sin trabajar?', opciones: ['Pasé directo', 'Menos de 1 mes', '1 a 3 meses', 'Más de 3 meses'] }
    ]
  },
  B: {
    titulo: 'Situaciones de trabajo',
    instruccion: 'En cada situación, elige lo que de verdad harías tú (no lo que suena mejor). Todas las opciones son respuestas que ha dado gente real.',
    items: [
      { id: 'b1', texto: 'Llevas 3 semanas en un trabajo nuevo. Un conocido te ofrece un "camello" de un solo día que paga lo mismo que una semana de tu sueldo, pero es un martes normal de trabajo. ¿Qué haces?', opciones: ['No lo tomo: acabo de empezar y no quiero arriesgar el puesto', 'Pido el día explicando la verdad, y si no me lo dan, no voy al camello', 'Pido el día con otra excusa que suene mejor', 'Me reporto enfermo ese martes y tomo el camello'] },
      { id: 'b1p', texto: 'De 10 personas con las que has trabajado, ¿cuántas crees que elegirían las últimas dos opciones?', opciones: ['0 a 2', '3 a 5', '6 o más'] },
      { id: 'b2', texto: 'A los 5 días de empezar descubres que el puesto incluye tareas pesadas que nadie te mencionó en la entrevista. ¿Qué haces?', opciones: ['Hablo con el jefe: le digo qué me ofrecieron y qué estoy viendo', 'Me aguanto: así son los trabajos, uno no puede ponerse delicado', 'Sigo yendo mientras consigo otra cosa, sin decir nada', 'Bajo el ritmo: si ellos no cumplen, yo tampoco tengo que matarme'] },
      { id: 'b2p', texto: '¿Cuántas de 10 personas que conoces harían las últimas dos opciones?', opciones: ['0 a 2', '3 a 5', '6 o más'] },
      { id: 'b3', texto: 'Llevas 2 meses en un trabajo que está bien. Te ofrecen otro con 15% más de sueldo, para empezar el lunes. ¿Qué haces?', opciones: ['Me quedo: dos meses es muy poco para irme y quiero crecer aquí', 'Hablo con mi jefe: le cuento la oferta y pregunto si hay forma de mejorar', 'Acepto la oferta y aviso con tiempo para entregar bien', 'Acepto y aviso el mismo lunes: las oportunidades no esperan'] },
      { id: 'b4', texto: 'Tu jefe te corrige delante de otros de una forma que sientes injusta. ¿Qué haces?', opciones: ['Después, en privado, le digo cómo lo sentí', 'No digo nada: no vale la pena pelear por eso', 'Le respondo ahí mismo para que no se repita', 'No digo nada, pero empiezo a mirar otras opciones'] },
      { id: 'b4p', texto: '¿Cuántas de 10 personas harían la última opción?', opciones: ['0 a 2', '3 a 5', '6 o más'] },
      { id: 'b5', texto: 'Mañana tienes que acompañar a un familiar a una cita médica que no se puede mover. ¿Qué haces?', opciones: ['Aviso hoy mismo y propongo cómo cubrir mis tareas', 'Aviso mañana apenas empiece el turno', 'Primero busco quién me cubra y luego aviso', 'Veo si puedo resolverlo sin avisar, para no quedar mal'] },
      { id: 'b6', texto: 'Un compañero faltó ayer con una excusa que tú sabes que es falsa, y te pide que lo respaldes si preguntan. ¿Qué haces?', opciones: ['Le digo que no cuente conmigo para eso', 'No digo nada si no me preguntan, pero no miento si me preguntan', 'Lo respaldo esta vez, pero le digo que no más', 'Lo respaldo: entre compañeros uno se cubre'] }
    ]
  },
  C: {
    titulo: 'Qué te mueve hoy',
    instruccion: 'En cada grupo marca la frase que MÁS te describe hoy y la que MENOS te describe. No hay combinaciones buenas ni malas.',
    items: [
      { id: 'c1', opciones: ['Necesito generar ingresos ya; lo demás se va viendo', 'Busco un lugar para quedarme varios años', 'Quiero aprender rápido, aunque al principio pague menos', 'Quiero un horario que me deje tiempo para mi vida'] },
      { id: 'c2', opciones: ['Prefiero un sueldo alto aunque el ambiente sea regular', 'Prefiero un buen ambiente aunque el sueldo sea normal', 'Prefiero un contrato estable aunque el trabajo sea rutinario', 'Prefiero variedad y reto aunque haya menos estabilidad'] },
      { id: 'c3', opciones: ['Un trabajo es un medio para conseguir otras metas', 'Un buen trabajo puede ser un proyecto de años', 'Lo importante es que me traten bien, lo demás se negocia', 'Lo importante es que me paguen cumplido, lo demás se aguanta'] },
      { id: 'c4', opciones: ['Si me sale algo mejor, me voy sin pensarlo mucho', 'Si me sale algo mejor, lo comparo con calma antes de decidir', 'Casi nunca miro otras ofertas si estoy bien', 'Siempre estoy mirando qué más hay, aunque esté bien'] }
    ]
  },
  D: {
    titulo: 'Tu experiencia en empleos anteriores',
    instruccion: 'Pensando en TUS empleos anteriores, di qué tan de acuerdo estás con cada frase.',
    escala: LIKERT,
    items: [
      { id: 'd1', texto: 'En la mayoría de mis trabajos me ha tocado un jefe injusto conmigo.' },
      { id: 'd2', texto: 'Cuando algo me ha salido mal en el trabajo, casi siempre ha sido por cosas fuera de mi control.' },
      { id: 'v1', texto: 'Nunca en mi vida he llegado tarde a ninguna cita.' },
      { id: 'd3', texto: 'He tenido mala suerte con las empresas donde he trabajado.' },
      { id: 'v4', texto: 'Para confirmar que estás leyendo, en esta fila marca la opción 2.' },
      { id: 'd4', texto: 'Mirando atrás, hay salidas de trabajos que yo pude haber manejado mejor.' },
      { id: 'v3', texto: 'Nunca me he irritado con un compañero de trabajo.' },
      { id: 'd5', texto: 'En los trabajos donde he estado, el que se esfuerza tarde o temprano sale adelante.' },
      { id: 'd6', texto: 'Las empresas, en general, terminan incumpliendo lo que prometen al contratar.' }
    ]
  },
  E1: {
    titulo: 'Tu forma de ver el trabajo',
    escala: LIKERT,
    items: [
      { id: 'e1', texto: '"Si las cosas no mejoran rápido en un trabajo, lo mejor es buscar otro."' },
      { id: 'v2', texto: '"Jamás he dicho una mentira, ni siquiera pequeña."' }
    ]
  },
  F: {
    titulo: 'Tu logística',
    items: [
      { id: 'f1t', texto: 'De tu casa al sitio de trabajo, ¿cuánto tardarías puerta a puerta?', opciones: ['Menos de 30 min', '30 a 60 min', '60 a 90 min', 'Más de 90 min'] },
      { id: 'f1m', texto: '¿En qué te moverías principalmente?', opciones: ['Bus / transporte público', 'Moto', 'Bicicleta', 'A pie', 'Carro'] },
      { id: 'f2', texto: 'Si tu transporte de siempre te falla un día, ¿tienes plan B?', opciones: ['Sí, tengo alternativa clara', 'Más o menos: dependería del día', 'No, quedaría a la deriva'] },
      { id: 'f3', texto: '¿Tu ingreso mensual sostiene solo tus gastos o también los de otras personas?', opciones: ['Solo los míos', 'Los míos y los de 1 persona más', 'Los míos y los de 2 o más personas'] },
      { id: 'f4', texto: 'Este puesto tiene el horario que te informaron en la oferta. Siendo sincero contigo mismo, ¿ese horario te funciona de forma sostenida?', opciones: ['Sí, sin problema', 'Sí, aunque me tocaría reorganizarme', 'Me quedaría difícil sostenerlo'] }
    ]
  },
  E2: {
    titulo: 'Para cerrar',
    escala: LIKERT,
    items: [
      { id: 'e2', texto: '"Vale la pena aguantar unos meses difíciles si el trabajo promete a futuro."' },
      { id: 'e3', texto: '¿Dónde te ves dentro de 2 años?', opciones: ['En este mismo tipo de trabajo, creciendo', 'En la misma empresa, en un cargo mejor', 'Estudiando y trabajando a la vez', 'Con un negocio propio', 'Viviendo en otro país', 'Todavía no lo sé'] }
    ]
  }
};

/* ================= CLAVES DE PUNTUACIÓN (server-only) ================= */
const CLAVE_B = { b1: [0, 0, 3, 4], b2: [0, 1, 3, 4], b3: [0, 0, 2, 4], b4: [0, 2, 1, 4], b5: [0, 2, 0, 3], b6: [0, 1, 3, 4] };
const MAX_B = 4 + 4 + 4 + 4 + 3 + 4; // 23
const PROYECTIVAS = { b1p: 'b1', b2p: 'b2', b4p: 'b4' }; // "6 o más" (idx 2) → ×1.5 si el base > 0
const B_AV = { b2: [1], b4: [1] };   // opciones que suman leve a AV (resignación/evasión): b2.b, b4.b
const ESTRUCTURALES = [1, 2];        // a3: fin contrato/obra, cierre/quiebra/recorte
const RENUNCIA_SIN_OFERTA = 5, RENUNCIA_CON_OFERTA = 4;

function puntuar(r, tiempos) {
  const notas = [];
  /* ---- Bloque A ---- */
  const empleos = r.empleos || [];
  const n = empleos.length;
  let svt = 0, est = 0, impulsivas = 0, inconsistenciaA = false, salidaConflicto = false;
  for (const e of empleos) {
    const tenureCorto = e.a1 <= 1; // <6 meses
    if (e.a3 === RENUNCIA_SIN_OFERTA && tenureCorto) svt++;
    if (ESTRUCTURALES.includes(e.a3)) est++;
    if ((e.a3 === RENUNCIA_SIN_OFERTA || e.a3 === RENUNCIA_CON_OFERTA) && e.a4 === 0) impulsivas++;
    if (e.a3 === RENUNCIA_SIN_OFERTA || (e.a3 === RENUNCIA_CON_OFERTA && e.a4 === 0)) salidaConflicto = true;
    if (e.a3 === RENUNCIA_SIN_OFERTA && e.a5 === 0) inconsistenciaA = true; // renunció sin nada y "pasó directo"
  }
  const pctSVT = n ? svt / n : 0;
  const pctEST = n ? est / n : 0;
  let compA = pctSVT * 100 + (impulsivas >= 2 ? 10 : 0);
  compA = Math.min(compA, 100);
  if (n === 0) notas.push('Sin historial laboral reciente: componente A neutro (no penaliza primer empleo).');

  /* ---- Bloque B ---- */
  let rawB = 0, avLeve = 0;
  for (const k of Object.keys(CLAVE_B)) {
    let pts = CLAVE_B[k][r[k]] ?? 0;
    const proj = Object.keys(PROYECTIVAS).find(p => PROYECTIVAS[p] === k);
    if (proj && r[proj] === 2 && pts > 0) { pts *= 1.5; notas.push(`Norma percibida laxa amplifica ${k.toUpperCase()} (M4).`); }
    rawB += pts;
    if (B_AV[k] && B_AV[k].includes(r[k])) avLeve++;
  }
  const compB = Math.min((rawB / MAX_B) * 100, 100);

  /* ---- Bloque C: driver puente ---- */
  let puente = 0;
  if (r.c1mas === 0) puente += 0.5; if (r.c1menos === 1) puente += 0.5;
  if (r.c2mas === 0) puente += 0.5; if (r.c2menos === 2) puente += 0.5;
  if (r.c3mas === 0) puente += 0.5; if (r.c3menos === 1) puente += 0.5;
  if (r.c4mas === 0 || r.c4mas === 3) puente += 1; if (r.c4menos === 2) puente += 0.5;
  const compC = Math.min((puente / 4.5) * 100, 100);

  /* ---- Bloque D: Amarillo-V (likert 0-4 → 1-5) ---- */
  const L = k => (r[k] ?? 2) + 1;
  const dScore = L('d1') + L('d2') + L('d3') + L('d6') + (6 - L('d4')) + (6 - L('d5')); // 6–30

  /* ---- Bloque E ---- */
  let ptsE = 0;
  if (L('e1') >= 4) ptsE += 2;
  const driverAlto = puente >= CONFIG.UMBRAL_DRIVER_PUENTE;
  if ((r.e3 === 3 || r.e3 === 4) && driverAlto) ptsE += 1;
  const compE = Math.min((ptsE / 3) * 100, 100);

  /* ---- Índice Rojo ---- */
  let rojo = CONFIG.PESOS.B * compB + CONFIG.PESOS.A * compA + CONFIG.PESOS.C * compC + CONFIG.PESOS.E * compE;
  const sinAnclas = r.f3 === 0 && r.f4 === 2;
  if (sinAnclas) { rojo *= CONFIG.MULT_SIN_ANCLAS; notas.push('Sin anclas (F): multiplicador 1.15 aplicado.'); }
  rojo = Math.min(Math.round(rojo * 10) / 10, 100);

  /* ---- Validez ---- */
  const flags = [];
  const deseab = (L('v1') === 5 ? 1 : 0) + (L('v2') === 5 ? 1 : 0) + (L('v3') === 5 ? 1 : 0);
  if (deseab >= 2) flags.push('Deseabilidad social extrema (2+ virtudes imposibles en tope)');
  if (r.v4 !== 1) flags.push('Falló el ítem de atención (V4)');
  let flagsVel = 0;
  for (const b of Object.keys(CONFIG.PISOS_TIEMPO)) {
    if (tiempos && tiempos[b] != null && tiempos[b] < CONFIG.PISOS_TIEMPO[b] * 1000) flagsVel++;
  }
  if (flagsVel >= 2) flags.push(`Velocidad de respuesta anómala en ${flagsVel} bloques (V5)`);
  const aquiescencia = L('e1') >= 4 && L('e2') >= 4;
  if (aquiescencia && inconsistenciaA) flags.push('Inconsistencias simultáneas E1/E2 y A3/A5 (M6)');
  const interpretable = flags.length === 0;

  /* ---- Banderas y semáforo ---- */
  const amarilloP = n >= 2 && pctEST >= CONFIG.UMBRAL_EST && dScore < CONFIG.UMBRAL_AMARILLO_V; // requiere 2+ empleos: con 1 solo, la evidencia es débil
  const amarilloV = dScore >= CONFIG.UMBRAL_AMARILLO_V && salidaConflicto;

  let semaforo, accion;
  if (!interpretable) {
    semaforo = 'NO INTERPRETABLE';
    accion = 'Repetir en sitio con acompañamiento o pasar a entrevista estructurada. No cuenta como rojo.';
  } else if (rojo >= CONFIG.CORTE_ROJO) {
    semaforo = 'ROJO';
    accion = 'Solo avanza con doble confirmación: entrevista estructurada + referencias limpias. En cargos de asistencia crítica, recomendación de no avanzar.';
  } else if (amarilloV) {
    semaforo = 'AMARILLO-V';
    accion = 'Entrevista dirigida de agencia (Anexo B del manual) + segunda referencia preguntando cómo fue la salida. Contratable si aparece al menos un episodio de agencia propia.';
  } else if (amarilloP) {
    semaforo = 'AMARILLO-P';
    accion = 'Verificar referencias (fechas y causas de salida). Historial corto NO penaliza: es estructural. Contratable con onboarding estándar.';
  } else if (rojo >= CONFIG.CORTE_VERDE) {
    semaforo = 'VERDE-OBSERVACIÓN';
    accion = 'Avanza con verificación ligera de referencias de asistencia.';
  } else {
    semaforo = 'VERDE';
    accion = 'Avanza directo.';
  }

  return {
    indiceRojo: rojo, semaforo, accion, interpretable, flags, notas,
    componentes: { B: Math.round(compB), A: Math.round(compA), C: Math.round(compC), E: Math.round(compE) },
    detalle: {
      pctSalidasVoluntariasTempranas: Math.round(pctSVT * 100), pctTerminacionesEstructurales: Math.round(pctEST * 100),
      driverPuente: puente, dScore, deseabilidad: deseab, avLeve, sinAnclas,
      friccionLogistica: (r.f1t === 3 || r.f2 === 2) ? 'Alta (>90 min o sin plan B): considerar apoyo de ruta/beneficio' : 'Normal'
    },
    banderas: { amarilloP, amarilloV }
  };
}

/* ================= PERSISTENCIA (JSON con escritura atómica) ================= */
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { empresas: {}, aplicaciones: [] }; }
}
function saveDB(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
const hash = s => crypto.scryptSync(s, 'irrt-v1-salt', 32).toString('hex');
const id = len => crypto.randomBytes(24).toString('base64url').replace(/[-_]/g, '').slice(0, len);

/* ================= HTTP ================= */
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function leerBody(req) {
  return new Promise((ok, bad) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 3e5) { bad(new Error('payload')); req.destroy(); } });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } });
  });
}
function autenticar(req, db) {
  const eid = req.headers['x-empresa-id'], clave = req.headers['x-clave'];
  const emp = eid && db.empresas[eid];
  if (!emp || !clave || hash(clave) !== emp.claveHash) return null;
  return emp;
}
function servirArchivo(res, nombre, tipo) {
  try {
    const contenido = fs.readFileSync(path.join(__dirname, 'public', nombre));
    res.writeHead(200, { 'Content-Type': tipo + '; charset=utf-8' });
    res.end(contenido);
  } catch { res.writeHead(404); res.end('No encontrado'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    /* ---- páginas ---- */
    if (req.method === 'GET' && (p === '/' || p === '/portal')) return servirArchivo(res, 'portal.html', 'text/html');
    if (req.method === 'GET' && p.startsWith('/encuesta/')) return servirArchivo(res, 'encuesta.html', 'text/html');
    if (req.method === 'GET' && p === '/metodologia') return servirArchivo(res, 'metodologia.html', 'text/html');

    /* ---- API pública ---- */
    if (req.method === 'GET' && p === '/api/catalogo') return json(res, 200, CATALOGO);

    if (req.method === 'GET' && p.startsWith('/api/empresa-publica/')) {
      const db = loadDB(); const emp = db.empresas[p.split('/').pop()];
      if (!emp) return json(res, 404, { error: 'Enlace inválido: la empresa no existe.' });
      return json(res, 200, { nombre: emp.nombre });
    }

    if (req.method === 'POST' && p === '/api/empresas') {
      const b = await leerBody(req);
      if (!b.nombre || !b.email) return json(res, 400, { error: 'Nombre de empresa y email son obligatorios.' });
      const db = loadDB();
      const empresaId = id(8), clave = id(10);
      db.empresas[empresaId] = { empresaId, nombre: String(b.nombre).slice(0, 120), email: String(b.email).slice(0, 120), claveHash: hash(clave), creada: new Date().toISOString() };
      saveDB(db);
      return json(res, 201, { empresaId, clave, aviso: 'Guarda esta clave: solo se muestra una vez.' });
    }

    if (req.method === 'POST' && p === '/api/aplicaciones') {
      const b = await leerBody(req);
      const db = loadDB();
      if (!b.empresaId || !db.empresas[b.empresaId]) return json(res, 400, { error: 'Empresa inválida.' });
      if (!b.candidato || !b.candidato.nombre || !b.candidato.documento) return json(res, 400, { error: 'Faltan datos del candidato.' });
      if (!b.consentimiento) return json(res, 400, { error: 'Se requiere el consentimiento de datos.' });
      const resultado = puntuar(b.respuestas || {}, b.tiempos || {});
      db.aplicaciones.push({
        id: id(10), empresaId: b.empresaId,
        candidato: { nombre: String(b.candidato.nombre).slice(0, 90), documento: String(b.candidato.documento).slice(0, 30), vacante: String(b.candidato.vacante || '').slice(0, 90) },
        fecha: new Date().toISOString(), respuestas: b.respuestas, tiempos: b.tiempos, resultado
      });
      saveDB(db);
      // Al candidato NUNCA se le devuelve el puntaje
      return json(res, 201, { ok: true, mensaje: '¡Listo! Tus respuestas fueron enviadas. La empresa continuará el proceso contigo.' });
    }

    /* ---- API autenticada (empresa) ---- */
    if (req.method === 'POST' && p === '/api/login') {
      const b = await leerBody(req); const db = loadDB();
      const emp = db.empresas[b.empresaId];
      if (!emp || hash(b.clave || '') !== emp.claveHash) return json(res, 401, { error: 'Empresa o clave incorrecta.' });
      return json(res, 200, { ok: true, nombre: emp.nombre, empresaId: emp.empresaId });
    }

    if (req.method === 'GET' && p === '/api/resultados') {
      const db = loadDB(); const emp = autenticar(req, db);
      if (!emp) return json(res, 401, { error: 'No autorizado.' });
      const lista = db.aplicaciones.filter(a => a.empresaId === emp.empresaId)
        .map(a => ({ id: a.id, fecha: a.fecha, candidato: a.candidato, resultado: a.resultado }))
        .sort((x, y) => y.fecha.localeCompare(x.fecha));
      return json(res, 200, { empresa: emp.nombre, total: lista.length, resultados: lista });
    }

    if (req.method === 'GET' && p === '/api/config-publica') {
      // solo etiquetas de interpretación para el panel (sin claves de ítems)
      return json(res, 200, { cortes: { verde: CONFIG.CORTE_VERDE, rojo: CONFIG.CORTE_ROJO }, version: 'IRRT v1.0' });
    }

    if (req.method === 'POST' && p === '/api/demo') {
      const db = loadDB();
      const empresaId = id(8), clave = id(10);
      db.empresas[empresaId] = { empresaId, nombre: 'Empresa Demo IRRT', email: 'demo@peaku.co', claveHash: hash(clave), creada: new Date().toISOString() };
      const casos = [
        ['Carlos Verde', '100000001', perfilLimpio()],
        ['Omar Rojo', '100000002', perfilOportunista()],
        ['Valeria Victimizada', '100000003', perfilVictimizado()],
        ['Pedro Precarizado', '100000004', perfilPrecarizado()],
        ['Ana Apurada', '100000005', perfilInvalido()]
      ];
      for (const [nombre, doc, rr] of casos) {
        db.aplicaciones.push({ id: id(10), empresaId, candidato: { nombre, documento: doc, vacante: 'Auxiliar operativo' }, fecha: new Date().toISOString(), respuestas: rr.r, tiempos: rr.t, resultado: puntuar(rr.r, rr.t) });
      }
      saveDB(db);
      return json(res, 201, { empresaId, clave, aviso: 'Empresa demo creada con 5 candidatos de ejemplo.' });
    }

    json(res, 404, { error: 'Ruta no encontrada' });
  } catch (e) {
    json(res, 500, { error: 'Error interno', detalle: String(e.message || e) });
  }
});

/* ---- perfiles sintéticos para el modo demo ---- */
const T_OK = { A: 90000, B: 120000, C: 40000, D: 60000, E: 20000, F: 30000 };
function base() {
  return { nEmpleos: 2, empleos: [{ a1: 3, a2: 0, a3: 1, a4: 3, a5: 1 }, { a1: 2, a2: 1, a3: 4, a4: 1, a5: 0 }], b1: 1, b1p: 0, b2: 0, b2p: 0, b3: 1, b4: 0, b4p: 0, b5: 0, b6: 1, c1mas: 2, c1menos: 0, c2mas: 1, c2menos: 0, c3mas: 2, c3menos: 3, c4mas: 1, c4menos: 0, d1: 1, d2: 1, d3: 0, d4: 3, d5: 3, d6: 2, v1: 1, v2: 1, v3: 2, v4: 1, e1: 1, e2: 3, e3: 1, f1t: 1, f1m: 0, f2: 0, f3: 1, f4: 0 };
}
function perfilLimpio() { return { r: base(), t: T_OK }; }
function perfilOportunista() {
  const r = base();
  Object.assign(r, { empleos: [{ a1: 0, a2: 4, a3: 5, a4: 0, a5: 1 }, { a1: 1, a2: 3, a3: 5, a4: 0, a5: 2 }, { a1: 0, a2: 4, a3: 4, a4: 0, a5: 0 }], nEmpleos: 3, b1: 2, b1p: 2, b2: 2, b2p: 2, b3: 3, b4: 3, b4p: 2, b5: 3, b6: 2, c1mas: 0, c1menos: 1, c2mas: 0, c2menos: 2, c3mas: 0, c3menos: 1, c4mas: 3, c4menos: 2, e1: 4, e3: 3, f3: 0, f4: 2 });
  return { r, t: T_OK };
}
function perfilVictimizado() {
  const r = base();
  Object.assign(r, { empleos: [{ a1: 1, a2: 1, a3: 5, a4: 0, a5: 2 }, { a1: 2, a2: 0, a3: 5, a4: 1, a5: 1 }], d1: 4, d2: 4, d3: 4, d4: 0, d5: 0, d6: 4, b4: 3, b4p: 1 });
  return { r, t: T_OK };
}
function perfilPrecarizado() {
  const r = base();
  Object.assign(r, { empleos: [{ a1: 1, a2: 2, a3: 1, a4: 3, a5: 2 }, { a1: 1, a2: 3, a3: 1, a4: 3, a5: 1 }, { a1: 2, a2: 2, a3: 2, a4: 3, a5: 2 }], nEmpleos: 3, d6: 3 });
  return { r, t: T_OK };
}
function perfilInvalido() {
  const r = base();
  Object.assign(r, { v1: 4, v2: 4, v3: 4, v4: 0 });
  return { r, t: { A: 8000, B: 20000, C: 5000, D: 9000, E: 3000, F: 4000 } };
}

server.listen(PORT, () => console.log(`IRRT v1.0 escuchando en http://localhost:${PORT}`));
