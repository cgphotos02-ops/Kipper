// Jala los leads de Kommo (CRM) y deja un resumen por marca y mes en data/kommo.json.
// Se ejecuta desde GitHub Actions (.github/workflows/refresh-kommo.yml).
// Secretos del repo necesarios:
//   KOMMO_SUBDOMAIN  -> lo que va antes de ".kommo.com" (ej: "kipperholding")
//   KOMMO_TOKEN      -> token de larga duración (Kommo → Ajustes → Integraciones → tu integración privada → Claves y alcances)
//
// IMPORTANTE: el archivo de salida es público (GitHub Pages), así que SOLO guarda conteos y totales.
// Nunca se escriben nombres, teléfonos ni correos de clientes.
//
// Sin secretos configurados, el script no falla: deja data/kommo.json como "sin-conectar".

const fs = require('fs');
const path = require('path');

const SUBDOMAIN = (process.env.KOMMO_SUBDOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\.kommo\.com.*$/, '');
const TOKEN = (process.env.KOMMO_TOKEN || '').trim();
const OUT = path.join(__dirname, '..', 'data', 'kommo.json');

// ---- Cómo saber de qué marca es cada lead ----
// Se evalúa en este orden: nombre del embudo, etiquetas del lead, campo personalizado "Marca".
// Ajusta las expresiones si en Kommo usas otros nombres.
// En Kommo la marca se marca con la etiqueta (o la opción de un campo) "Seguridad física" (Proviser) o "Seguridad electrónica" (Nass).
const MARCAS = {
  proviser: /proviser|seguridad\s+f[ií]sica/i,
  nass: /nass|seguridad\s+electr[oó]nica/i
};
// Si el lead no trae la etiqueta de marca, se deduce leyendo su nombre, etiquetas y notas/mensajes guardados en Kommo.
// El texto solo se usa en memoria para decidir la marca: NUNCA se imprime ni se guarda en el repo (que es público).
// Se normaliza sin tildes y en minúsculas. Ajusta las palabras según lo que escriben tus clientes.
const PALABRAS_NASS = /\b(camaras?|cctv|alarmas?|sensor(es)?|control de acceso|biometric\w*|huella|citofon\w*|videoportero|cerc[ao]s? electric\w*|domotic\w*|automatizacion|monitoreo|dvr|nvr|wifi|cerradur\w*|boton de panico|sirena|videovigilancia|seguridad electronica|kit basico|instalacion de camaras)\b/g;
const PALABRAS_PROVISER = /\b(vigilantes?|vigilancia|guardas?|guardia|escolta\w*|porteria|portero|seguridad privada|seguridad fisica|supervisor\w*|puesto de vigilancia|rondas?|ronderos?|canin\w*|servicio de seguridad|empresa de seguridad)\b/g;
function sinTildes(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function marcaPorTexto(texto) {
  var t = sinTildes(texto);
  var n = new Set(t.match(PALABRAS_NASS) || []).size;
  var p = new Set(t.match(PALABRAS_PROVISER) || []).size;
  if (n > p) return 'nass';
  if (p > n) return 'proviser';
  return null;   // sin señales, o empate: queda "sin marca"
}
// Etiquetas de conversaciones que NO son clientes (compañeros de trabajo que escriben al mismo WhatsApp). No se cuentan.
const EXCLUIR_ETIQUETAS = /colaborador|interno|compa[nñ]ero|empleado|vacante/i;
// Un lead solo cuenta como "real" si el bot lo etiquetó con alguna de estas respuestas del cuestionario
// (así los chats de compañeros u otros contactos que nunca respondieron al bot no inflan las cifras).
const ETIQUETAS_LEAD_REAL = /hogar|comercio|oficina|empresas|conjunto residencial|visita t[eé]cnica|hablar con asesor|otro|potencial|seguridad\s+f[ií]sica|seguridad\s+electr[oó]nica|proviser|nass/i;
// Embudos que no son de ventas y no se cuentan (selección de personal).
const EXCLUIR_EMBUDOS = /gesti[oó]n\s+humana/i;
// Campos personalizados donde suele estar el origen del lead (si no hay, se usan las etiquetas).
const ORIGEN_FIELD_NAMES = /^(origen|fuente|canal|utm_source|source)$/i;

const STALE_DAYS = 7;               // un lead abierto sin movimiento hace más de esto cuenta como "sin gestión reciente"
const TZ_OFFSET_HOURS = -5;         // Colombia (UTC-5, sin horario de verano)
const STATUS_WON = 142, STATUS_LOST = 143;   // ids fijos de Kommo: "Éxito" y "Cerrado, no realizado"

function writeOut(obj) { fs.writeFileSync(OUT, JSON.stringify(obj, null, 2) + '\n'); }

if (!SUBDOMAIN || !TOKEN) {
  console.log('Kommo sin conectar: faltan los secretos KOMMO_SUBDOMAIN y/o KOMMO_TOKEN. No se cambia nada.');
  if (!fs.existsSync(OUT)) writeOut({ generatedAt: null, source: 'sin-conectar', accounts: {} });
  process.exit(0);
}

const BASE = process.env.KOMMO_BASE_URL || ('https://' + SUBDOMAIN + '.kommo.com/api/v4');   // KOMMO_BASE_URL solo para pruebas locales
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function api(pathAndQuery) {
  for (var attempt = 0; attempt < 4; attempt++) {
    var res = await fetch(BASE + pathAndQuery, { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' } });
    if (res.status === 204) return null;
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    if (res.status === 401) throw new Error('Kommo respondió 401: el token venció o es incorrecto.');
    if (!res.ok) throw new Error('Kommo respondió ' + res.status + ' en ' + pathAndQuery.split('?')[0]);
    return res.json();
  }
  throw new Error('Kommo no respondió tras varios intentos: ' + pathAndQuery.split('?')[0]);
}

async function fetchAll(endpoint, embeddedKey, extraQuery) {
  var items = [], page = 1;
  for (;;) {
    var data = await api(endpoint + '?limit=250&page=' + page + (extraQuery ? '&' + extraQuery : ''));
    var chunk = data && data._embedded && data._embedded[embeddedKey];
    if (!chunk || !chunk.length) break;
    items = items.concat(chunk);
    if (chunk.length < 250) break;
    page++;
    await sleep(160);   // Kommo permite ~7 pedidos por segundo
  }
  return items;
}

function monthKey(unixSeconds) {
  var d = new Date((unixSeconds + TZ_OFFSET_HOURS * 3600) * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : null; }

(async function main() {
  console.log('Conectando con ' + SUBDOMAIN + '.kommo.com …');
  var pipelines = await fetchAll('/leads/pipelines', 'pipelines');
  var users = await fetchAll('/users', 'users');
  var leads = await fetchAll('/leads', 'leads', 'with=loss_reason,source_id,contacts');
  // Contactos: Kommo también etiqueta (y guarda respuestas del bot) en el CONTACTO, no solo en el lead.
  // Solo se usa en memoria: etiquetas y el campo "Tipo de servicio". Nada de nombres ni teléfonos.
  var contactoInfo = {}, contactosError = null, contactoTags = {};
  try {
    (await fetchAll('/contacts', 'contacts')).forEach(function (c) {
      var tg = ((c._embedded && c._embedded.tags) || []).map(function (t) { return t.name; });
      tg.forEach(function (n) { contactoTags[n] = (contactoTags[n] || 0) + 1; });
      var extra = (c.custom_fields_values || []).filter(function (f) { return /servicio|necesita|tipo de solicitud/i.test(f.field_name || ''); })
        .map(function (f) { return (f.values || []).map(function (v) { return String(v.value == null ? '' : v.value); }).join(' '); }).join(' ');
      contactoInfo[c.id] = { tags: tg.join(' '), extra: extra };
    });
  } catch (e) { contactosError = e.message; }
  function contactoDe(lead) {
    var ids = ((lead._embedded && lead._embedded.contacts) || []).map(function (c) { return c.id; });
    var tags = [], extra = [];
    ids.forEach(function (id) { var ci = contactoInfo[id]; if (ci) { tags.push(ci.tags); extra.push(ci.extra); } });
    return { tags: tags.join(' '), extra: extra.join(' ') };
  }
  // Fuentes (canales conectados: número de WhatsApp, cuenta de Instagram, etc.). Si la cuenta no las expone, se sigue sin ellas.
  var fuenteNombre = {}, fuentesError = null, fuentesDetalle = [];
  try {
    var mask = function (x) { return String(x == null ? '' : x).replace(/\d{7,}/g, function (d) { return '…' + d.slice(-4); }); };
    var fuentesRaw = await fetchAll('/sources', 'sources');
    fuentesDetalle = fuentesRaw.map(function (s) {
      var pages = [];
      (s.services || []).forEach(function (sv) { (sv.pages || []).forEach(function (pg) { pages.push(mask(pg.name || pg.id)); }); });
      return { id: s.id, name: mask(s.name), origin: s.origin_code || null, pages: pages.slice(0, 5) };
    });
    fuentesRaw.forEach(function (s) { fuenteNombre[s.id] = mask(s.name || s.external_id || s.id); });
  } catch (e) { fuentesError = e.message; }
  console.log('Embudos: ' + pipelines.length + ' · usuarios: ' + users.length + ' · leads: ' + leads.length);

  var userName = {};
  users.forEach(function (u) { userName[u.id] = u.name; });
  var pipelineName = {}, statusInfo = {};   // statusInfo[status_id] = { name, pipeline, sort }
  pipelines.forEach(function (p) {
    pipelineName[p.id] = p.name;
    ((p._embedded && p._embedded.statuses) || []).forEach(function (s) {
      statusInfo[s.id] = { name: s.name, pipeline: p.name, sort: s.sort, type: s.type };
    });
  });

  // Notas y mensajes guardados por lead (solo en memoria). Si la cuenta no deja leerlos, se sigue sin ellos.
  var textoPorLead = {}, clasif = { porTexto: 0 };
  var notasInfo = { tipos: {}, leadsConNotas: 0, leadsConTexto: 0, error: null };
  try {
    var notas = await fetchAll('/leads/notes', 'notes');
    notas.forEach(function (n) {
      notasInfo.tipos[n.note_type] = (notasInfo.tipos[n.note_type] || 0) + 1;
      var p = n.params || {};
      var txt = [p.text, p.html, p.service, p.message && p.message.text].filter(function (x) { return typeof x === 'string' && x; }).join(' ');
      if (!textoPorLead[n.entity_id]) textoPorLead[n.entity_id] = [];
      textoPorLead[n.entity_id].push(txt.slice(0, 1500));
    });
    notasInfo.leadsConNotas = Object.keys(textoPorLead).length;
    notasInfo.leadsConTexto = Object.keys(textoPorLead).filter(function (id) { return textoPorLead[id].join('').trim().length > 0; }).length;
  } catch (e) { notasInfo.error = e.message; }
  console.log('Notas leídas: ' + Object.keys(notasInfo.tipos).reduce(function (s, k) { return s + notasInfo.tipos[k]; }, 0) + ' · leads con notas: ' + notasInfo.leadsConNotas + (notasInfo.error ? ' · aviso: ' + notasInfo.error : ''));

  function marcaDe(lead) {
    var k, hay;
    hay = pipelineName[lead.pipeline_id] || '';
    for (k in MARCAS) if (MARCAS[k].test(hay)) return k;
    var ctc = contactoDe(lead);
    var tagsTxt = ((lead._embedded && lead._embedded.tags) || []).map(function (t) { return t.name; }).join(' ') + ' ' + ctc.tags;
    hay = tagsTxt;
    for (k in MARCAS) if (MARCAS[k].test(hay)) return k;
    // cualquier campo personalizado del lead cuya opción diga la marca
    hay = (lead.custom_fields_values || []).map(function (f) {
      return (f.values || []).map(function (v) { return String(v.value == null ? '' : v.value); }).join(' ');
    }).join(' ');
    for (k in MARCAS) if (MARCAS[k].test(hay)) return k;
    // sin etiqueta: se deduce por el contenido (nombre del lead + etiquetas + notas/mensajes)
    var m = marcaPorTexto([lead.name, tagsTxt, hay, ctc.extra].concat(textoPorLead[lead.id] || []).join(' \n '));
    if (m) { clasif.porTexto++; return m; }
    return null;
  }
  function origenDe(lead) {
    var cf = (lead.custom_fields_values || []).filter(function (f) { return ORIGEN_FIELD_NAMES.test(f.field_name || ''); })[0];
    if (cf && cf.values && cf.values[0] && cf.values[0].value) return String(cf.values[0].value).trim();
    var tags = ((lead._embedded && lead._embedded.tags) || []).map(function (t) { return t.name; })
      .filter(function (n) { return !Object.keys(MARCAS).some(function (k) { return MARCAS[k].test(n); }); });
    return tags.length ? tags[0] : 'Sin origen';
  }

  var nowSec = Math.floor(Date.now() / 1000);
  var accounts = {};
  var sinMarca = 0;
  ['todas'].concat(Object.keys(MARCAS)).forEach(function (k) { accounts[k] = { months: {}, open: null }; });

  function newBucket() {
    return { total: 0, won: 0, lost: 0, open: 0, sales: 0, daysToWinSum: 0, daysToWinN: 0, stale: 0,
      byOwner: {}, byOrigin: {}, lostReasons: {}, byStage: {} };
  }
  function bump(obj, key, field) { var o = obj[key] || (obj[key] = { total: 0, won: 0, lost: 0, open: 0, sales: 0 }); o.total++; o[field]++; return o; }

  var openByBrand = {};
  ['todas'].concat(Object.keys(MARCAS)).forEach(function (k) { openByBrand[k] = newBucket(); });

  var excluidos = 0;
  var excluidosInternos = 0, noCalificados = 0;
  leads = leads.filter(function (l) {
    if (EXCLUIR_EMBUDOS.test(pipelineName[l.pipeline_id] || '')) { excluidos++; return false; }
    var ct = contactoDe(l);
    var tg = ((l._embedded && l._embedded.tags) || []).map(function (t) { return t.name; }).join(' ') + ' ' + ct.tags + (ct.extra ? ' hablar con asesor' : '');   // quien contestó el bot (tiene tipo de servicio) cuenta como real
    if (EXCLUIR_ETIQUETAS.test(tg)) { excluidosInternos++; return false; }
    // solo cuenta como lead real si pasó por el bot (tiene alguna etiqueta del cuestionario o de marca)
    if (!ETIQUETAS_LEAD_REAL.test(tg)) { noCalificados++; return false; }
    return true;
  });
  console.log('Leads reales: ' + leads.length + ' (excluidos por embudo: ' + excluidos + ' · internos/colaboradores: ' + excluidosInternos + ' · sin pasar por el bot: ' + noCalificados + ')');
  function contar(dest, lead) {
    var acc = accounts[dest];
    var mk = monthKey(lead.created_at);
    var b = acc.months[mk] || (acc.months[mk] = newBucket());
    var estado = lead.status_id === STATUS_WON ? 'won' : (lead.status_id === STATUS_LOST ? 'lost' : 'open');
    var owner = userName[lead.responsible_user_id] || 'Sin asignar';
    var origen = origenDe(lead);

    b.total++; b[estado]++;
    bump(b.byOwner, owner, estado);
    bump(b.byOrigin, origen, estado);
    if (estado === 'won') {
      var price = +lead.price || 0;
      b.sales += price; b.byOwner[owner].sales += price; b.byOrigin[origen].sales += price;
      if (lead.closed_at) { b.daysToWinSum += Math.max(0, (lead.closed_at - lead.created_at) / 86400); b.daysToWinN++; }
    }
    if (estado === 'lost') {
      var lr = (lead._embedded && lead._embedded.loss_reason && lead._embedded.loss_reason[0]) ? lead._embedded.loss_reason[0].name : 'Sin motivo registrado';
      b.lostReasons[lr] = (b.lostReasons[lr] || 0) + 1;
    }
    if (estado === 'open') {
      var st = statusInfo[lead.status_id] || { name: 'Etapa ' + lead.status_id, pipeline: '', sort: 0 };
      var stale = (nowSec - (lead.updated_at || lead.created_at)) / 86400 > STALE_DAYS;
      b.byStage[st.name] = b.byStage[st.name] || { count: 0, stale: 0, pipeline: st.pipeline, sort: st.sort };
      b.byStage[st.name].count++;
      if (stale) { b.stale++; b.byStage[st.name].stale++; }
      // foto del embudo HOY (todos los leads abiertos, sin importar en qué mes se crearon)
      var o = openByBrand[dest];
      o.open++; if (stale) o.stale++;
      o.byStage[st.name] = o.byStage[st.name] || { count: 0, stale: 0, pipeline: st.pipeline, sort: st.sort };
      o.byStage[st.name].count++; if (stale) o.byStage[st.name].stale++;
      o.byOwner[owner] = o.byOwner[owner] || { open: 0, stale: 0 };
      o.byOwner[owner].open++; if (stale) o.byOwner[owner].stale++;
    }
  }
  leads.forEach(function (lead) {
    contar('todas', lead);               // vista "todos los leads reales", con o sin marca
    var marca = marcaDe(lead);
    if (!marca) { sinMarca++; return; }
    contar(marca, lead);
  });

  function finish(b) {
    var out = {
      total: b.total, won: b.won, lost: b.lost, open: b.open, stale: b.stale,
      winRate: pct(b.won, b.total), lossRate: pct(b.lost, b.total),
      closedWinRate: pct(b.won, b.won + b.lost),
      sales: Math.round(b.sales),
      avgDaysToWin: b.daysToWinN ? Math.round((b.daysToWinSum / b.daysToWinN) * 10) / 10 : null
    };
    function rank(map) {
      return Object.keys(map).map(function (k) { var v = map[k]; v.name = k; return v; })
        .sort(function (a, c) { return c.total - a.total; });
    }
    out.byOwner = rank(b.byOwner);
    out.byOrigin = rank(b.byOrigin);
    out.lostReasons = Object.keys(b.lostReasons).map(function (k) { return { name: k, count: b.lostReasons[k] }; })
      .sort(function (a, c) { return c.count - a.count; });
    out.byStage = Object.keys(b.byStage).map(function (k) { var v = b.byStage[k]; return { name: k, pipeline: v.pipeline, sort: v.sort, count: v.count, stale: v.stale }; })
      .sort(function (a, c) { return (a.pipeline || '').localeCompare(c.pipeline || '') || a.sort - c.sort; });
    return out;
  }

  Object.keys(accounts).forEach(function (marca) {
    var acc = accounts[marca], months = {};
    Object.keys(acc.months).sort().forEach(function (mk) { months[mk] = finish(acc.months[mk]); });
    var o = openByBrand[marca];
    acc.months = months;
    acc.open = {
      open: o.open, stale: o.stale,
      byStage: Object.keys(o.byStage).map(function (k) { var v = o.byStage[k]; return { name: k, pipeline: v.pipeline, sort: v.sort, count: v.count, stale: v.stale }; })
        .sort(function (a, c) { return (a.pipeline || '').localeCompare(c.pipeline || '') || a.sort - c.sort; }),
      byOwner: Object.keys(o.byOwner).map(function (k) { return { name: k, open: o.byOwner[k].open, stale: o.byOwner[k].stale }; })
        .sort(function (a, c) { return c.open - a.open; })
    };
    console.log(marca + ': ' + Object.keys(months).map(function (m) { return m + '=' + months[m].total; }).join(' · '));
  });
  if (sinMarca) console.log('⚠ ' + sinMarca + ' leads no se pudieron asignar a Proviser ni a Nass (revisa MARCAS en scripts/refresh-kommo.js).');

  // ---- Diagnóstico temporal: ayuda a decidir cómo separar las marcas (solo conteos, sin datos personales) ----
  var diag = { porEmbudo: {}, etiquetas: {}, campos: {}, estados: {} };
  var camposValores = {};
  leads.forEach(function (lead) {
    var pn = pipelineName[lead.pipeline_id] || String(lead.pipeline_id);
    diag.porEmbudo[pn] = (diag.porEmbudo[pn] || 0) + 1;
    ((lead._embedded && lead._embedded.tags) || []).forEach(function (t) { diag.etiquetas[t.name] = (diag.etiquetas[t.name] || 0) + 1; });
    (lead.custom_fields_values || []).forEach(function (f) {
      var n = f.field_name || String(f.field_id);
      diag.campos[n] = (diag.campos[n] || 0) + 1;
      camposValores[n] = camposValores[n] || {};
      (f.values || []).forEach(function (v) { var x = String(v.value == null ? '' : v.value).slice(0, 40); camposValores[n][x] = (camposValores[n][x] || 0) + 1; });
    });
  });
  // solo se muestran valores de campos con pocas opciones distintas y que no parezcan teléfono/correo/nombre
  var camposOpciones = {};
  Object.keys(camposValores).forEach(function (n) {
    var vals = Object.keys(camposValores[n]);
    if (vals.length <= 15 && !/tel|cel|mail|correo|nombre|name|phone|c[eé]dula|nit|direcci/i.test(n)) camposOpciones[n] = camposValores[n];
  });
  diag.camposOpciones = camposOpciones;
  diag.notas = notasInfo;
  diag.etiquetasContacto = Object.keys(contactoTags).map(function (k) { return [k, contactoTags[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 40);
  diag.contactosError = contactosError;
  diag.contactosLeidos = Object.keys(contactoInfo).length;
  var porFuente = {};
  leads.forEach(function (l) { var n = l.source_id ? (fuenteNombre[l.source_id] || ('fuente ' + l.source_id)) : '(sin fuente)'; porFuente[n] = (porFuente[n] || 0) + 1; });
  diag.fuentes = Object.keys(porFuente).map(function (k) { return [k, porFuente[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 25);
  diag.fuentesError = fuentesError;
  try {
    var talks = await fetchAll('/talks', 'talks');
    var porOrigen = {};
    talks.forEach(function (t) { var o = t.origin || '(sin origen)'; porOrigen[o] = (porOrigen[o] || 0) + 1; });
    diag.conversaciones = { total: talks.length, porOrigen: porOrigen };
    // por canal (source_id) de cada lead, qué tipo de conversación tiene
    var talkOrigenPorLead = {};
    talks.forEach(function (t) { if (t.entity_type === 'lead' || t.entity_id) { (talkOrigenPorLead[t.entity_id] = talkOrigenPorLead[t.entity_id] || {})[t.origin || '?'] = true; } });
    var porFuenteOrigen = {};
    leads.forEach(function (l) {
      var f = String(l.source_id || 'sin fuente');
      var os = Object.keys(talkOrigenPorLead[l.id] || {});
      (porFuenteOrigen[f] = porFuenteOrigen[f] || {});
      (os.length ? os : ['sin conversación']).forEach(function (o) { porFuenteOrigen[f][o] = (porFuenteOrigen[f][o] || 0) + 1; });
    });
    diag.fuenteOrigen = porFuenteOrigen;
    diag.fuentesDetalle = fuentesDetalle;
  } catch (e) { diag.conversaciones = { error: e.message }; }
  diag.leadsClasificadosPorTexto = clasif.porTexto;
  diag.leadsConNombreUtil = leads.filter(function (l) { return marcaPorTexto(l.name) !== null; }).length;
  diag.etiquetas = Object.keys(diag.etiquetas).map(function (k) { return [k, diag.etiquetas[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 40);

  writeOut({
    diagnostico: diag,
    generatedAt: new Date().toISOString(),
    source: 'kommo',
    staleDays: STALE_DAYS,
    unassigned: sinMarca,
    descartados: { gestionHumana: excluidos, internos: excluidosInternos, sinPasarPorElBot: noCalificados },
    pipelines: pipelines.map(function (p) { return p.name; }),
    accounts: accounts
  });
  console.log('OK → data/kommo.json');
})().catch(function (e) { console.error('Error:', e.message); process.exit(1); });
