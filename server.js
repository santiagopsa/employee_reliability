/* IRRT v1.1 — Servidor (Node.js)
 * PeakU × Vilü · Instrumento de Riesgo de Rotación Temprana
 * Local:   node server.js            → http://localhost:3000  (guarda en data/db.json)
 * Render:  con DATABASE_URL definida → usa Postgres (los datos sobreviven deploys)
 *          Build Command: npm install · Start Command: node server.js
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
  CORTE_VERDE: 40,
  CORTE_ROJO: 55,
  MULT_SIN_ANCLAS: 1.15,
  UMBRAL_DRIVER_PUENTE: 3,
  UMBRAL_AMARILLO_V: 22,
  UMBRAL_EST: 2 / 3,
  PISOS_TIEMPO: { A: 25, B: 45, C: 15, D: 20, E: 8, F: 10 },
  LIMITE_GRATIS: 10   // evaluaciones con resultado visible por empresa (plan de prueba)
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
const MAX_B = 23;
const PROYECTIVAS = { b1p: 'b1', b2p: 'b2', b4p: 'b4' };
const B_AV = { b2: [1], b4: [1] };
const ESTRUCTURALES = [1, 2];
const RENUNCIA_SIN_OFERTA = 5, RENUNCIA_CON_OFERTA = 4;

function puntuar(r, tiempos) {
  const notas = [];
  const empleos = r.empleos || [];
  const n = empleos.length;
  let svt = 0, est = 0, impulsivas = 0, inconsistenciaA = false, salidaConflicto = false;
  for (const e of empleos) {
    const tenureCorto = e.a1 <= 1;
    if (e.a3 === RENUNCIA_SIN_OFERTA && tenureCorto) svt++;
    if (ESTRUCTURALES.includes(e.a3)) est++;
    if ((e.a3 === RENUNCIA_SIN_OFERTA || e.a3 === RENUNCIA_CON_OFERTA) && e.a4 === 0) impulsivas++;
    if (e.a3 === RENUNCIA_SIN_OFERTA || (e.a3 === RENUNCIA_CON_OFERTA && e.a4 === 0)) salidaConflicto = true;
    if (e.a3 === RENUNCIA_SIN_OFERTA && e.a5 === 0) inconsistenciaA = true;
  }
  const pctSVT = n ? svt / n : 0;
  const pctEST = n ? est / n : 0;
  let compA = Math.min(pctSVT * 100 + (impulsivas >= 2 ? 10 : 0), 100);
  if (n === 0) notas.push('Sin historial laboral reciente: componente A neutro (no penaliza primer empleo).');

  let rawB = 0, avLeve = 0;
  for (const k of Object.keys(CLAVE_B)) {
    let pts = CLAVE_B[k][r[k]] ?? 0;
    const proj = Object.keys(PROYECTIVAS).find(p => PROYECTIVAS[p] === k);
    if (proj && r[proj] === 2 && pts > 0) { pts *= 1.5; notas.push(`Norma percibida laxa amplifica ${k.toUpperCase()} (M4).`); }
    rawB += pts;
    if (B_AV[k] && B_AV[k].includes(r[k])) avLeve++;
  }
  const compB = Math.min((rawB / MAX_B) * 100, 100);

  let puente = 0;
  if (r.c1mas === 0) puente += 0.5; if (r.c1menos === 1) puente += 0.5;
  if (r.c2mas === 0) puente += 0.5; if (r.c2menos === 2) puente += 0.5;
  if (r.c3mas === 0) puente += 0.5; if (r.c3menos === 1) puente += 0.5;
  if (r.c4mas === 0 || r.c4mas === 3) puente += 1; if (r.c4menos === 2) puente += 0.5;
  const compC = Math.min((puente / 4.5) * 100, 100);

  const L = k => (r[k] ?? 2) + 1;
  const dScore = L('d1') + L('d2') + L('d3') + L('d6') + (6 - L('d4')) + (6 - L('d5'));

  let ptsE = 0;
  if (L('e1') >= 4) ptsE += 2;
  const driverAlto = puente >= CONFIG.UMBRAL_DRIVER_PUENTE;
  if ((r.e3 === 3 || r.e3 === 4) && driverAlto) ptsE += 1;
  const compE = Math.min((ptsE / 3) * 100, 100);

  let rojo = CONFIG.PESOS.B * compB + CONFIG.PESOS.A * compA + CONFIG.PESOS.C * compC + CONFIG.PESOS.E * compE;
  const sinAnclas = r.f3 === 0 && r.f4 === 2;
  if (sinAnclas) { rojo *= CONFIG.MULT_SIN_ANCLAS; notas.push('Sin anclas (F): multiplicador 1.15 aplicado.'); }
  rojo = Math.min(Math.round(rojo * 10) / 10, 100);

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

  const amarilloP = n >= 2 && pctEST >= CONFIG.UMBRAL_EST && dScore < CONFIG.UMBRAL_AMARILLO_V;
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
    accion = 'Entrevista dirigida de agencia + segunda referencia preguntando cómo fue la salida. Contratable si aparece al menos un episodio de agencia propia.';
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

/* ================= CAPA DE ALMACENAMIENTO =================
 * Con DATABASE_URL (Render Postgres): tablas irrt_empresas / irrt_aplicaciones.
 * Sin DATABASE_URL (local): archivo data/db.json.
 * Único punto a tocar para cambiar de motor.
 */
