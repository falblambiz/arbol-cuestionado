/* =========================================================================
   Prueba de humo de la app, sin navegador.
   Ejecutar desde esta carpeta:   osascript -l JavaScript pruebas-smoke.js
   Simula un DOM mínimo, arranca la app y verifica el render y los botones.
   ========================================================================= */

ObjC.import('Foundation');
var RAIZ = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('PWD'));
var CONSOLA = function (t) { console.log(t); };

var SHIM = [
  'var eventos = {}, descargas = [], registro = {};',
  'function FakeEl(id) { this.id = id || ""; this.dataset = {}; this.style = {}; this.hidden = false; this.value = ""; this.checked = false;',
  '  this.textContent = ""; this.innerHTML = ""; this.clientWidth = 1000; this.clientHeight = 700; this.handlers = {};',
  '  this.classList = { toggle: function(){}, add: function(){}, remove: function(){}, contains: function(){ return false; } }; }',
  'FakeEl.prototype.addEventListener = function (t, fn) { this.handlers[t] = fn; var k = (this.id && this.id.indexOf(":") === -1) ? "#" + this.id : this.id; eventos[(k || "?") + ":" + t] = fn; };',
  'FakeEl.prototype.setAttribute = function (k, v) { this[k] = v; };',
  'FakeEl.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 1000, height: 700 }; };',
  'FakeEl.prototype.focus = function () {}; FakeEl.prototype.select = function () {};',
  'FakeEl.prototype.click = function () { if (this.handlers.click) this.handlers.click({ target: this }); };',
  'FakeEl.prototype.setPointerCapture = function () {}; FakeEl.prototype.releasePointerCapture = function () {};',
  'FakeEl.prototype.closest = function () { return null; };',
  'FakeEl.prototype.appendChild = function (n) { return n; }; FakeEl.prototype.remove = function () {};',
  'FakeEl.prototype.removeChild = function () {};',
  'function getEl(id) { if (!registro[id]) { registro[id] = new FakeEl(id); } return registro[id]; }',
  'var TABS = ["ficha", "aporte", "datos"].map(function (n) { var e = new FakeEl("tab:" + n); e.dataset.tab = n; return e; });',
  'var PANELES = ["ficha", "aporte", "datos"].map(function (n) { return getEl("tab-" + n); });',
  'var QUICKS = ["padre", "madre", "hijo"].map(function (n) { var e = new FakeEl("quick:" + n); e.dataset.quick = n; return e; });',
  'var ctx = { strokeStyle: "", fillStyle: "", font: "", lineWidth: 1,',
  '  scale: function(){}, fillRect: function(){}, stroke: function(){}, fill: function(){}, save: function(){}, restore: function(){},',
  '  beginPath: function(){}, moveTo: function(){}, arcTo: function(){}, closePath: function(){}, arc: function(){}, lineTo: function(){},',
  '  setLineDash: function(){}, fillText: function(){},',
  '  measureText: function (t) { return { width: String(t).length * 7 }; } };',
  'var document = {',
  '  readyState: "complete", title: "", addEventListener: function () {},',
  '  body: getEl("body"),',
  '  querySelector: function (sel) {',
  '    if (sel.charAt(0) === "#") return getEl(sel.slice(1));',
  '    var m = sel.match(/^\\.tab\\[data-tab="([a-z]+)"\\]$/);',
  '    if (m) return TABS.filter(function (t) { return t.dataset.tab === m[1]; })[0];',
  '    return null;',
  '  },',
  '  querySelectorAll: function (sel) {',
  '    if (sel === ".tab") return TABS;',
  '    if (sel === ".tab-panel") return PANELES;',
  '    if (sel === "[data-quick]") return QUICKS;',
  '    return [];',
  '  },',
  '  createElement: function (tag) {',
  '    var e = new FakeEl("nuevo-" + tag);',
  '    if (tag === "canvas") { e.getContext = function () { return ctx; }; e.toDataURL = function () { return "data:image/png;base64,AAA"; }; }',
  '    if (tag === "a") { e.click = function () { descargas.push({ nombre: this.download, contenido: this.contenido }); }; }',
  '    return e;',
  '  }',
  '};',
  'function Blob(partes, opciones) { this.partes = partes; this.tipo = (opciones || {}).type; descargas.push({ nombre: "blob", contenido: String(partes) }); }',
  'var URL = { createObjectURL: function () { return "blob:x"; }, revokeObjectURL: function () {} };',
  'function Path2D(d) { this.d = d; }',
  'var localStorage = { store: {}, getItem: function (k) { return this.store[k] || null; }, setItem: function (k, v) { this.store[k] = v; }, removeItem: function (k) { delete this.store[k]; } };',
  'var location = { origin: "http://localhost:8000", pathname: "/index.html", hash: "", search: "" };',
  'var history = { replaceState: function (a, b, c) { location.hash = ""; } };',
  'var navigator = { clipboard: { writeText: function (t) { ultimoCopiado = t; return { then: function (ok) { if (ok) ok(); return { catch: function () {} }; } }; } } };',
  'var ultimoCopiado = "";',
  'function Thenable(valor) { this.valor = valor; }',
  'Thenable.prototype.then = function (fn) { var r = fn(this.valor); return (r instanceof Thenable) ? r : new Thenable(r); };',
  'Thenable.prototype.catch = function () { return this; };',
  'var crypto = { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 7 + 3) % 256; return a; },',
  '  subtle: {',
  '    importKey: function () { return new Thenable({ pass: arguments[1] }); },',
  '    deriveKey: function (alg, base) { return new Thenable({ salt: alg.salt, pass: base.pass }); },',
  '    encrypt: function (alg, clave, datos) { return new Thenable(new Uint8Array(datos)); },',
  '    decrypt: function (alg, clave, datos) { return new Thenable(new Uint8Array(datos)); }',
  '  } };',
  'var fetch = function () { return { then: function () { return this; }, catch: function (fn) { if (fn) { try { fn(new Error("stub sin red")); } catch (e) {} } return this; } }; };',
  'var setTimeout = function (fn) { if (typeof fn === "function") { try { fn(); } catch (e) {} } return 0; };',
  'var requestAnimationFrame = function (fn) { if (fn) fn(); };',
  'var console = { log: function () {}, warn: function () {}, error: function () {} };',
  'function TextEncoder() {}',
  'TextEncoder.prototype.encode = function (s) { var o = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i);',
  '  if (c < 128) o.push(c); else if (c < 2048) o.push(192 | (c >> 6), 128 | (c & 63)); else o.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return o; };',
  'function TextDecoder() {}',
  'TextDecoder.prototype.decode = function (b) { b = b || []; var s = "", i = 0;',
  '  while (i < b.length) { var x = b[i]; if (x < 128) { s += String.fromCharCode(x); i++; }',
  '    else if (x < 224) { s += String.fromCharCode(((x & 31) << 6) | (b[i + 1] & 63)); i += 2; }',
  '    else { s += String.fromCharCode(((x & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)); i += 3; } } return s; };',
  'var ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";',
  'var atob = function (s) { var out = "", buf = 0, bits = 0; for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); if (ch === "=") break; var k = ABC.indexOf(ch); if (k < 0) continue; buf = ((buf << 6) | k) & 16777215; bits += 6; if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); } } return out; };',
  'var btoa = function (s) { var out = "", i = 0; while (i < s.length) { var c1 = s.charCodeAt(i++), c2 = (i < s.length) ? s.charCodeAt(i++) : NaN, c3 = (i < s.length) ? s.charCodeAt(i++) : NaN;',
  '  out += ABC.charAt(c1 >> 2); out += ABC.charAt(((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4));',
  '  if (isNaN(c2)) { out += "=="; break; } out += ABC.charAt(((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6));',
  '  if (isNaN(c3)) { out += "="; break; } out += ABC.charAt(c3 & 63); } return out; };',
  'var confirm = function () { return false; };',
  'var prompt = function () { return ""; };',
  'var window = { addEventListener: function (t, fn) { eventos["window:" + t] = fn; } };'
].join('\n');

