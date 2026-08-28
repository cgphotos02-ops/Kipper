# Kipper — Panel de redes sociales

Panel interno para dos marcas independientes:

- **Proviser Seguridad** ([@proviserseguridad](https://instagram.com/proviserseguridad)) — seguridad privada
- **Nass Tecnología** ([@nasstecnologia](https://instagram.com/nasstecnologia)) — seguridad electrónica

## Estado actual

Todas las secciones están **en blanco / "aún no conectado"**. La estructura queda lista para cargar
datos reales: Inicio, Posts, Mi audiencia, Constancia, Parrilla, Tendencias, Competencia, Leads y Campañas.

Estas herramientas ya funcionan sin conexión de datos (todo se procesa en el navegador):

- **Constancia** — marcas tus 3 posts semanales; la racha se guarda en `localStorage`.
- **Parrilla** — pegas tu cronograma de Excel y lo muestra; genera parrilla de historias a partir de eventos.
- **Campañas → Planear campaña nueva** — genera una estructura de campaña a partir de un brief.
- **Campañas → Seguimiento de leads** — pegas el Excel semanal y clasifica los leads on/off target.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | El panel completo (HTML + CSS + JS en un solo archivo). |
| `data/pautas.json` | Estado de las pautas de Meta que muestra la pestaña **Pautas**. Se genera desde el informe de Meta y se versiona en el repo (persiste entre visitas). |
| `scripts/gen-pautas.js` | Convierte un informe de campañas de Meta (`.xlsx` o `.csv`) en `data/pautas.json`. |
| `data/live-metrics.json` | Datos de Meta Ads por marca. Vacío hasta conectar. Lo reescribe el flujo de Actions. |
| `scripts/refresh-meta-data.js` | Jala datos de la Graph API de Meta. Falta completar `AD_ACCOUNT_ID` y los IDs de campaña/conjunto de cada marca. |
| `.github/workflows/refresh-meta-data.yml` | Ejecuta el script anterior. Programación en pausa; se dispara a mano (`workflow_dispatch`). |
| `.github/workflows/deploy-pages.yml` | Publica el sitio en GitHub Pages en cada push a `main`. |

## Publicación

Publicado con **GitHub Pages** usando **GitHub Actions** como origen
(`.github/workflows/deploy-pages.yml`). Cada push a `main` empaqueta la raíz del
repo y la despliega. El propio workflow activa Pages la primera vez (`enablement: true`).

## Actualizar la pestaña Pautas

1. Descarga el informe de campañas de Meta (`.xlsx`).
2. `node scripts/gen-pautas.js "ruta/al/informe.xlsx"` → reescribe `data/pautas.json`.
3. `git add data/pautas.json && git commit -m "Actualiza pautas" && git push` → Pages se reconstruye y el panel muestra los nuevos datos.

## Conectar datos reales de Meta Ads

1. `Settings → Secrets and variables → Actions` → crear el secreto `META_ACCESS_TOKEN` (token con `ads_read`).
2. En `scripts/refresh-meta-data.js`, completar `AD_ACCOUNT_ID` y los `campaignIds` / `adsetIds` de cada marca.
3. Ejecutar el workflow **Actualizar datos de Meta Ads** a mano (pestaña Actions) o reactivar el `cron`.
