# IRRT v1.0 — App web (PeakU × Vilü)

Encuesta estandarizada anti-faking + panel de resultados por empresa. Node.js puro, **cero dependencias** (no requiere `npm install`).

## Probar en tu computador

```bash
cd irrt-app
node server.js
```

Abre `http://localhost:3000`:

1. **Probar rápido:** botón "Crear empresa demo" → te da ID y clave, con 5 candidatos de ejemplo (verde, rojo, amarillo-V, amarillo-P y no-interpretable).
2. **Flujo real:** registra una empresa → copia el enlace de encuesta → ábrelo en el celular (misma red: usa la IP del PC, ej. `http://192.168.1.10:3000/encuesta/XXXX`) → responde → mira el panel.

## Desplegar en Render

1. Sube la carpeta `irrt-app` a un repo de GitHub.
2. En Render: **New → Web Service** → conecta el repo.
3. Runtime: Node · Build Command: *(vacío)* · Start Command: `node server.js`.
4. Listo: la URL pública sirve portal y encuesta.

**Importante (persistencia):** el plan gratuito de Render tiene disco efímero: `data/db.json` se borra en cada deploy/reinicio. Para producción real: agrega un Persistent Disk en Render (montado en `/data` y define la variable `DATA_DIR=/data`), o migra el módulo de persistencia a Postgres (las funciones `loadDB/saveDB` en `server.js` son el único punto a tocar).

## Seguridad del instrumento

- La **clave de puntuación, pesos y umbrales viven solo en `server.js`**: el navegador del candidato nunca los recibe.
- Al candidato **nunca** se le muestra su puntaje.
- La clave de la empresa se guarda hasheada (scrypt).
- Umbrales calibrables en `CONFIG` (parte superior de `server.js`), documentados en el manual IRRT v1.0 (sección 7 y 10).

## Pendientes para producción seria

- HTTPS lo da Render automáticamente.
- Rotar variantes del Bloque B cada 6–12 meses (M8): editar `CATALOGO.B` y `CLAVE_B`.
- Calibración de umbrales con outcomes reales (no-show, asistencia 90 días) según el plan de validación del manual.
- Política de retención de datos (Ley 1581): borrar aplicaciones al cerrar cada proceso.
