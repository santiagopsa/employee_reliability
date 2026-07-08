# IRRT v1.1 — App web (PeakU × Vilü)

Encuesta estandarizada anti-faking + panel de resultados por empresa.

## Novedades v1.1

- **Login por correo**: el usuario de cada empresa es su email (la clave se genera al registrar).
- **Postgres**: con la variable `DATABASE_URL` los datos sobreviven deploys y reinicios. Sin ella (local), usa `data/db.json`.
- **Plan de prueba**: cada empresa ve el resultado completo de sus primeras **10** evaluaciones; las siguientes quedan registradas pero bloqueadas (🔒) con CTA para activar el plan. Límite configurable en `CONFIG.LIMITE_GRATIS` (server.js). El correo comercial del CTA está en `const CONTACTO` (portal.html).
- **Metodología reforzada** en `/metodologia`: probabilidades del estudio, ciencia de cada formato de pregunta y referencias académicas. Sin ítems, claves, pesos ni umbrales.

## Probar en tu computador

```bash
cd irrt-app
node server.js        # no necesita npm install en local (pg solo se usa si hay DATABASE_URL)
```

Abre `http://localhost:3000` → botón "Crear empresa demo" (5 candidatos de ejemplo, usuario demo+xxxx@peaku.co).

## Desplegar en Render (con base de datos)

Opción A — Blueprint (recomendada): sube el repo → en Render **New → Blueprint** → detecta `render.yaml` y crea el web service **y** el Postgres gratuito ya conectados.

Opción B — manual: crea un Postgres (New → Postgres, plan free) → crea el Web Service (Build: `npm install` · Start: `node server.js`) → en Environment añade `DATABASE_URL` con la *Internal Connection String* del Postgres.

El log de arranque dice qué almacenamiento está usando: `Almacenamiento: Postgres` o `archivo local`.

Nota: el Postgres gratuito de Render expira a los ~30 días (te avisan por email); para continuidad, plan Basic o migrar los datos.

## Seguridad del instrumento

- Claves de calificación, pesos y umbrales viven SOLO en `server.js`; el navegador nunca los recibe.
- Al candidato nunca se le muestra su puntaje.
- Clave de empresa hasheada (scrypt). Emails únicos.
- Umbrales calibrables en `CONFIG` (documentados en el manual IRRT, secciones 7 y 10).

## Recuperación de clave (procedimiento admin)

No hay envío de correos todavía, así que el reset lo haces tú **desde el navegador**:

1. En Render → Environment, define la variable `ADMIN_KEY` con un valor secreto largo (sin ella, el reset está deshabilitado).
2. Abre `https://employee-reliability.onrender.com/admin`, pon tu ADMIN_KEY y el correo de la empresa → te muestra la clave nueva con botón de copiar. La anterior queda invalidada al instante.
3. Envíasela a la empresa por un canal directo (verifica antes que quien la pide es dueño del correo registrado).

Alternativa por consola (PowerShell):

```powershell
Invoke-RestMethod -Method Post -Uri "https://employee-reliability.onrender.com/api/admin/reset-clave" `
  -Headers @{"x-admin-key"="TU_ADMIN_KEY"} -ContentType "application/json" `
  -Body '{"email":"correo@delaempresa.com"}'
```

En el portal, el login muestra "¿Olvidaste tu clave? Escríbenos" apuntando a hola@peaku.co (cámbialo en portal.html si usas otro correo).

## Pendientes para producción seria

- Rotar variantes del Bloque B cada 6–12 meses (M8): `CATALOGO.B` + `CLAVE_B`.
- Calibración de umbrales con outcomes reales (no-show, asistencia 90 días).
- Política de retención de datos (Ley 1581): borrar aplicaciones al cerrar cada proceso.
- Recuperación de clave (hoy no existe: anótala al registrar).
