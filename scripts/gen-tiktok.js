// Convierte el export "Overview.xlsx" de TikTok (serie diaria) y lo mete en data/social.json
// bajo accounts.<marca>.tiktok.daily.
// Uso:  node scripts/gen-tiktok.js "ruta/Overview.xlsx" <proviser|nass> [año, por defecto 2026]
//
// El Excel trae: Date ("31 de agosto"), Video Views, Profile Views, Likes, Comments, Shares — sin año.
// Se combina con lo que ya haya en social.json: los días del archivo reemplazan esos mismos días,
// el resto de días que ya estuvieran cargados se conserva.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC = process.argv[2];
const BRAND = process.argv[3];
const YEAR = process.argv[4] || '2026';
const OUT = path.join(__dirname, '..', 'data', 'social.json');

if (!SRC || !fs.existsSync(SRC)) { console.error('No encuentro el archivo:', SRC); process.exit(1); }
if (BRAND !== 'proviser' && BRAND !== 'nass') { console.error('La marca debe ser "proviser" o "nass". Recibido:', BRAND); process.exit(1); }

const MESES = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' };

function fechaISO(s) {
  // "31 de agosto" -> "2026-08-31"
  var m = String(s || '').trim().toLowerCase().match(/^(\d{1,2})\s+de\s+([a-záéíóúñ]+)/);
  if (!m) return null;
  var mm = MESES[m[2]];
  if (!mm) return null;
  var dd = (+m[1] < 10 ? '0' : '') + (+m[1]);
  return YEAR + '-' + mm + '-' + dd;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
execSync('unzip -o "' + SRC + '" -d "' + tmp + '"', { stdio: 'ignore' });
const rd = function (p) { return fs.readFileSync(path.join(tmp, p), 'utf8'); };

var strs = [];
var ssPath = path.join(tmp, 'xl', 'sharedStrings.xml');
if (fs.existsSync(ssPath)) {
  var ss = rd('xl/sharedStrings.xml'), m, re = /<si>([\s\S]*?)<\/si>/g;
  while ((m = re.exec(ss))) {
    var t = (m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, ''); });
    strs.push(t.join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  }
}
var wdir = path.join(tmp, 'xl', 'worksheets');
var shFile = fs.readdirSync(wdir).filter(function (f) { return /^sheet\d+\.xml$/.test(f); }).sort()[0];
var sh = rd('xl/worksheets/' + shFile);
var rowsX = sh.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
var colIdx = function (ref) { var s = ref.replace(/\d+/g, ''), n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; };
var grid = rowsX.map(function (rx) {
  var a = [], cm;
  var reC = /<c r="([A-Z]+\d+)"(?:[^>]*?t="([^"]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>)?<\/c>/g;
  while ((cm = reC.exec(rx))) {
    var k = colIdx(cm[1]);
    a[k] = cm[2] === 's' ? (strs[+cm[3]] || '') : (cm[2] === 'inlineStr' ? (cm[4] || '') : (cm[3] != null ? cm[3] : (cm[4] != null ? cm[4] : '')));
  }
  return a;
});

if (grid.length < 2) { console.error('El archivo no tiene filas de datos'); process.exit(1); }
var header = (grid[0] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
var idx = function (name) { return header.indexOf(name); };
var C = { date: idx('date'), views: idx('video views'), profile: idx('profile views'), likes: idx('likes'), comments: idx('comments'), shares: idx('shares') };
if (C.date < 0 || C.views < 0) { console.error('No reconozco las columnas. Encabezado:', header); process.exit(1); }

var daily = [];
for (var r = 1; r < grid.length; r++) {
  var row = grid[r] || [];
  var g = function (i) { return i >= 0 && i < row.length ? row[i] : ''; };
  var fecha = fechaISO(g(C.date));
  if (!fecha) continue;
  daily.push({
    fecha: fecha,
    views: +g(C.views) || 0,
    profileViews: +g(C.profile) || 0,
    likes: +g(C.likes) || 0,
    comments: +g(C.comments) || 0,
    shares: +g(C.shares) || 0
  });
}
daily.sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });

var social = JSON.parse(fs.readFileSync(OUT, 'utf8'));
if (!social.accounts[BRAND]) { console.error('La marca "' + BRAND + '" no existe en social.json'); process.exit(1); }
var existing = (social.accounts[BRAND].tiktok && social.accounts[BRAND].tiktok.daily) || [];
var byDate = {};
existing.forEach(function (d) { byDate[d.fecha] = d; });
daily.forEach(function (d) { byDate[d.fecha] = d; }); // el archivo nuevo pisa esos días
var merged = Object.keys(byDate).sort().map(function (k) { return byDate[k]; });

social.accounts[BRAND].tiktok = {
  source: 'TikTok — Overview.xlsx (serie diaria)',
  updatedAt: new Date().toISOString(),
  daily: merged
};

fs.writeFileSync(OUT, JSON.stringify(social, null, 2) + '\n');
var totViews = daily.reduce(function (s, d) { return s + d.views; }, 0);
console.log('OK · ' + daily.length + ' días cargados (' + daily[0].fecha + ' a ' + daily[daily.length - 1].fecha + ') · ' + totViews.toLocaleString('es-CO') + ' vistas · marca: ' + BRAND);
console.log('Total de días guardados para ' + BRAND + ': ' + merged.length);
