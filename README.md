# Kipper — Panel de redes sociales

Panel interno para dos marcas independientes:

- **Proviser Seguridad** ([@proviserseguridad](https://instagram.com/proviserseguridad)) — seguridad privada
- **Nass Tecnología** ([@nasstecnologia](https://instagram.com/nasstecnologia)) — seguridad electrónica

## Estado actual

Panel **solo de datos y reportes**. Secciones: Inicio, Posts, Mi audiencia, Competencia, Leads, Campañas y Pautas.
El cronograma de contenidos (parrilla) se lleva aparte, en Excel.

En la barra superior se elige la **marca** y el **mes**. Hoy los datos cargados corresponden a **agosto 2026**
(`data/social.json` → campo `month`). Los meses sin datos aparecen en el selector marcados como "sin datos"
y las tarjetas muestran un aviso.

Estas herramientas funcionan sin conexión de datos (todo se procesa en el navegador):

- **Campañas → Planear campaña nueva** — genera una estructura de campaña a partir de un brief.
- **Campañas → Seguimiento de leads** — pegas el Excel semanal y clasifica los leads on/off target.
- **Posts → Seguimiento de contenidos** — lista las piezas de la parrilla del mes; marcas Grabado / Elaborado / Programado / Publicado en cada una y el avance se guarda en el navegador (`localStorage`, clave `kipper_seguimiento`). Debajo, un donut con el % del plan ejecutado y el reparto por etapa.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | El panel completo (HTML + CSS + JS en un solo archivo). Selector de marca y de mes en la barra superior. |
| `data/pautas.json` | Estado de las pautas de Meta que muestra **Pautas → Cómo van ahora**. Se genera desde el informe de Meta y se versiona en el repo (persiste entre visitas). |
| `scripts/gen-pautas.js` | Convierte un informe de campañas de Meta (`.xlsx` o `.csv`) en `data/pautas.json`. |
| `data/metas.json` | Metas de pauta + glosario en lenguaje sencillo (los 4 números, semáforo, seguimiento mensual, recomendaciones). Alimenta **Pautas → Metas y qué significa cada número**. Se edita a mano desde el documento de metas. |
| `data/social.json` | Datos de Instagram + Facebook (Metricool) que alimentan **Inicio, Posts, Mi audiencia, Competencia**. Transcrito de los informes PDF de Metricool. |
| `data/seguimiento.json` | Lista de piezas de la parrilla (una fila por contenido, con mes/semana/marca/formato). La usa **Posts → Seguimiento de contenidos**. Los checks de avance NO están aquí: viven en el navegador. |
| `scripts/gen-seguimiento.js` | Convierte `ProviserXNass.xlsx` (todas las hojas visibles, una por mes) en `data/seguimiento.json`. Uso: `node scripts/gen-seguimiento.js "ruta/ProviserXNass.xlsx"`. |
| `data/live-metrics.json` | Datos de Meta Ads por marca. Vacío hasta conectar. Lo reescribe el flujo de Actions. |
| `scripts/refresh-meta-data.js` | Jala datos de la Graph API de Meta. Falta completar `AD_ACCOUNT_ID` y los IDs de campaña/conjunto de cada marca. |
| `.github/workflows/refresh-meta-data.yml` | Ejecuta el script anterior. Programación en pausa; se dispara a mano (`workflow_dispatch`). |
| `.github/workflows/deploy-pages.yml` | Publica el sitio en GitHub Pages en cada push a `main`. |

## Publicación

Publicado con **GitHub Pages** usando **GitHub Actions** como origen
(`.github/workflows/deploy-pages.yml`). Cada push a `main` empaqueta la raíz del
repo y la despliega. El propio workflow activa Pages la primera vez (`enablement: true`).

## Actualizar Inicio / Posts / Mi audiencia / Competencia (Metricool)

El plan de Metricool (Starter) no tiene API, así que estos datos se cargan a mano:

1. En Metricool → **Analítica**, exporta el informe **PDF** de cada cuenta: Instagram Proviser, Instagram Nass, Facebook Proviser, Facebook Nass (rango de fechas del mes).
2. Pásalos y se transcriben a `data/social.json` (estructura por marca → `instagram` / `facebook`: seguidores, crecimiento, alcance, mejor hora, ciudades, contenido, top posts, competidores).
3. `git add data/social.json && git commit && git push` → el panel se actualiza.

El desglose de audiencia por **edad y sexo** no viene en el PDF de Metricool (solo en el CSV); esas dos tarjetas quedan pendientes hasta exportar en ese formato.

**Cambiar de mes:** hoy `data/social.json` es de un solo mes (`"month": "2026-08"`). Para pasar a otro mes,
re-exporta los informes de ese mes y reescribe `data/social.json` con el nuevo `month` y los nuevos datos;
además actualiza `DATA_MONTH` en `index.html`. (Para conservar el histórico habría que pasar `social.json`
a una estructura por mes; hoy guarda solo el último cargado.)

## Actualizar la pestaña Pautas

1. Descarga el informe de campañas de Meta (`.xlsx`).
2. `node scripts/gen-pautas.js "ruta/al/informe.xlsx"` → reescribe `data/pautas.json`.
3. `git add data/pautas.json && git commit -m "Actualiza pautas" && git push` → Pages se reconstruye y el panel muestra los nuevos datos.

## Conectar datos reales de Meta Ads

1. `Settings → Secrets and variables → Actions` → crear el secreto `META_ACCESS_TOKEN` (token con `ads_read`).
2. En `scripts/refresh-meta-data.js`, completar `AD_ACCOUNT_ID` y los `campaignIds` / `adsetIds` de cada marca.
3. Ejecutar el workflow **Actualizar datos de Meta Ads** a mano (pestaña Actions) o reactivar el `cron`.
