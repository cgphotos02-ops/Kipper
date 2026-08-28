// Convierte un informe de campañas de Meta (.xlsx o .csv/.tsv) a data/pautas.json
// Uso: node gen-pautas.js <archivo-informe> [ruta-salida]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC = process.argv[2];
const OUT = process.argv[3] || path.join(process.cwd(), 'data', 'pautas.json');
if (!SRC || !fs.existsSync(SRC)) { console.error('Falta el archivo de entrada o no existe:', SRC); process.exit(1); }

function num(v) {
  if (v == null) return 0;
  v = String(v).trim().replace(/\s/g, '').replace(/\$/g, '').replace(/COP/gi, '').replace(/%/g, '');
  if (v === '' || v === '-' || v === '—' || /^n\/?a$/i.test(v)) return 0;
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(v)) v = v.replace(/,/g, '');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
  else if (/^-?\d{1,3}(,\d{3})+$/.test(v)) v = v.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(v)) v = v.replace(',', '.');
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}
function brand(name) {
  const n = (name || '').toUpperCase();
  if (n.indexOf('PROVISER') > -1) return 'Proviser Seguridad';
  if (n.indexOf('NASS') > -1) return 'Nass Tecnología';
  return '—';
}
function status(s) {
  s = (s || '').toLowerCase();
  if (s.indexOf('not_deliv') > -1 || s.indexOf('no se est') > -1 || s.indexOf('no entrega') > -1) return { k: 'nodeliv', label: 'No entrega', cls: 'warn' };
  if (s.indexOf('activ') > -1) return { k: 'active', label: 'Activa', cls: 'good' };
  if (s.indexOf('paus') > -1) return { k: 'paused', label: 'Pausada', cls: 'warn' };
  if (s.indexOf('complet') > -1 || s.indexOf('finaliz') > -1) return { k: 'done', label: 'Finalizada', cls: 'off' };
  if (s.indexOf('archiv') > -1) return { k: 'archived', label: 'Archivada', cls: 'off' };
  return { k: 'other', label: s || '—', cls: 'off' };
}

function readGrid(file) {
  if (/\.xlsx$/i.test(file)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
    execSync('unzip -o "' + file + '" -d "' + tmp + '"', { stdio: 'ignore' });
    let strs = [];
    const ssp = path.join(tmp, 'xl', 'sharedStrings.xml');
    if (fs.existsSync(ssp)) {
      const ss = fs.readFileSync(ssp, 'utf8');
      let m; const reSi = /<si>([\s\S]*?)<\/si>/g;
      while ((m = reSi.exec(ss))) {
        const parts = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        strs.push(parts.map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
      }
    }
    const wdir = path.join(tmp, 'xl', 'worksheets');
    const shPath = fs.readdirSync(wdir).filter(function (f) { return /^sheet\d+\.xml$/.test(f); }).sort()[0];
    const sh = fs.readFileSync(path.join(wdir, shPath), 'utf8');
    const rowsX = sh.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
    const ci = function (r) { let s = r.replace(/[0-9]+/g, ''), n = 0; for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
    return rowsX.map(function (rx) {
      const a = []; let cm;
      const reC = /<c r="([A-Z]+\d+)"(?:[^>]*?t="([^"]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>)?<\/c>/g;
      while ((cm = reC.exec(rx))) {
        const k = ci(cm[1]);
        a[k] = cm[2] === 's' ? (strs[+cm[3]] || '') : (cm[3] != null ? cm[3] : (cm[4] != null ? cm[4] : ''));
      }
      return a;
    });
  }
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
  const tab = lines[0].indexOf('\t') > -1;
  function splitCsv(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
    }
    out.push(cur); return out;
  }
  return lines.map(function (l) { return tab ? l.split('\t') : splitCsv(l); });
}

const grid = readGrid(SRC);
if (grid.length < 2) { console.error('El informe no tiene filas de datos'); process.exit(1); }
const headers = grid[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
function findH() {
  const cands = Array.prototype.slice.call(arguments);
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < headers.length; i++)
      for (let j = 0; j < cands.length; j++) {
        const h = headers[i], c = cands[j];
        if (pass === 0 && h === c) return i;
        if (pass === 1 && h.indexOf(c) === 0) return i;
        if (pass === 2 && h.indexOf(c) > -1) return i;
      }
  return -1;
}
const C = {
  name: findH('nombre de la campaña', 'campaign name'),
  status: findH('entrega de la campaña', 'delivery', 'entrega'),
  start: findH('inicio'), end: findH('finalización', 'finalizacion', 'ends'),
  reach: findH('alcance', 'reach'), freq: findH('frecuencia', 'frequency'), impr: findH('impresiones', 'impressions'),
  results: findH('resultados', 'results'), resInd: findH('indicador de resultado', 'result indicator'),
  cpr: findH('costo por resultados', 'costo por resultado', 'cost per result'),
  budget: findH('presupuesto del conjunto de anuncios', 'ad set budget'),
  budgetType: findH('tipo de presupuesto del conjunto de anuncios', 'ad set budget type'),
  spend: findH('importe gastado', 'amount spent'),
  cpm: findH('cpm (costo por mil', 'cpm'),
  linkClicks: findH('clics en el enlace', 'link clicks'),
  cpcLink: findH('cpc (costo por clic en el enlace', 'cpc (cost per link click'),
  ctrLink: findH('ctr (porcentaje de clics en el enlace', 'ctr (link click-through rate'),
  igVisits: findH('visitas al perfil de instagram'), igFollows: findH('seguimientos de instagram'),
  interactions: findH('interacciones', 'post engagements'),
  repStart: findH('inicio del informe', 'reporting starts'), repEnd: findH('fin del informe', 'reporting ends')
};
if (C.name < 0) { console.error('No encontré la columna "Nombre de la campaña"'); process.exit(1); }

let period = null;
const rows = [];
for (let r = 1; r < grid.length; r++) {
  const cells = grid[r];
  const g = function (i) { return (i >= 0 && i < cells.length ? String(cells[i]).trim() : ''); };
  const name = g(C.name);
  if (!name) continue;
  if (!period && (g(C.repStart) || g(C.repEnd))) period = { start: g(C.repStart), end: g(C.repEnd) };
  rows.push({
    name: name, brand: brand(name), status: status(g(C.status)), statusRaw: g(C.status),
    start: g(C.start), end: g(C.end),
    reach: num(g(C.reach)), freq: num(g(C.freq)), impr: num(g(C.impr)),
    results: num(g(C.results)), resInd: g(C.resInd), cpr: num(g(C.cpr)),
    budget: num(g(C.budget)), budgetType: g(C.budgetType), spend: num(g(C.spend)),
    cpm: num(g(C.cpm)), linkClicks: num(g(C.linkClicks)), cpcLink: num(g(C.cpcLink)), ctrLink: num(g(C.ctrLink)),
    igVisits: num(g(C.igVisits)), igFollows: num(g(C.igFollows)), interactions: num(g(C.interactions))
  });
}
const outObj = { updatedAt: new Date().toISOString(), source: path.basename(SRC), period: period, rows: rows };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(outObj, null, 2) + '\n');
console.log('OK - ' + rows.length + ' campanas - periodo ' + (period ? period.start + ' a ' + period.end : '?') + ' -> ' + OUT);