var src = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(RAIZ + '/app.js', $.NSUTF8StringEncoding, null));

var mundo = new Function(SHIM + '\n' + src + '\n' +
  'return { api: window.ARBOL_DEBUG, get: getEl, eventos: eventos, descargas: descargas, tab: function (n) { return TABS.filter(function (t) { return t.dataset.tab === n; })[0]; },' +
  ' setConfirm: function (f) { confirm = f; }, setPrompt: function (f) { prompt = f; }, copiado: function () { return ultimoCopiado; }, limpiarCopiado: function () { ultimoCopiado = ""; }, btoaSim: function (s) { return btoa(s); },' +
  ' setHash: function (h) { location.hash = h; }, limpiarHash: function () { location.hash = ""; }, habilitarCrypto: function (v) { if (!v) { crypto = undefined; } },' +
  ' storage: localStorage };')();

var el = mundo.get;
var eventos = mundo.eventos;
var fallos = 0, pruebas = 0;
function check(titulo, cond, extra) {
  pruebas++;
  if (!cond) fallos++;
  CONSOLA((cond ? 'OK   ' : 'FALLA ') + titulo + (extra != null && extra !== '' ? '  [' + extra + ']' : ''));
}
function disparar(clave, ev) {
  var fn = eventos[clave];
  if (!fn) { check('existe el manejador ' + clave, false); return; }
  try { fn(ev || { target: { closest: function () { return null; } }, clientX: 0, clientY: 0, pointerId: 1, preventDefault: function () {} }); }
  catch (e) { check('manejador ' + clave + ' sin excepción', false, e.message); }
}

