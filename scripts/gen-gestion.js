// Convierte el Excel de gestión comercial que lleva el equipo (export de contactos de Kommo + columnas ESTADO / OBSERVACIONES / MES)
// en data/gestion.json: un RESUMEN por mes, sin datos personales.
// Uso:  node scripts/gen-gestion.js "ruta/kommo_export_contacts_and_companies_AAAA-MM-DD.xlsx"
//
// IMPORTANTE: data/gestion.json es público (GitHub Pages). Aquí solo se guardan conteos:
// nunca nombres, teléfonos, direcciones ni documentos.
// Los meses que ya estén en data/gestion.json y no vengan en este Excel se conservan; los que vengan se reemplazan.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC = process.argv[2];
const OUT = path.join(__dirname, '..', 'data', 'gestion.json');
if (!SRC || !fs.existsSync(SRC)) { console.error('No encuentro el archivo:', SRC); process.exit(1); }

const MESES = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' };
// Estados que NO son prospectos reales (no cuentan para medir la gestión comercial)
const NO_PROSPECTO = /vacante|no es un lead/i;
const MIN_REPETIDAS = 2;   // una observación de texto libre solo se publica si se repite (evita filtrar algo personal)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-'));
execSync('unzip -o "' + SRC + '" -d "' + tmp + '"', { stdio: 'ignore' });
const rd = function (p) { return fs.readFileSync(path.join(tmp, p), 'utf8'); };
var strs = [];
try {
  var ss = rd('xl/sharedStrings.xml'), m, re = /<si>([\s\S]*?)<\/si>/g;
  while ((m = re.exec(ss))) {
    strs.push((m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, ''); }).join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, '\n').replace(/&#39;/g, "'"));
  }
} catch (e) {}
var colIdx = function (ref) { var s = ref.replace(/\d+/g, ''), n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; };
function readSheet(file) {
  var sh = rd('xl/worksheets/' + file);
  return (sh.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).map(function (rx) {
    var a = [], cm, reC = /<c r="([A-Z]+\d+)"(?:[^>]*?t="([^"]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>)?<\/c>/g;
    while ((cm = reC.exec(rx))) {
      var k = colIdx(cm[1]);
      a[k] = cm[2] === 's' ? (strs[+cm[3]] || '') : (cm[2] === 'inlineStr' ? (cm[4] || '') : (cm[3] != null ? cm[3] : (cm[4] != null ? cm[4] : '')));
    }
    return a;
  });
}

// Hoja con más filas y que tenga la columna ESTADO
var wdir = path.join(tmp, 'xl', 'worksheets');
var best = null;
fs.readdirSync(wdir).filter(function (f) { return /^sheet\d+\.xml$/.test(f); }).forEach(function (f) {
  var g = readSheet(f);
  var h = (g[0] || []).map(function (x) { return String(x || '').trim().toUpperCase(); });
  if (h.indexOf('ESTADO') > -1 && h.indexOf('MES') > -1 && (!best || g.length > best.g.length)) best = { g: g, h: h };
});
if (!best) { console.error('No encuentro una hoja con las columnas ESTADO y MES.'); process.exit(1); }

var H = best.h, rows = best.g.slice(1);
var ix = function (name) { return H.indexOf(name.toUpperCase()); };
var C = { estado: ix('ESTADO'), mes: ix('MES'), obs: ix('OBSERVACIONES'), fecha: ix('FECHA DE CREACIÓN'),
  servicio: ix('TIPO DE SERVICIO (CONTACTO)'), urgencia: ix('¿CUÁNDO LO NECESITA? (CONTACTO)') };
var cell = function (r, i) { return i >= 0 && r[i] != null ? String(r[i]).trim() : ''; };

var months = {}, fechaDesajustada = 0;
rows.forEach(function (r) {
  var estado = cell(r, C.estado).toUpperCase();
  var mesTxt = cell(r, C.mes).toLowerCase();
  if (!estado || !MESES[mesTxt]) return;
  var year = (cell(r, C.fecha).match(/\.(\d{4})/) || [])[1] || '2026';
  var mk = year + '-' + MESES[mesTxt];
  var fm = (cell(r, C.fecha).match(/^\d{2}\.(\d{2})\.(\d{4})/) || []);
  if (fm[1] && (fm[2] + '-' + fm[1]) !== mk) fechaDesajustada++;
  var b = months[mk] || (months[mk] = { total: 0, estados: {}, observaciones: {}, servicio: {}, urgencia: {} });
  b.total++;
  b.estados[estado] = (b.estados[estado] || 0) + 1;
  var obs = cell(r, C.obs).toUpperCase();
  if (obs) { var ko = estado + '|' + obs; b.observaciones[ko] = (b.observaciones[ko] || 0) + 1; }
  var sv = cell(r, C.servicio); if (sv) b.servicio[sv] = (b.servicio[sv] || 0) + 1;
  var ur = cell(r, C.urgencia); if (ur) b.urgencia[ur] = (b.urgencia[ur] || 0) + 1;
});

Object.keys(months).forEach(function (mk) {
  var b = months[mk];
  var prospectos = 0;
  Object.keys(b.estados).forEach(function (e) { if (!NO_PROSPECTO.test(e)) prospectos += b.estados[e]; });
  b.prospectos = prospectos;
  b.observaciones = Object.keys(b.observaciones).filter(function (k) { return b.observaciones[k] >= MIN_REPETIDAS; })
    .map(function (k) { var p = k.split('|'); return { estado: p[0], texto: p.slice(1).join('|'), count: b.observaciones[k] }; })
    .sort(function (a, c) { return c.count - a.count; });
  b.servicio = Object.keys(b.servicio).map(function (k) { return { name: k, count: b.servicio[k] }; }).sort(function (a, c) { return c.count - a.count; });
  b.urgencia = Object.keys(b.urgencia).map(function (k) { return { name: k, count: b.urgencia[k] }; }).sort(function (a, c) { return c.count - a.count; });
});

var prev = {};
try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).months || {}; } catch (e) {}
Object.keys(months).forEach(function (k) { prev[k] = months[k]; });
var merged = {}; Object.keys(prev).sort().forEach(function (k) { merged[k] = prev[k]; });

fs.writeFileSync(OUT, JSON.stringify({
  source: 'Excel del equipo comercial (export de contactos de Kommo + ESTADO/OBSERVACIONES/MES)',
  file: path.basename(SRC),
  updatedAt: new Date().toISOString(),
  months: merged
}, null, 2) + '\n');

Object.keys(months).sort().forEach(function (k) {
  var b = months[k];
  console.log(k + ' · ' + b.total + ' contactos · ' + b.prospectos + ' prospectos · ' + Object.keys(b.estados).map(function (e) { return e + '=' + b.estados[e]; }).join(', '));
});
if (fechaDesajustada) console.log('Aviso: ' + fechaDesajustada + ' filas tienen una columna MES distinta al mes de su fecha de creación (se usó la columna MES).');
console.log('OK → data/gestion.json');