let store;

class FileStore {
  constructor() { this._load(); }
  _load() {
    try { this.db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch { this.db = { empresas: {}, aplicaciones: [] }; }
    if (!this.db.empresas) this.db.empresas = {};
    if (!this.db.aplicaciones) this.db.aplicaciones = [];
  }
  _save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }
  async init() {}
  async empresaPorId(id) { return this.db.empresas[id] || null; }
  async empresaPorEmail(email) {
    return Object.values(this.db.empresas).find(e => e.email === email) || null;
  }
  async crearEmpresa(emp) { this.db.empresas[emp.empresaId] = emp; this._save(); }
  async actualizarEmpresa(emp) { this.db.empresas[emp.empresaId] = emp; this._save(); }
  async guardarAplicacion(app) { this.db.aplicaciones.push(app); this._save(); }
  async aplicacionesDeEmpresa(empresaId) {
    return this.db.aplicaciones.filter(a => a.empresaId === empresaId);
  }
  async conteos() {
    return { empresas: Object.keys(this.db.empresas).length, aplicaciones: this.db.aplicaciones.length };
  }
}

class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS irrt_empresas(
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, data JSONB NOT NULL)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS irrt_aplicaciones(
      id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL, fecha TEXT NOT NULL, data JSONB NOT NULL)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS irrt_apps_emp ON irrt_aplicaciones(empresa_id)`);
  }
  async empresaPorId(id) {
    const r = await this.pool.query('SELECT data FROM irrt_empresas WHERE id=$1', [id]);
    return r.rows[0] ? r.rows[0].data : null;
  }
  async empresaPorEmail(email) {
    const r = await this.pool.query('SELECT data FROM irrt_empresas WHERE email=$1', [email]);
    return r.rows[0] ? r.rows[0].data : null;
  }
  async crearEmpresa(emp) {
    await this.pool.query('INSERT INTO irrt_empresas(id,email,data) VALUES($1,$2,$3)', [emp.empresaId, emp.email, emp]);
  }
  async actualizarEmpresa(emp) {
    await this.pool.query('UPDATE irrt_empresas SET data=$2 WHERE id=$1', [emp.empresaId, emp]);
  }
  async guardarAplicacion(app) {
    await this.pool.query('INSERT INTO irrt_aplicaciones(id,empresa_id,fecha,data) VALUES($1,$2,$3,$4)', [app.id, app.empresaId, app.fecha, app]);
  }
  async aplicacionesDeEmpresa(empresaId) {
    const r = await this.pool.query('SELECT data FROM irrt_aplicaciones WHERE empresa_id=$1', [empresaId]);
    return r.rows.map(x => x.data);
  }
  async conteos() {
    const e = await this.pool.query('SELECT COUNT(*)::int AS n FROM irrt_empresas');
    const a = await this.pool.query('SELECT COUNT(*)::int AS n FROM irrt_aplicaciones');
    return { empresas: e.rows[0].n, aplicaciones: a.rows[0].n };
  }
}

let TIPO_STORE = 'Archivo local (data/db.json) — ¡los datos se borran en cada deploy!';
if (process.env.DATABASE_URL) {
  try { store = new PgStore(process.env.DATABASE_URL); TIPO_STORE = 'Postgres'; console.log('Almacenamiento: Postgres'); }
  catch (e) { console.error('No se pudo cargar pg (' + e.message + '); usando archivo local.'); store = new FileStore(); }
} else {
  store = new FileStore(); console.log('Almacenamiento: archivo local (data/db.json)');
}

const hash = s => crypto.scryptSync(s, 'irrt-v1-salt', 32).toString('hex');
const id = len => crypto.randomBytes(24).toString('base64url').replace(/[-_]/g, '').slice(0, len);
const emailValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');

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
async function autenticar(req) {
  const eid = req.headers['x-empresa-id'], clave = req.headers['x-clave'];
  if (!eid || !clave) return null;
  const emp = await store.empresaPorId(eid);
  if (!emp || hash(clave) !== emp.claveHash) return null;
  return emp;
}
function servirArchivo(res, nombre, tipo) {
  try {
    const contenido = fs.readFileSync(path.join(__dirname, 'public', nombre));
    res.writeHead(200, { 'Content-Type': tipo + '; charset=utf-8' });
    res.end(contenido);
  } catch { res.writeHead(404); res.end('No encontrado'); }
}

/* Aplica el límite freemium: las primeras N (cronológicas) muestran resultado; el resto queda bloqueado. */
function aplicarLimite(apps, limite) {
  limite = limite || CONFIG.LIMITE_GRATIS;
  const orden = [...apps].sort((x, y) => x.fecha.localeCompare(y.fecha));
  const visibles = new Set(orden.slice(0, limite).map(a => a.id));
  const lista = apps.map(a => visibles.has(a.id)
    ? { id: a.id, fecha: a.fecha, candidato: a.candidato, resultado: a.resultado, bloqueado: false }
    : { id: a.id, fecha: a.fecha, candidato: a.candidato, bloqueado: true }
  ).sort((x, y) => y.fecha.localeCompare(x.fecha));
  return { lista, usadas: Math.min(apps.length, limite), bloqueadas: Math.max(0, apps.length - limite) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/portal')) return servirArchivo(res, 'portal.html', 'text/html');
    if (req.method === 'GET' && p.startsWith('/encuesta/')) return servirArchivo(res, 'encuesta.html', 'text/html');
    if (req.method === 'GET' && p === '/metodologia') return servirArchivo(res, 'metodologia.html', 'text/html');
    if (req.method === 'GET' && p === '/admin') return servirArchivo(res, 'admin.html', 'text/html');

    if (req.method === 'GET' && p === '/api/catalogo') return json(res, 200, CATALOGO);

    if (req.method === 'GET' && p.startsWith('/api/empresa-publica/')) {
      const emp = await store.empresaPorId(p.split('/').pop());
      if (!emp) return json(res, 404, { error: 'Enlace inválido: la empresa no existe.' });
      return json(res, 200, { nombre: emp.nombre });
    }

    if (req.method === 'POST' && p === '/api/empresas') {
      const b = await leerBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!b.nombre || !emailValido(email)) return json(res, 400, { error: 'Nombre de empresa y un correo válido son obligatorios.' });
      if (await store.empresaPorEmail(email)) return json(res, 409, { error: 'Ese correo ya está registrado. Usa "Ya tengo cuenta" para entrar.' });
      const empresaId = id(8), clave = id(10);
      await store.crearEmpresa({ empresaId, nombre: String(b.nombre).slice(0, 120), email, claveHash: hash(clave), creada: new Date().toISOString() });
      return json(res, 201, { empresaId, email, clave, aviso: 'Tu usuario es tu correo. Guarda la clave: solo se muestra una vez.' });
    }

    if (req.method === 'POST' && p === '/api/login') {
      const b = await leerBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      const emp = email ? await store.empresaPorEmail(email) : await store.empresaPorId(b.empresaId);
      if (!emp || hash(b.clave || '') !== emp.claveHash) return json(res, 401, { error: 'Correo o clave incorrecta.' });
      return json(res, 200, { ok: true, nombre: emp.nombre, empresaId: emp.empresaId, email: emp.email });
    }

    if (req.method === 'POST' && p === '/api/aplicaciones') {
      const b = await leerBody(req);
      if (!b.empresaId || !(await store.empresaPorId(b.empresaId))) return json(res, 400, { error: 'Empresa inválida.' });
      if (!b.candidato || !b.candidato.nombre || !b.candidato.documento) return json(res, 400, { error: 'Faltan datos del candidato.' });
      if (!b.consentimiento) return json(res, 400, { error: 'Se requiere el consentimiento de datos.' });
      const resultado = puntuar(b.respuestas || {}, b.tiempos || {});
      await store.guardarAplicacion({
        id: id(10), empresaId: b.empresaId,
        candidato: { nombre: String(b.candidato.nombre).slice(0, 90), documento: String(b.candidato.documento).slice(0, 30), vacante: String(b.candidato.vacante || '').slice(0, 90) },
        fecha: new Date().toISOString(), respuestas: b.respuestas, tiempos: b.tiempos, resultado
      });
      return json(res, 201, { ok: true, mensaje: '¡Listo! Tus respuestas fueron enviadas. La empresa continuará el proceso contigo.' });
    }

    if (req.method === 'GET' && p === '/api/resultados') {
      const emp = await autenticar(req);
      if (!emp) return json(res, 401, { error: 'No autorizado.' });
      const apps = await store.aplicacionesDeEmpresa(emp.empresaId);
      const limite = emp.limite || CONFIG.LIMITE_GRATIS;
      const { lista, usadas, bloqueadas } = aplicarLimite(apps, limite);
      return json(res, 200, {
        empresa: emp.nombre, total: apps.length, resultados: lista,
        plan: { tipo: emp.limite ? 'ampliado' : 'prueba', nombre: emp.limite ? 'Plan ampliado' : 'Prueba gratuita', limite, usadas, bloqueadas }
      });
    }

    if (req.method === 'GET' && p === '/api/config-publica') {
      return json(res, 200, { cortes: { verde: CONFIG.CORTE_VERDE, rojo: CONFIG.CORTE_ROJO }, limiteGratis: CONFIG.LIMITE_GRATIS, version: 'IRRT v1.1' });
    }

    /* ---- Admin: estado del sistema (verifica en vivo qué almacenamiento se usa y cuántos registros hay) */
    if (req.method === 'GET' && p === '/api/admin/estado') {
      if (!process.env.ADMIN_KEY) return json(res, 403, { error: 'Define ADMIN_KEY en el servidor.' });
      if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return json(res, 401, { error: 'Clave de administrador incorrecta.' });
      try {
        const n = await store.conteos();
        return json(res, 200, { ok: true, almacenamiento: TIPO_STORE, persistente: TIPO_STORE === 'Postgres', empresas: n.empresas, aplicaciones: n.aplicaciones, consultadoEn: new Date().toISOString() });
      } catch (e) {
        return json(res, 500, { error: 'La consulta al almacenamiento falló: ' + e.message });
      }
    }

    /* ---- Admin: ampliar el límite de evaluaciones con resultado de una empresa ---- */
    if (req.method === 'POST' && p === '/api/admin/limite') {
      if (!process.env.ADMIN_KEY) return json(res, 403, { error: 'Define ADMIN_KEY en el servidor.' });
      if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return json(res, 401, { error: 'Clave de administrador incorrecta.' });
      const b = await leerBody(req);
      const emp = await store.empresaPorEmail(String(b.email || '').trim().toLowerCase());
      if (!emp) return json(res, 404, { error: 'No existe una empresa con ese correo.' });
      const limite = parseInt(b.limite, 10);
      if (!Number.isInteger(limite) || limite < 1 || limite > 100000) return json(res, 400, { error: 'El límite debe ser un número entero entre 1 y 100000.' });
      const anterior = emp.limite || CONFIG.LIMITE_GRATIS;
      emp.limite = limite;
      emp.limiteActualizado = new Date().toISOString();
      await store.actualizarEmpresa(emp);
      const apps = await store.aplicacionesDeEmpresa(emp.empresaId);
      const desbloqueadas = Math.max(0, Math.min(apps.length, limite) - Math.min(apps.length, anterior));
      return json(res, 200, { ok: true, email: emp.email, nombre: emp.nombre, limiteAnterior: anterior, limiteNuevo: limite, evaluacionesActuales: apps.length, desbloqueadasAhora: desbloqueadas });
    }

    /* ---- Admin: resetear clave de una empresa (requiere ADMIN_KEY en variables de entorno) ----
     * Uso: POST /api/admin/reset-clave con header x-admin-key y body {"email":"empresa@x.com"} */
    if (req.method === 'POST' && p === '/api/admin/reset-clave') {
      if (!process.env.ADMIN_KEY) return json(res, 403, { error: 'Reset deshabilitado: define ADMIN_KEY en el servidor.' });
      if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return json(res, 401, { error: 'Clave de administrador incorrecta.' });
      const b = await leerBody(req);
      const emp = await store.empresaPorEmail(String(b.email || '').trim().toLowerCase());
      if (!emp) return json(res, 404, { error: 'No existe una empresa con ese correo.' });
      const claveNueva = id(10);
      emp.claveHash = hash(claveNueva);
      emp.claveReseteada = new Date().toISOString();
      await store.actualizarEmpresa(emp);
      return json(res, 200, { ok: true, email: emp.email, nombre: emp.nombre, claveNueva, aviso: 'Entrega esta clave a la empresa por un canal directo. Las sesiones anteriores quedan invalidadas.' });
    }

    if (req.method === 'POST' && p === '/api/demo') {
      const empresaId = id(8), clave = id(10);
      const email = ('demo+' + empresaId + '@peaku.co').toLowerCase();
      await store.crearEmpresa({ empresaId, nombre: 'Empresa Demo IRRT', email, claveHash: hash(clave), creada: new Date().toISOString() });
      const casos = [
        ['Carlos Verde', '100000001', perfilLimpio()],
        ['Omar Rojo', '100000002', perfilOportunista()],
        ['Valeria Victimizada', '100000003', perfilVictimizado()],
        ['Pedro Precarizado', '100000004', perfilPrecarizado()],
        ['Ana Apurada', '100000005', perfilInvalido()]
      ];
      for (const [nombre, doc, rr] of casos) {
        await store.guardarAplicacion({ id: id(10), empresaId, candidato: { nombre, documento: doc, vacante: 'Auxiliar operativo' }, fecha: new Date().toISOString(), respuestas: rr.r, tiempos: rr.t, resultado: puntuar(rr.r, rr.t) });
      }
      return json(res, 201, { empresaId, email, clave, aviso: 'Empresa demo creada con 5 candidatos de ejemplo. Usuario: ' + email });
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

store.init()
  .then(() => server.listen(PORT, () => console.log(`IRRT v1.1 escuchando en http://localhost:${PORT}`)))
  .catch(e => { console.error('Error inicializando almacenamiento:', e.message); process.exit(1); });