CONSOLA('— Arranque con árbol vacío —');
check('estado inicial vacío', mundo.api.getState().personas.length === 0);
check('panel de vacío visible', el('vacio').hidden === false);
check('título en la cabecera', el('tituloApp').textContent.length > 0, el('tituloApp').textContent);
check('todos los botones tienen manejador', ['#btnDemo', '#btnNueva', '#btnZoomIn', '#btnZoomOut', '#btnFit', '#btnModo', '#btnGuardar', '#btnRaiz', '#btnBorrar', '#btnAddHijo', '#btnAddPareja', '#btnAporte', '#btnEnviar', '#btnLink', '#btnEnlaceDatos', '#btnExportJson', '#btnCsv', '#btnGedcom', '#btnPng', '#btnImportJson', '#btnGuardarCfg', '#btnCopiarCfg', '#btnDemoDatos', '#btnVaciar'].every(function (b) { return typeof eventos[b + ':click'] === 'function'; }));

CONSOLA('');
CONSOLA('— Añadir la primera persona (el cuestionado) —');
disparar('#btnNueva:click');
check('se crea el cuestionado', mundo.api.getState().personas.length === 1);
check('queda marcado como raíz', mundo.api.getState().meta.raizId === mundo.api.getState().personas[0].id);
check('se abre su ficha', el('fichaForm').hidden === false);
check('el campo de nombre trae su valor', el('fNombre').value === 'El cuestionado', el('fNombre').value);

