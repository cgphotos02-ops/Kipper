// Convierte la parrilla de contenidos (Excel, ProviserXNass.xlsx) en data/seguimiento.json.
// Uso:  node scripts/gen-seguimiento.js "ruta/ProviserXNass.xlsx"
// Recorre TODAS las hojas visibles (una por mes) y junta las piezas en un solo archivo.
// El avance (Grabado / Elaborado / Programado / Publicado) NO sale del Excel: se marca
// en el dashboard y se guarda en el navegador. Aquí solo salen la lista de piezas.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC = process.argv[2];
const OUT = path.join(__dirname, '..', 'data', 'seguimiento.json');
if (!SRC || !fs.existsSync(SRC)) { console.error('No encuentro el archivo:', SRC); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
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

// ---- hojas ----
var wb = rd('xl/workbook.xml');
var sheets = [];
(wb.match(/<sheet [^>]*\/>/g) || []).forEach(function (s) {
  sheets.push({
    name: (s.match(/name="([^"]*)"/) || [])[1],
    rid: (s.match(/r:id="([^"]*)"/) || [])[1],
    hidden: /state="(hidden|veryHidden)"/.test(s)
  });
});
var rels = rd('xl/_rels/workbook.xml.rels');
sheets.forEach(function (s) {
  var m = rels.match(new RegExp('Id="' + s.rid + '"[^>]*Target="([^"]*)"'));
  s.file = m ? ('xl/' + m[1].replace(/^\/?xl\//, '')) : null;
});

var colIdx = function (ref) { var s = ref.replace(/\d+/g, ''), n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; };
var iso = function (n) {
  n = +n; if (!isFinite(n) || n < 20000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
};
var clean = function (x) { return (x == null ? '' : String(x)).replace(/\s+\n/g, '\n').trim(); };

function parseSheet(file) {
  var sh = rd(file);
  var grid = [];
  (sh.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).forEach(function (rx) {
    var rn = +(rx.match(/<row r="(\d+)"/) || [])[1];
    var a = [], m;
    var re = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    while ((m = re.exec(rx))) {
      var k = colIdx(m[1]), attrs = m[2] || '', inner = m[3] || '';
      var ty = (attrs.match(/\st="([^"]+)"/) || [])[1];
      var v = '';
      var vm = inner.match(/<v>([\s\S]*?)<\/v>/);
      var im = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      if (vm) v = ty === 's' ? (strs[+vm[1]] || '') : vm[1];
      else if (im) v = im[1];
      a[k] = v;
    }
    grid[rn] = a;
  });

  var week = null, lastDate = null, out = [];
  for (var i = 1; i < grid.length; i++) {
    var r = grid[i] || [];
    var b = clean(r[1]);
    if (/^Semana del /i.test(b)) { week = b.replace(/\s+/g, ' '); lastDate = null; continue; }
    var act = clean(r[2]), emp = clean(r[4]);
    if (!act || /^Actividad\/Evento/i.test(act) || /^(LISTO|EN PROCESO|NO INICIADO)$/i.test(act)) continue;
    if (!/proviser|nass/i.test(emp)) continue;
    if (/^\d+(\.\d+)?$/.test(b)) lastDate = iso(b);
    out.push({
      fecha: lastDate,
      mes: lastDate ? lastDate.slice(0, 7) : null,
      semana: week,
      actividad: act,
      objetivo: clean(r[3]),
      empresa: emp,
      formato: clean(r[5])
    });
  }
  return out;
}

var rows = [];
sheets.filter(function (s) { return !s.hidden && s.file; }).forEach(function (s) {
  try {
    var got = parseSheet(s.file);
    got.forEach(function (g) { g.hoja = s.name; });
    rows = rows.concat(got);
    console.log('  hoja "' + s.name + '": ' + got.length + ' piezas');
  } catch (e) { console.log('  hoja "' + s.name + '": (saltada) ' + e.message); }
});

var out = {
  updatedAt: new Date().toISOString(),
  source: 'Excel · ' + path.basename(SRC),
  rows: rows
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

var byMes = rows.reduce(function (a, r) { var k = r.mes || '(sin fecha)'; a[k] = (a[k] || 0) + 1; return a; }, {});
var byMarca = rows.reduce(function (a, r) { var k = /nass/i.test(r.empresa) ? 'Nass' : 'Proviser'; a[k] = (a[k] || 0) + 1; return a; }, {});
console.log('OK · ' + rows.length + ' piezas → ' + path.relative(process.cwd(), OUT));
console.log('meses: ' + JSON.stringify(byMes) + ' · marcas: ' + JSON.stringify(byMarca));
