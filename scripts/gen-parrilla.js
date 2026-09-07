// Convierte la parrilla de contenidos (Excel de SharePoint, ProviserXNass.xlsx) en data/parrilla.json.
// Uso:  node scripts/gen-parrilla.js "ruta/ProviserXNass.xlsx"  [nombre-de-hoja]
// Por defecto usa la primera hoja visible. El "Estado del diseño" se deduce del color de relleno
// de esa celda (rojo = Sin empezar, amarillo = En proceso, verde = Listo); si la celda tiene texto,
// se usa el texto.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC = process.argv[2];
const WANT_SHEET = process.argv[3] || null;
const OUT = path.join(__dirname, '..', 'data', 'parrilla.json');
if (!SRC || !fs.existsSync(SRC)) { console.error('No encuentro el archivo:', SRC); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'par-'));
execSync('unzip -o "' + SRC + '" -d "' + tmp + '"', { stdio: 'ignore' });
const rd = function (p) { return fs.readFileSync(path.join(tmp, p), 'utf8'); };

// ---- sharedStrings ----
var strs = [];
try {
  var ss = rd('xl/sharedStrings.xml'), m, re = /<si>([\s\S]*?)<\/si>/g;
  while ((m = re.exec(ss))) {
    var t = (m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, ''); });
    strs.push(t.join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#10;/g, '\n').replace(/&#39;/g, "'"));
  }
} catch (e) {}

// ---- estilos: color de relleno por índice de estilo ----
var styles = rd('xl/styles.xml');
var fills = (styles.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)[1].match(/<fill>[\s\S]*?<\/fill>/g) || [])
  .map(function (f) { var c = f.match(/<fgColor rgb="([0-9A-Fa-f]{8})"/); return c ? c[1].slice(2).toUpperCase() : null; });
var xfFill = (styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[\s\S]*?(?:\/>|<\/xf>)/g) || [])
  .map(function (x) { var f = x.match(/fillId="(\d+)"/); return f ? +f[1] : 0; });
function statusFromStyle(s) {
  if (s == null) return '';
  var rgb = fills[xfFill[+s]] || '';
  if (/B5CE39|92D050|00B050|A9D08E|B6D7A8/.test(rgb)) return 'Listo';
  if (/F0CC05|FFC000|FFFF00|FFD966|FFE599/.test(rgb)) return 'En proceso';
  if (/EA4335|C00000|FF0000|E06666|F4CCCC/.test(rgb)) return 'Sin empezar';
  return '';
}

// ---- elegir hoja ----
var wb = rd('xl/workbook.xml');
var sheets = [];
(wb.match(/<sheet [^>]*\/>/g) || []).forEach(function (s) {
  sheets.push({
    name: (s.match(/name="([^"]*)"/) || [])[1],
    rid: (s.match(/r:id="([^"]*)"/) || [])[1],
    hidden: /state="hidden"/.test(s)
  });
});
var rels = rd('xl/_rels/workbook.xml.rels');
sheets.forEach(function (s) {
  var m = rels.match(new RegExp('Id="' + s.rid + '"[^>]*Target="([^"]*)"'));
  s.file = m ? ('xl/' + m[1].replace(/^\/?xl\//, '')) : null;
});
var target = WANT_SHEET ? sheets.find(function (s) { return s.name === WANT_SHEET; })
  : sheets.find(function (s) { return !s.hidden; });
if (!target || !target.file) { console.error('No pude ubicar la hoja. Hojas:', sheets.map(function (s) { return s.name; })); process.exit(1); }

// ---- leer celdas (soporta <c .../> y <c>...</c>) ----
var sh = rd(target.file);
var colIdx = function (ref) { var s = ref.replace(/\d+/g, ''), n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; };
var grid = [], style = [];
(sh.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).forEach(function (rx) {
  var rn = +(rx.match(/<row r="(\d+)"/) || [])[1];
  var a = [], sa = [], m;
  var re = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  while ((m = re.exec(rx))) {
    var k = colIdx(m[1]), attrs = m[2] || '', inner = m[3] || '';
    sa[k] = (attrs.match(/\ss="(\d+)"/) || [])[1];
    var ty = (attrs.match(/\st="([^"]+)"/) || [])[1];
    var v = '';
    var vm = inner.match(/<v>([\s\S]*?)<\/v>/);
    var im = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
    if (vm) v = ty === 's' ? (strs[+vm[1]] || '') : vm[1];
    else if (im) v = im[1];
    a[k] = v;
  }
  grid[rn] = a; style[rn] = sa;
});

var iso = function (n) {
  n = +n; if (!isFinite(n) || n < 20000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
};
var clean = function (x) { return (x == null ? '' : String(x)).replace(/\s+\n/g, '\n').trim(); };

var week = null, lastDate = null, rows = [];
for (var i = 1; i < grid.length; i++) {
  var r = grid[i] || [], srow = style[i] || [];
  var b = clean(r[1]);
  if (/^Semana del /i.test(b)) { week = b.replace(/\s+/g, ' '); lastDate = null; continue; }
  var act = clean(r[2]), emp = clean(r[4]);
  if (!act || /^Actividad\/Evento/i.test(act) || /^(LISTO|EN PROCESO|NO INICIADO)$/i.test(act)) continue;
  if (!/proviser|nass/i.test(emp)) continue;
  if (/^\d+(\.\d+)?$/.test(b)) lastDate = iso(b);
  rows.push({
    fecha: lastDate, semana: week,
    actividad: act, objetivo: clean(r[3]), empresa: emp, formato: clean(r[5]),
    escenario: clean(r[6]), copyIn: clean(r[7]), copyOut: clean(r[8]),
    correcciones: clean(r[9]), link: clean(r[10]),
    estadoDiseno: clean(r[11]) || statusFromStyle(srow[11])
  });
}

var out = { updatedAt: new Date().toISOString(), source: 'SharePoint · ' + path.basename(SRC), sheet: target.name, rows: rows };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
var byStatus = rows.reduce(function (a, r) { var k = r.estadoDiseno || '(sin estado)'; a[k] = (a[k] || 0) + 1; return a; }, {});
console.log('OK · ' + rows.length + ' piezas · hoja "' + target.name + '" · estados: ' + JSON.stringify(byStatus));
console.log('semanas: ' + [].concat.apply([], [Array.from(new Set(rows.map(function (r) { return r.semana; })))]).join(' | '));