CONSOLA('');
CONSOLA('— Datos de ejemplo: render del árbol —');
mundo.setConfirm(function () { return true; });   // aceptar reemplazar el árbol de prueba
disparar('#btnDemo:click');
var st = mundo.api.getState();
check('8 personas cargadas', st.personas.length === 8, String(st.personas.length));
var html = el('tarjetas').innerHTML;
function contarTarjetas(s) { return (String(s).match(/data-id="/g) || []).length; }
check('se pintan 8 tarjetas', contarTarjetas(html) === 8, String(contarTarjetas(html)));
check('la tarjeta raíz está marcada', html.indexOf('card certeza-alta raiz') !== -1);
check('aparece la etiqueta “El cuestionado”', html.indexOf('El cuestionado') !== -1);
check('aparecen etiquetas de padre y madre', html.indexOf('>Padre<') !== -1 && html.indexOf('>Madre<') !== -1);
check('aparecen etiquetas de hijo/hija', html.indexOf('>Hijo<') !== -1 && html.indexOf('>Hija<') !== -1);
var svg = el('aristas').innerHTML;
check('se dibujan las aristas (7)', (svg.match(/<path/g) || []).length === 7, String((svg.match(/<path/g) || []).length));
check('svg con dimensiones', Number(el('aristas').width) > 0 && Number(el('aristas').height) > 0);
check('estadística visible', el('stats').textContent.indexOf('8 personas') !== -1, el('stats').textContent);
check('lista de sugerencias con 8 nombres', (el('personasDatalist').innerHTML.match(/<option/g) || []).length === 8);
check('zoom aplicado al mundo', String(el('mundo').style.transform).indexOf('scale(') !== -1, el('mundo').style.transform);
check('no hay NaN en el layout', String(el('aristas').innerHTML).indexOf('NaN') === -1);

CONSOLA('');
CONSOLA('— Seleccionar una tarjeta y editar la ficha —');
var evCard = { target: { closest: function () { return { dataset: { id: st.meta.raizId } }; } }, clientX: 0, clientY: 0, pointerId: 1, preventDefault: function () {} };
disparar('#tarjetas:click', evCard);
check('ficha con el nombre correcto', el('fNombre').value === 'El Cuestionado', el('fNombre').value);
check('relación mostrada', el('fichaRel').textContent.indexOf('El cuestionado') === 0, el('fichaRel').textContent);
check('select de padre con opciones', (el('fPadre').innerHTML.match(/<option/g) || []).length === 8);
check('chips de hijos', el('listaHijos').innerHTML.indexOf('Hijo/a 1') !== -1);
check('chips de parejas', el('listaParejas').innerHTML.indexOf('Pareja') !== -1);
el('fNombre').value = 'Cuestionado Renombrado';
el('fAlias').value = 'El de la esquina';
el('fNac').value = '1972-03-04';
el('fNotas').value = 'Nota de prueba';
el('fFuentes').value = 'Expediente 12 | https://ejemplo.com/exp';
disparar('#btnGuardar:click');
var raiz = mundo.api.getState().personas.filter(function (p) { return p.id === st.meta.raizId; })[0];
check('nombre guardado', raiz.nombre === 'Cuestionado Renombrado', raiz.nombre);
check('alias guardado', raiz.alias === 'El de la esquina');
check('fuente estructurada', raiz.fuentes.length === 1 && raiz.fuentes[0].url === 'https://ejemplo.com/exp');
check('se guardó en localStorage', !!mundo.storage.store['arbol-genealogico/v1']);

CONSOLA('');
CONSOLA('— Añadir hijo y pareja desde la ficha —');
el('nuevoHijo').value = 'Hijo Añadido';
disparar('#btnAddHijo:click');
check('hijo enlazado', mundo.api.getState().personas.filter(function (p) { return p.nombre === 'Hijo Añadido'; })[0].padre === raiz.id);
el('nuevaPareja').value = 'Pareja Añadida';
disparar('#btnAddPareja:click');
check('pareja enlazada en ambos sentidos', (function () {
  var q = mundo.api.getState().personas.filter(function (p) { return p.nombre === 'Pareja Añadida'; })[0];
  return raiz.parejas.indexOf(q.id) !== -1 && q.parejas.indexOf(raiz.id) !== -1;
})());

CONSOLA('');
CONSOLA('— Captar datos de otros: modo aporte —');
disparar('#btnModo:click');
check('cambia el texto del botón', el('btnModo').textContent === 'Volver a edición', el('btnModo').textContent);
check('pestaña de aporte activa', el('tab-aporte').hidden === false);
disparar('quick:hijo:click', { target: QUICK_FAKE() });
function QUICK_FAKE() { return { closest: function () { return null; } }; }
el('aInformante').value = 'Informante de prueba';
el('aTipo').value = 'madre';
el('aSexo').value = 'F';
el('aNombre').value = 'Madre Aportada';
el('aRef').value = 'Cuestionado Renombrado';
el('aCerteza').value = 'alta';
el('aFuente').value = 'Dicho por la familia';
el('aAplicar').checked = true;
mundo.setConfirm(function () { return false; });   // rechaza reemplazar la madre existente
disparar('#btnAporte:click');
var ap1 = mundo.api.getState().aportes[0];
check('aporte registrado', !!ap1 && ap1.nombre === 'Madre Aportada');
check('conflicto detectado y no aplicado', ap1.conflicto.indexOf('ya había madre') !== -1 && ap1.aplicado === false, ap1.conflicto);
check('lista de aportes pintada', el('listaAportes').innerHTML.indexOf('Madre Aportada') !== -1);
check('contador de aportes coherente', el('numAportes').textContent === String(mundo.api.getState().aportes.length), el('numAportes').textContent);
check('la fuente quedó en el aporte', ap1.fuente === 'Dicho por la familia');
mundo.setConfirm(function () { return true; });    // ahora acepta
el('aNombre').value = 'Madre Aportada';            // la app limpia el campo tras guardar
el('aRef').value = 'Cuestionado Renombrado';
el('aAplicar').checked = true;
disparar('#btnAporte:click');
check('al aceptar se aplica al árbol', (function () {
  var ap = mundo.api.getState().aportes[0];
  var madre = mundo.api.getState().personas.filter(function (p) { return p.nombre === 'Madre Aportada'; })[0];
  return madre && raiz.madre === madre.id;
})());
check('certeza del aporte trasladada a la persona', mundo.api.getState().personas.filter(function (p) { return p.nombre === 'Madre Aportada'; })[0].certeza === 'alta');
check('pestaña datos intacta', el('tab-ficha').id === 'tab-ficha');

CONSOLA('');
CONSOLA('— Exportaciones —');
disparar('#btnExportJson:click');
disparar('#btnCsv:click');
disparar('#btnGedcom:click');
disparar('#btnPng:click');
var ged = mundo.descargas.filter(function (d) { return d.nombre === 'arbol-genealogico.ged'; }).length;
var csv = mundo.descargas.filter(function (d) { return d.nombre === 'arbol-genealogico.csv'; }).length;
var png = mundo.descargas.filter(function (d) { return d.nombre === 'arbol-genealogico.png'; }).length;
check('descarga JSON', mundo.descargas.some(function (d) { return d.nombre === 'arbol-genealogico.json'; }));
check('descarga CSV', csv === 1);
check('descarga GEDCOM', ged === 1);
check('descarga PNG', png === 1);
check('GEDCOM con cabecera y familia', (function () {
  var b = mundo.descargas.filter(function (d) { return String(d.contenido).indexOf('0 HEAD') === 0; })[0];
  return !!b && b.contenido.indexOf('INDI') !== -1 && b.contenido.indexOf('FAM') !== -1 && b.contenido.indexOf('0 TRLR') !== -1;
})());

CONSOLA('');
CONSOLA('— Enlace de aportes y fusión —');
el('aInformante').value = 'Otro informante';
mundo.setConfirm(function () { return false; });   // sin contraseña: enlace normal
disparar('#btnLink:click');
check('enlace de aportes copiado', mundo.copiado().indexOf('#aporte=') !== -1, mundo.copiado().slice(0, 60));
check('avisa de que va sin cifrar', el('bannerTexto').textContent.indexOf('SIN cifrar') !== -1, el('bannerTexto').textContent);
mundo.setConfirm(function () { return true; });    // con contraseña: enlace cifrado
mundo.setPrompt(function () { return 'mi-clave-secreta'; });
disparar('#btnLink:click');
check('enlace cifrado generado', mundo.copiado().indexOf('#aporte-c=') !== -1, mundo.copiado().slice(0, 60));
check('el enlace no expone los datos en claro', mundo.copiado().indexOf('Madre Aportada') === -1);
mundo.setPrompt(function () { return ''; });        // sin escribir contraseña no copia nada
mundo.limpiarCopiado();
disparar('#btnLink:click');
check('sin contraseña no se copia nada', mundo.copiado() === '' && el('bannerTexto').textContent.indexOf('No se copió nada') !== -1, el('bannerTexto').textContent);

CONSOLA('');
CONSOLA('— Enlace del árbol completo (modo privado) —');
mundo.setPrompt(function () { return 'clave-del-arbol'; });
disparar('#btnEnlaceDatos:click');
var enlaceDatos = mundo.copiado();
check('enlace del árbol cifrado', enlaceDatos.indexOf('#datos-c=') !== -1, enlaceDatos.slice(0, 60));
check('el enlace no lleva nombres legibles', enlaceDatos.indexOf('Cuestionado') === -1 && enlaceDatos.indexOf('Escobar') === -1);

CONSOLA('');
CONSOLA('— Abrir un enlace recibido —');
mundo.setHash(enlaceDatos.slice(enlaceDatos.indexOf('#')));
disparar('window:hashchange');
check('detecta el enlace cifrado', el('bannerTexto').textContent.indexOf('cifrado') !== -1, el('bannerTexto').textContent);
check('ofrece abrirlo', el('bannerAccion').hidden === false && el('bannerAccion').textContent.indexOf('cifrado') !== -1, el('bannerAccion').textContent);
disparar('#bannerAccion:click');    // con la contraseña ya puesta en setPrompt
check('se descifra y avisa del contenido', el('bannerTexto').textContent.indexOf('Árbol recibido') !== -1, el('bannerTexto').textContent);
disparar('#bannerAccion:click');    // fusionar
check('el árbol recibido se fusiona sin duplicar', (function () {
  var st = mundo.api.getState();
  return st.personas.filter(function (p) { return p.nombre === 'Cuestionado Renombrado'; }).length === 1;
})());

CONSOLA('');
CONSOLA('— Enlace normal (sin cifrar) —');
var claro = mundo.btoaSim(JSON.stringify({
  v: 1, tipo: 'aporte', informante: 'Colega', aportes: [{ id: 'a-externo', informante: 'Colega', tipo: 'hijo', refNombre: 'Cuestionado Renombrado', nombre: 'Hijo Externo', sexo: 'M', certeza: 'media', aplicado: false }]
})).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
mundo.setHash('#aporte=' + claro);
disparar('window:hashchange');
check('lee enlace normal', el('bannerTexto').textContent.indexOf('Aportes recibidos de Colega') !== -1, el('bannerTexto').textContent);
disparar('#bannerAccion:click');
check('importa el aporte externo', mundo.api.getState().aportes.some(function (a) { return a.id === 'a-externo'; }));

CONSOLA('');
CONSOLA('— Navegador sin WebCrypto (degradación controlada) —');
mundo.habilitarCrypto(false);
mundo.setConfirm(function () { return false; });
mundo.limpiarCopiado();
disparar('#btnEnlaceDatos:click');
check('sin WebCrypto avisa y copia enlace normal', mundo.copiado().indexOf('#datos=') !== -1 && el('bannerTexto').textContent.indexOf('SIN cifrar') !== -1, el('bannerTexto').textContent);
mundo.setHash('#datos-c=abcdefghijklmnopqrstuvwxyz0123456789');
disparar('window:hashchange');
check('sin WebCrypto explica que no puede descifrar', el('bannerTexto').textContent.indexOf('no puede descifrar') !== -1, el('bannerTexto').textContent);
var datos = mundo.api.getState();
var clon = JSON.parse(JSON.stringify({ meta: datos.meta, personas: datos.personas, aportes: datos.aportes }));
var fusion = mundo.api.normalizeState(clon);
check('JSON exportado es reimportable', fusion.personas.length === datos.personas.length);

CONSOLA('');
CONSOLA('— Vaciar y volver a cargar (persistencia) —');
mundo.setConfirm(function () { return true; });
disparar('#btnVaciar:click');
check('árbol vaciado', mundo.api.getState().personas.length === 0);
check('vuelve el panel de vacío', el('vacio').hidden === false);
disparar('#btnDemoDatos:click');
check('demo recargada', mundo.api.getState().personas.length === 8);

CONSOLA('');
CONSOLA('— Pulsar todos los botones sin excepciones —');
mundo.setConfirm(function () { return true; });
Object.keys(eventos).filter(function (k) { return k.indexOf(':click') !== -1; }).forEach(function (k) {
  try {
    eventos[k]({ target: { closest: function () { return null; } }, clientX: 10, clientY: 10, pointerId: 1, preventDefault: function () {} });
  } catch (e) {
    check('botón ' + k + ' sin excepción', false, e.message);
  }
});
check('recorrido completo de botones', true);
Object.keys(eventos).filter(function (k) { return k.indexOf('window:') === 0; }).forEach(function (k) {
  try { eventos[k]({ key: 'Escape', deltaY: 0 }); } catch (e) { check('evento ' + k + ' sin excepción', false, e.message); }
});
check('eventos globales (resize, keydown, hashchange) sin excepciones', true);

CONSOLA('');
CONSOLA('====================  ' + (pruebas - fallos) + '/' + pruebas + ' pruebas OK  ====================');
if (fallos) CONSOLA('⚠️  ' + fallos + ' fallo(s)');
