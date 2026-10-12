/* =========================================================================
   Árbol genealógico colaborativo — app estática, sin dependencias.
   Pensada para servirse tal cual desde GitHub Pages.
   ========================================================================= */
(function () {
  'use strict';

  /* --------------------------- constantes --------------------------- */
  var CARD_W = 208, CARD_H = 80, COL_GAP = 40, ROW_STEP = 200, PAD = 70;
  var LS_KEY = 'arbol-genealogico/v1';
  var CONF = Object.assign({
    titulo: 'Árbol genealógico',
    subtitulo: 'Padres e hijos del cuestionado',
    endpoint: '',
    repoUrl: ''
  }, (typeof window !== 'undefined' && window.ARBOL_CONFIG) || {});

  /* --------------------------- utilidades --------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function uid(prefix) { return (prefix || 'p') + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  }
  function yearOf(s) { var m = String(s || '').match(/\d{4}/); return m ? m[0] : ''; }
  function plural(n, singular, plurales) { return n + ' ' + (n === 1 ? singular : plurales); }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function b64enc(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64dec(s) {
    var t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }

  /* ---- cifrado real de enlaces (WebCrypto: PBKDF2 + AES-GCM) ---- */
  function bytesAB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlABytes(s) {
    var t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hayCrypto() {
    return typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.encrypt === 'function' &&
      typeof crypto.getRandomValues === 'function' && typeof TextEncoder !== 'undefined';
  }
  function derivarClave(pass, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 150000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function cifrarTexto(texto, pass) {
    if (!hayCrypto()) return Promise.reject(new Error('sin WebCrypto'));
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return derivarClave(pass, salt).then(function (clave) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, clave, new TextEncoder().encode(texto));
    }).then(function (buf) {
      var datos = new Uint8Array(buf);
      var todo = new Uint8Array(salt.length + iv.length + datos.length);
      todo.set(salt, 0); todo.set(iv, salt.length); todo.set(datos, salt.length + iv.length);
      return bytesAB64url(todo);
    });
  }
  function descifrarTexto(b64, pass) {
    if (!hayCrypto()) return Promise.reject(new Error('sin WebCrypto'));
    var todo = b64urlABytes(b64);
    if (todo.length < 29) return Promise.reject(new Error('enlace inválido'));
    var salt = todo.slice(0, 16), iv = todo.slice(16, 28), datos = todo.slice(28);
    return derivarClave(pass, salt).then(function (clave) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, clave, datos);
    }).then(function (buf) {
      return new TextDecoder().decode(new Uint8Array(buf));
    });
  }
  function descargar(nombre, contenido, tipo) {
    var blob = new Blob([contenido], { type: tipo || 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* --------------------------- estado --------------------------- */
  var state = { meta: {}, personas: [], aportes: [] };
  var CONF_DEF = { alta: 'alta', media: 'media', baja: 'baja' };

  function normalizeState(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var out = {
      meta: Object.assign({
        titulo: CONF.titulo, subtitulo: CONF.subtitulo, endpoint: CONF.endpoint,
        repoUrl: CONF.repoUrl, raizId: '', actualizado: ''
      }, raw.meta || {}),
      personas: [],
      aportes: Array.isArray(raw.aportes) ? raw.aportes : []
    };
    var ids = new Set();
    (Array.isArray(raw.personas) ? raw.personas : []).forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var id = String(p.id || uid());
      while (ids.has(id)) id = uid();
      ids.add(id);
      out.personas.push({
        id: id,
        nombre: String(p.nombre || 'Sin nombre'),
        alias: String(p.alias || ''),
        sexo: p.sexo === 'M' || p.sexo === 'F' || p.sexo === 'X' ? p.sexo : '',
        nac: String(p.nac || p.nacimiento || ''),
        fall: String(p.fall || p.fallecimiento || ''),
        lugar: String(p.lugar || ''),
        foto: String(p.foto || ''),
        notas: String(p.notas || ''),
        certeza: CONF_DEF[p.certeza] ? p.certeza : 'media',
        fuentes: (Array.isArray(p.fuentes) ? p.fuentes : []).map(function (f) {
          if (typeof f === 'string') return { texto: f, url: '' };
          return { texto: String((f && f.texto) || ''), url: String((f && f.url) || '') };
        }),
        padre: p.padre ? String(p.padre) : '',
        madre: p.madre ? String(p.madre) : '',
        parejas: Array.isArray(p.parejas) ? p.parejas.map(String) : []
      });
    });
    var valid = new Set(out.personas.map(function (p) { return p.id; }));
    out.personas.forEach(function (p) {
      if (p.padre && (!valid.has(p.padre) || p.padre === p.id)) p.padre = '';
      if (p.madre && (!valid.has(p.madre) || p.madre === p.id)) p.madre = '';
      p.parejas = p.parejas.filter(function (x) { return valid.has(x) && x !== p.id; });
    });
    out.personas.forEach(function (a) {
      a.parejas.forEach(function (bid) {
        var other = out.personas.filter(function (x) { return x.id === bid; })[0];
        if (other && other.parejas.indexOf(a.id) === -1) other.parejas.push(a.id);
      });
    });
    // evitar ciclos: una persona no puede ser ancestro de quien sería su progenitor
    out.personas.forEach(function (p) {
      if (p.padre && esAncestro(out, p.id, p.padre)) p.padre = '';
      if (p.madre && esAncestro(out, p.id, p.madre)) p.madre = '';
    });
    if (!valid.has(out.meta.raizId)) out.meta.raizId = out.personas.length ? out.personas[0].id : '';
    return out;
  }

  /* --------------------------- consultas --------------------------- */
  function byId(id) {
    for (var i = 0; i < state.personas.length; i++) if (state.personas[i].id === id) return state.personas[i];
    return null;
  }
  function childrenOf(id) {
    return state.personas.filter(function (p) { return p.padre === id || p.madre === id; });
  }
  function padreDe(p) { return p.padre ? byId(p.padre) : null; }
  function madreDe(p) { return p.madre ? byId(p.madre) : null; }
  function parentsOf(p) {
    return [p.padre, p.madre].map(byId).filter(Boolean);
  }
  function partnersOf(p) { return (p.parejas || []).map(byId).filter(Boolean); }
  function esAncestro(st, ancId, descId) {
    var byIdLocal = function (id) { return st.personas.filter(function (x) { return x.id === id; })[0]; };
    var seen = new Set(), queue = [descId];
    while (queue.length) {
      var cur = byIdLocal(queue.shift());
      if (!cur) continue;
      var ps = [cur.padre, cur.madre].filter(Boolean);
      for (var i = 0; i < ps.length; i++) {
        if (ps[i] === ancId) return true;
        if (!seen.has(ps[i])) { seen.add(ps[i]); queue.push(ps[i]); }
      }
    }
    return false;
  }
  function distancias() {
    var raiz = state.meta.raizId, up = new Map(), down = new Map();
    if (!raiz || !byId(raiz)) return { up: up, down: down };
    var q = [[raiz, 0]]; up.set(raiz, 0);
    while (q.length) {
      var it = q.shift(), p = byId(it[0]);
      if (!p) continue;
      parentsOf(p).forEach(function (par) {
        if (!up.has(par.id)) { up.set(par.id, it[1] + 1); q.push([par.id, it[1] + 1]); }
      });
    }
    q = [[raiz, 0]]; down.set(raiz, 0);
    while (q.length) {
      var it2 = q.shift();
      childrenOf(it2[0]).forEach(function (c) {
        if (!down.has(c.id)) { down.set(c.id, it2[1] + 1); q.push([c.id, it2[1] + 1]); }
      });
    }
    return { up: up, down: down };
  }
  function etiquetaRelacion(id, d) {
    var p = byId(id);
    if (!p) return 'Familiar';
    if (id === state.meta.raizId) return 'El cuestionado';
    var g = p.sexo;
    if (d.up.has(id)) {
      var n = d.up.get(id);
      if (n === 1) return g === 'F' ? 'Madre' : (g === 'M' ? 'Padre' : 'Progenitor/a');
      if (n === 2) return g === 'F' ? 'Abuela' : (g === 'M' ? 'Abuelo' : 'Abuelo/a');
      if (n === 3) return 'Bisabuelo/a';
      return 'Ascendiente';
    }
    if (d.down.has(id)) {
      var m = d.down.get(id);
      if (m === 1) return g === 'F' ? 'Hija' : (g === 'M' ? 'Hijo' : 'Hijo/a');
      if (m === 2) return g === 'F' ? 'Nieta' : (g === 'M' ? 'Nieto' : 'Nieto/a');
      if (m === 3) return 'Bisnieto/a';
      return 'Descendiente';
    }
    var r = byId(state.meta.raizId);
    if (r) {
      if (r.parejas.indexOf(id) !== -1) return 'Pareja';
      var ap = parentsOf(r).map(function (x) { return x.id; });
      var hijos = false;
      parentsOf(p).forEach(function (x) { if (ap.indexOf(x.id) !== -1) hijos = true; });
      if (hijos) return g === 'F' ? 'Hermana' : (g === 'M' ? 'Hermano' : 'Hermano/a');
    }
    return 'Familiar';
  }

  /* --------------------------- persistencia --------------------------- */
  function save() {
    state.meta.actualizado = new Date().toISOString();
    try { localStorage.setItem(LS_KEY, JSON.stringify({ meta: state.meta, personas: state.personas, aportes: state.aportes })); }
    catch (e) { console.warn('No se pudo guardar en localStorage', e); }
    estadoDatos();
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { }
    if (raw) {
      try { state = normalizeState(JSON.parse(raw)); return true; } catch (e) { }
    }
    state = normalizeState(null);
    return false;
  }
  function estadoDatos() {
    var el = $('#estadoDatos');
    if (!el) return;
    var fecha = state.meta.actualizado ? new Date(state.meta.actualizado).toLocaleString() : '—';
    el.textContent = plural(state.personas.length, 'persona', 'personas') + ' · ' +
      plural(state.aportes.length, 'aporte', 'aportes') + ' · último guardado: ' + fecha;
  }

  /* --------------------------- layout --------------------------- */
  function computeLayout() {
    var personas = state.personas;
    var byIdMap = new Map(personas.map(function (p) { return [p.id, p]; }));
    var row = new Map();
    var orden = personas.map(function (p) { return p.id; });
    var rootId = byIdMap.has(state.meta.raizId) ? state.meta.raizId : (orden[0] || '');
    var base = 0;

    function bfs(seed) {
      if (row.has(seed)) return;
      var rel = new Map(), q = [[seed, 0]];
      rel.set(seed, 0);
      while (q.length) {
        var it = q.shift(), id = it[0], r = it[1], p = byIdMap.get(id);
        if (!p) continue;
        var vecinos = [];
        if (p.padre && byIdMap.has(p.padre)) vecinos.push([p.padre, r - 1]);
        if (p.madre && byIdMap.has(p.madre)) vecinos.push([p.madre, r - 1]);
        personas.forEach(function (c) { if (c.padre === id || c.madre === id) vecinos.push([c.id, r + 1]); });
        (p.parejas || []).forEach(function (s) { if (byIdMap.has(s)) vecinos.push([s, r]); });
        vecinos.forEach(function (v) {
          if (!rel.has(v[0]) && !row.has(v[0])) { rel.set(v[0], v[1]); q.push(v); }
        });
      }
      var minR = Infinity, maxR = -Infinity;
      rel.forEach(function (r) { if (r < minR) minR = r; if (r > maxR) maxR = r; });
      if (minR === Infinity) minR = 0;
      rel.forEach(function (r, id) { row.set(id, r - minR + base); });
      base += (maxR - minR + 1) + 1; // una fila de aire entre grupos no vinculados
    }

    if (rootId) bfs(rootId);
    orden.forEach(function (id) { bfs(id); });

    var maxRow = 0;
    row.forEach(function (r) { if (r > maxRow) maxRow = r; });
    var rows = [];
    for (var i = 0; i <= maxRow; i++) rows.push([]);
    personas.forEach(function (p) { rows[row.get(p.id)].push(p.id); });
    // convención: varón a la izquierda en cada pareja adyacente
    rows.forEach(function (list) {
      list.sort(function (a, b) {
        var pa = byIdMap.get(a), pb = byIdMap.get(b);
        var ja = (pa.parejas || []).indexOf(b) !== -1, jb = (pb.parejas || []).indexOf(a) !== -1;
        if (ja && jb) {
          if (pa.sexo === pb.sexo) return 0;
          return pa.sexo === 'M' ? -1 : 1;
        }
        return 0;
      });
    });
    return { row: row, rows: rows, byId: byIdMap, rootId: rootId, maxRow: maxRow };
  }

  function neighborsOf(id) {
    var p = byId(id), out = [];
    if (!p) return out;
    if (p.padre && byId(p.padre)) out.push(p.padre);
    if (p.madre && byId(p.madre)) out.push(p.madre);
    (p.parejas || []).forEach(function (s) { if (byId(s)) out.push(s); });
    state.personas.forEach(function (c) { if (c.padre === id || c.madre === id) out.push(c.id); });
    return out;
  }

  function orderRows(lay) {
    var rows = lay.rows, row = lay.row;
    var idx = new Map();
    function reindex() { rows.forEach(function (r) { r.forEach(function (id, i) { idx.set(id, i); }); }); }
    reindex();
    for (var sweep = 0; sweep < 6; sweep++) {
      var down = sweep % 2 === 0;
      var order = rows.map(function (_, i) { return i; });
      if (!down) order.reverse();
      for (var oi = 0; oi < order.length; oi++) {
        var ri = order[oi], list = rows[ri];
        if (list.length < 2) continue;
        var targetRow = down ? ri - 1 : ri + 1;
        var base = new Map(list.map(function (id, i) { return [id, i]; }));
        var keyed = list.map(function (id) {
          var ns = neighborsOf(id).filter(function (n) { return row.get(n) === targetRow; });
          var k = null;
          if (ns.length) {
            k = ns.reduce(function (a, n) { return a + (idx.get(n) == null ? base.get(id) : idx.get(n)); }, 0) / ns.length;
          }
          return { id: id, k: k, base: base.get(id) };
        });
        keyed.sort(function (a, b) {
          var ka = a.k == null ? a.base : a.k, kb = b.k == null ? b.base : b.k;
          if (ka !== kb) return ka - kb;
          return a.base - b.base;
        });
        rows[ri] = keyed.map(function (x) { return x.id; });
        reindex();
      }
    }
    agruparParejas(lay);
    return lay;
  }

  // Mantiene juntos a las parejas y a los co-progenitores dentro de cada fila,
  // para que la barra de unión se dibuje limpia y no cruce por encima de otros.
  function agruparParejas(lay) {
    lay.rows.forEach(function (list, ri) {
      if (list.length < 2) return;
      var padre = new Map();
      function raiz(x) {
        var r = x;
        while (padre.get(r) !== r) r = padre.get(r);
        while (padre.get(x) !== r) { var siguiente = padre.get(x); padre.set(x, r); x = siguiente; }
        return r;
      }
      function unir(a, b) {
        if (!padre.has(a) || !padre.has(b)) return;
        var ra = raiz(a), rb = raiz(b);
        if (ra !== rb) padre.set(ra, rb);
      }
      list.forEach(function (id) { padre.set(id, id); });
      list.forEach(function (id) {
        var p = byId(id);
        if (!p) return;
        (p.parejas || []).forEach(function (q) { if (q !== id) unir(id, q); });
      });
      state.personas.forEach(function (c) {
        if (c.padre && c.madre) unir(c.padre, c.madre);
      });
      var emitidos = new Set(), nuevos = [];
      list.forEach(function (id) {
        if (emitidos.has(id)) return;
        var r = raiz(id);
        var grupo = list.filter(function (x) { return padre.has(x) && raiz(x) === r; });
        if (grupo.length === 2) {
          var a = byId(grupo[0]), b = byId(grupo[1]);
          if (a && b && a.sexo !== b.sexo && a.sexo !== 'M') grupo = [grupo[1], grupo[0]];
        }
        grupo.forEach(function (x) { if (!emitidos.has(x)) { emitidos.add(x); nuevos.push(x); } });
      });
      lay.rows[ri] = nuevos;
    });
    return lay;
  }

  function positionRows(lay) {
    var rows = lay.rows, xs = new Map(), GAP = COL_GAP;
    rows.forEach(function (list) {
      list.forEach(function (id, i) { xs.set(id, i * (CARD_W + GAP)); });
    });
    for (var it = 0; it < 4; it++) {
      rows.forEach(function (list) {
        if (!list.length) return;
        var arr = list.map(function (id, i) {
          var ns = neighborsOf(id).filter(function (n) { return xs.has(n); });
          var cur = xs.get(id);
          var wanted = ns.length ? ns.reduce(function (a, n) { return a + xs.get(n); }, 0) / ns.length : cur;
          return { id: id, x: (cur * 2 + wanted) / 3 };
        });
        for (var i = 1; i < arr.length; i++) if (arr[i].x < arr[i - 1].x + CARD_W + 28) arr[i].x = arr[i - 1].x + CARD_W + 28;
        for (var j = arr.length - 2; j >= 0; j--) if (arr[j].x > arr[j + 1].x - CARD_W - 28) arr[j].x = arr[j + 1].x - CARD_W - 28;
        arr.forEach(function (a) { xs.set(a.id, a.x); });
      });
    }
    var minX = Infinity;
    xs.forEach(function (v) { if (v < minX) minX = v; });
    if (minX === Infinity) minX = 0;
    xs.forEach(function (v, id) { xs.set(id, v - minX); });
    return xs;
  }

  function buildEdges(lay, xs) {
    var d = [];
    function pos(id) { return { x: xs.get(id) + PAD, y: lay.row.get(id) * ROW_STEP + PAD }; }
    state.personas.forEach(function (c) {
      if (!xs.has(c.id)) return;
      var pr = [c.padre, c.madre].filter(function (pid) { return pid && xs.has(pid); });
      if (!pr.length) return;
      var child = pos(c.id), cRow = lay.row.get(c.id);
      var arriba = pr.map(pos).filter(function (p, i) { return lay.row.get(pr[i]) < cRow; });
      var abajo = pr.map(pos).filter(function (p, i) { return lay.row.get(pr[i]) >= cRow; });

      arriba.sort(function (a, b) { return a.x - b.x; });
      if (arriba.length >= 2) {
        var a = arriba[0], b = arriba[arriba.length - 1];
        var adyacentes = Math.abs(b.y - a.y) < 1 && (b.x - a.x) > CARD_W + 6 && (b.x - a.x) < CARD_W + COL_GAP + 60;
        if (adyacentes) {
          var cy = a.y + CARD_H / 2, mid = (a.x + CARD_W + b.x) / 2, bus = a.y + CARD_H + 40;
          d.push('M ' + (a.x + CARD_W) + ' ' + cy + ' H ' + b.x);
          d.push('M ' + mid + ' ' + cy + ' V ' + bus + ' H ' + (child.x + CARD_W / 2) + ' V ' + child.y);
        } else {
          arriba.forEach(function (p, i) {
            var bus = p.y + CARD_H + 34 + i * 14;
            d.push('M ' + (p.x + CARD_W / 2) + ' ' + (p.y + CARD_H) + ' V ' + bus + ' H ' + (child.x + CARD_W / 2) + ' V ' + child.y);
          });
        }
      } else if (arriba.length === 1) {
        var p = arriba[0], bus2 = p.y + CARD_H + 40;
        d.push('M ' + (p.x + CARD_W / 2) + ' ' + (p.y + CARD_H) + ' V ' + bus2 + ' H ' + (child.x + CARD_W / 2) + ' V ' + child.y);
      }
      abajo.forEach(function (p) {
        d.push('M ' + (p.x + CARD_W / 2) + ' ' + (p.y + CARD_H / 2) + ' L ' + (child.x + CARD_W / 2) + ' ' + (child.y + CARD_H / 2));
      });
    });
    // quitar duplicados (p. ej. la barra de unión de una pareja con varios hijos)
    var vistos = new Set();
    return d.filter(function (p) {
      if (vistos.has(p)) return false;
      vistos.add(p);
      return true;
    });
  }

  /* --------------------------- render --------------------------- */
  var lay = null, xs = null, edgePaths = [], worldSize = { w: 0, h: 0 };
  var view = { zoom: 1, x: 0, y: 0 };
  var seleccion = null;

  function render(preserveView) {
    var mundo = $('#mundo'), tarjetas = $('#tarjetas'), svg = $('#aristas'), vacio = $('#vacio');
    tituloHeader();
    if (!state.personas.length) {
      tarjetas.innerHTML = ''; svg.innerHTML = ''; svg.setAttribute('width', 0); svg.setAttribute('height', 0);
      vacio.hidden = false;
      $('#stats').textContent = 'Sin datos todavía';
      lay = null; xs = null; edgePaths = [];
      pintarDatalist();
      pintarFicha();
      return;
    }
    vacio.hidden = true;
    var L = computeLayout();
    orderRows(L);
    var X = positionRows(L);
    lay = L; xs = X;

    var maxX = 0; X.forEach(function (v) { if (v > maxX) maxX = v; });
    var W = maxX + CARD_W + PAD, H = (L.maxRow + 1) * ROW_STEP + PAD;
    worldSize = { w: W, h: H };

    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    edgePaths = buildEdges(L, X);
    svg.innerHTML = edgePaths.map(function (p) { return '<path d="' + p + '"/>'; }).join('');
    tarjetas.style.width = W + 'px';
    tarjetas.style.height = H + 'px';

    var d = distancias();
    var ordered = [];
    L.rows.forEach(function (list) { list.forEach(function (id) { ordered.push(id); }); });
    tarjetas.innerHTML = ordered.map(function (id) {
      var p = byId(id);
      if (!p) return '';
      var x = X.get(id) + PAD, y = L.row.get(id) * ROW_STEP + PAD;
      var esRaiz = id === state.meta.raizId;
      var meta = [];
      var anos = (p.nac ? yearOf(p.nac) : '') + (p.fall ? ' – ' + yearOf(p.fall) : '');
      if (anos) meta.push(anos);
      if (p.lugar) meta.push(p.lugar);
      var avatar = p.foto
        ? '<span class="avatar" style="background-image:url(\'' + esc(p.foto) + '\')"></span>'
        : '<span class="avatar">' + esc(initials(p.nombre)) + '</span>';
      return '<button class="card certeza-' + p.certeza + (esRaiz ? ' raiz' : '') + (id === seleccion ? ' seleccionada' : '') +
        '" data-id="' + esc(id) + '" style="left:' + x + 'px;top:' + y + 'px" title="' + esc(p.nombre + (p.alias ? ' (“' + p.alias + '”)' : '')) + '">' +
        avatar +
        '<span class="dot" title="certeza ' + p.certeza + '"></span>' +
        '<span class="card-rel">' + esc(etiquetaRelacion(id, d)) + '</span>' +
        '<span class="card-nombre">' + esc(p.nombre) + '</span>' +
        '<span class="card-meta">' + esc(meta.join(' · ') || 'sin datos') + '</span>' +
        '</button>';
    }).join('');

    $('#stats').textContent = plural(state.personas.length, 'persona', 'personas') + ' · ' +
      plural(state.aportes.length, 'aporte', 'aportes');
    pintarDatalist();
    pintarFicha();
    if (!preserveView) fit(esMovil() ? 'ancho' : 'todo');
    else aplicarVista();
    buscar();
  }

  function esMovil() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
  }

  /* ---------- hoja inferior en móvil ---------- */
  function abrirTab(nombre) {
    var t = $('.tab[data-tab="' + nombre + '"]');
    if (t) t.click();
  }
  function abrirPanel(tab) {
    if (tab) abrirTab(tab);
    if (!esMovil()) return;
    var panel = $('#panel');
    if (panel) panel.classList.add('abierto');
    document.body.classList.add('panel-abierto');
    var t = $('#sheetTitulo');
    if (t) t.textContent = tab === 'aporte' ? 'Aportar datos' : (tab === 'datos' ? 'Datos y ajustes' : 'Ficha');
  }
  function cerrarPanel() {
    var panel = $('#panel');
    if (panel) { panel.classList.remove('abierto'); panel.style.transform = ''; }
    document.body.classList.remove('panel-abierto');
  }

  function aplicarVista() {
    var mundo = $('#mundo');
    mundo.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')';
  }
  function fit(modo) {
    var lienzo = $('#lienzo');
    if (!lienzo || !worldSize.w) { aplicarVista(); return; }
    var w = lienzo.clientWidth, h = lienzo.clientHeight;
    var z, y;
    if (modo === 'ancho') {
      // En móvil el árbol puede ser más ancho que la pantalla: se empieza con un zoom
      // legible centrado en el cuestionado y se deja el botón ⤢ para verlo entero.
      z = Math.min(1.1, Math.max(0.75, (w - 28) / worldSize.w));
      var raizX = 0, raizY = 0;
      if (xs && xs.has(state.meta.raizId)) {
        raizX = xs.get(state.meta.raizId) + PAD + CARD_W / 2;
        raizY = lay.row.get(state.meta.raizId) * ROW_STEP + PAD + CARD_H / 2;
      }
      view.zoom = z;
      view.x = w / 2 - raizX * z;
      view.y = Math.min(h * 0.42 - raizY * z, 40);
    } else {
      z = Math.min((w - 60) / worldSize.w, (h - 60) / worldSize.h, 1.1);
      z = Math.max(z, 0.15);
      view.zoom = z;
      view.x = (w - worldSize.w * z) / 2;
      view.y = (h - worldSize.h * z) / 2;
    }
    aplicarVista();
  }
  function ajustarTodo() { fit('todo'); }
  function zoomEn(factor, cx, cy) {
    var lienzo = $('#lienzo'), r = lienzo.getBoundingClientRect();
    var px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
    var nz = Math.min(2.5, Math.max(0.15, view.zoom * factor));
    view.x = px - (px - view.x) * (nz / view.zoom);
    view.y = py - (py - view.y) * (nz / view.zoom);
    view.zoom = nz;
    aplicarVista();
  }
  function centrarEn(id) {
    var lienzo = $('#lienzo');
    if (!xs || !xs.has(id) || !lienzo) return;
    var z = Math.max(view.zoom, 0.8);
    var x = xs.get(id) + PAD + CARD_W / 2, y = lay.row.get(id) * ROW_STEP + PAD + CARD_H / 2;
    view.zoom = z;
    view.x = lienzo.clientWidth / 2 - x * z;
    view.y = lienzo.clientHeight / 2 - y * z;
    aplicarVista();
  }

  function tituloHeader() {
    $('#tituloApp').textContent = state.meta.titulo || CONF.titulo;
    $('#subtituloApp').textContent = state.meta.subtitulo || CONF.subtitulo;
    document.title = (state.meta.titulo || CONF.titulo) + ' — árbol genealógico';
    $('#cfgTitulo').value = state.meta.titulo || '';
    $('#cfgSubtitulo').value = state.meta.subtitulo || '';
    $('#cfgEndpoint').value = state.meta.endpoint || '';
    $('#cfgRepo').value = state.meta.repoUrl || '';
  }

  function pintarDatalist() {
    $('#personasDatalist').innerHTML = state.personas.map(function (p) {
      return '<option value="' + esc(p.nombre) + '"></option>';
    }).join('');
  }

  /* --------------------------- ficha --------------------------- */
  function pintarFicha() {
    var p = seleccion ? byId(seleccion) : null;
    var vacia = $('#fichaVacia'), form = $('#fichaForm');
    if (!p) {
      vacia.hidden = false; form.hidden = true;
      return;
    }
    vacia.hidden = true; form.hidden = false;
    var d = distancias();
    $('#fichaTitulo').textContent = p.nombre + (p.alias ? ' (“' + p.alias + '”)' : '');
    $('#fichaRel').textContent = etiquetaRelacion(p.id, d) + ' · ' +
      plural(childrenOf(p.id).length, 'hijo/a conocido', 'hijos/as conocidos') + ' · ' +
      plural((p.parejas || []).length, 'pareja', 'parejas');
    $('#fNombre').value = p.nombre;
    $('#fAlias').value = p.alias || '';
    $('#fSexo').value = p.sexo || '';
    $('#fNac').value = p.nac || '';
    $('#fFall').value = p.fall || '';
    $('#fLugar').value = p.lugar || '';
    $('#fFoto').value = p.foto || '';
    $('#fCerteza').value = p.certeza;
    $('#fNotas').value = p.notas || '';
    $('#fFuentes').value = (p.fuentes || []).map(function (f) {
      return f.url ? (f.texto || 'fuente') + ' | ' + f.url : (f.texto || '');
    }).join('\n');

    var opciones = '<option value="">— sin dato —</option>' + state.personas
      .filter(function (x) { return x.id !== p.id; })
      .map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.nombre) + '</option>'; }).join('');
    $('#fPadre').innerHTML = opciones;
    $('#fMadre').innerHTML = opciones;
    $('#fPadre').value = p.padre || '';
    $('#fMadre').value = p.madre || '';

    var hijos = childrenOf(p.id);
    $('#listaHijos').innerHTML = hijos.length
      ? hijos.map(function (h) {
        return '<li>' + esc(h.nombre) + '<button data-quitar-hijo="' + esc(h.id) + '" title="Quitar del árbol de este progenitor">×</button></li>';
      }).join('')
      : '<li class="vacio-chip">Sin hijos registrados</li>';

    var parejas = partnersOf(p);
    $('#listaParejas').innerHTML = parejas.length
      ? parejas.map(function (q) {
        return '<li>' + esc(q.nombre) + '<button data-quitar-pareja="' + esc(q.id) + '" title="Quitar pareja">×</button></li>';
      }).join('')
      : '<li class="vacio-chip">Sin parejas registradas</li>';
  }

  function seleccionar(id, centrar) {
    seleccion = id;
    $$('.card').forEach(function (c) { c.classList.toggle('seleccionada', c.dataset.id === id); });
    pintarFicha();
    if (centrar) centrarEn(id);
  }

  /* --------------------------- personas --------------------------- */
  function findPersona(nombre) {
    var n = norm(nombre);
    if (!n) return null;
    var exacta = state.personas.filter(function (p) { return norm(p.nombre) === n; })[0];
    if (exacta) return exacta;
    return state.personas.filter(function (p) { return norm(p.alias) === n; })[0] || null;
  }
  function nuevaPersona(datos) {
    var p = {
      id: uid(), nombre: (datos && datos.nombre) || 'Sin nombre', alias: '', sexo: (datos && datos.sexo) || '',
      nac: (datos && datos.nac) || '', fall: '', lugar: '', foto: '', notas: (datos && datos.notas) || '',
      certeza: (datos && datos.certeza) || 'media', fuentes: (datos && datos.fuentes) || [],
      padre: '', madre: '', parejas: []
    };
    state.personas.push(p);
    if (!state.meta.raizId) state.meta.raizId = p.id;
    return p;
  }
  function asegurarPersona(nombre, datos) {
    var existente = findPersona(nombre);
    if (existente) {
      if (datos) {
        if (!existente.sexo && datos.sexo) existente.sexo = datos.sexo;
        if (!existente.nac && datos.nac) existente.nac = datos.nac;
        if (datos.notas) existente.notas = (existente.notas ? existente.notas + '\n' : '') + datos.notas;
      }
      return existente;
    }
    return nuevaPersona(Object.assign({ nombre: nombre }, datos || {}));
  }
  function asignarProgenitor(hijo, progenitor) {
    if (!hijo || !progenitor || hijo.id === progenitor.id) return;
    if (esAncestro(state, hijo.id, progenitor.id)) { aviso('Eso crearía un ciclo familiar; no se aplicó.'); return; }
    if (progenitor.sexo === 'F') hijo.madre = progenitor.id;
    else hijo.padre = progenitor.id;
  }
  function vincularPareja(a, b) {
    if (!a || !b || a.id === b.id) return;
    if (a.parejas.indexOf(b.id) === -1) a.parejas.push(b.id);
    if (b.parejas.indexOf(a.id) === -1) b.parejas.push(a.id);
  }
  function eliminarPersona(id) {
    var p = byId(id);
    if (!p) return;
    if (!confirm('¿Eliminar a “' + p.nombre + '” del árbol? Se quitarán también sus vínculos.')) return;
    state.personas = state.personas.filter(function (x) { return x.id !== id; });
    state.personas.forEach(function (x) {
      if (x.padre === id) x.padre = '';
      if (x.madre === id) x.madre = '';
      x.parejas = x.parejas.filter(function (y) { return y !== id; });
    });
    if (state.meta.raizId === id) state.meta.raizId = state.personas.length ? state.personas[0].id : '';
    seleccion = null;
    save(); render();
  }

  /* --------------------------- aportes --------------------------- */
  function registrarAporte(datos, aplicar) {
    var aporte = Object.assign({
      id: uid('a'), informante: '', fecha: new Date().toISOString(),
      tipo: 'persona', refNombre: '', nombre: '', sexo: '', nac: '', certeza: 'media',
      fuente: '', notas: '', aplicado: false
    }, datos);
    state.aportes.unshift(aporte);
    if (aplicar) aplicarAporte(aporte);
    return aporte;
  }
  function aplicarAporte(aporte) {
    var refNombre = aporte.refNombre || (byId(state.meta.raizId) ? byId(state.meta.raizId).nombre : 'El cuestionado');
    var ref = asegurarPersona(refNombre);
    var fuente = [{ texto: (aporte.informante ? aporte.informante + ': ' : '') + (aporte.fuente || 'aporte web'), url: /^https?:/.test(aporte.fuente || '') ? aporte.fuente : '' }];
    aporte.conflicto = '';

    // ¿El hueco ya está ocupado por otra persona? Entonces hay que confirmar antes de reemplazar.
    function ocupadoPorOtro(destino, campo) {
      if (!destino[campo]) return null;
      var actual = byId(destino[campo]);
      if (!actual) return null;
      if (norm(actual.nombre) === norm(aporte.nombre)) return null; // es la misma persona
      return actual;
    }
    function pedirReemplazo(actual, campo, destino) {
      var pregunta = 'Ya hay ' + (campo === 'madre' ? 'una madre' : 'un padre') + ' registrado para “' + destino.nombre + '”: ' +
        actual.nombre + '.\n\nAceptar = reemplazar por “' + aporte.nombre + '”.\nCancelar = mantener el actual y dejar el aporte pendiente.';
      var ok = typeof confirm === 'function' ? confirm(pregunta) : false;
      if (!ok) {
        aporte.aplicado = false;
        aporte.conflicto = 'No aplicado: ya había ' + (campo === 'madre' ? 'madre' : 'padre') + ' (' + actual.nombre + ')';
      }
      return ok;
    }

    if (aporte.tipo === 'persona') {
      var per = asegurarPersona(aporte.nombre, { sexo: aporte.sexo, nac: aporte.nac, notas: aporte.notas });
      per.certeza = aporte.certeza;
      per.fuentes = (per.fuentes || []).concat(fuente);

    } else if (aporte.tipo === 'padre' || aporte.tipo === 'madre') {
      var campoR = (aporte.tipo === 'madre' || aporte.sexo === 'F') ? 'madre' : 'padre';
      var existente = findPersona(aporte.nombre);
      if (existente && esAncestro(state, ref.id, existente.id)) {
        aporte.aplicado = false;
        aporte.conflicto = 'No aplicado: crearía un ciclo familiar (esa persona ya es descendiente).';
        return aporte;
      }
      var actual = ocupadoPorOtro(ref, campoR);
      if (actual && !pedirReemplazo(actual, campoR, ref)) return aporte;
      var nueva = asegurarPersona(aporte.nombre, { sexo: aporte.sexo || (aporte.tipo === 'madre' ? 'F' : 'M'), nac: aporte.nac, notas: aporte.notas });
      if (!nueva.sexo) nueva.sexo = aporte.tipo === 'madre' ? 'F' : 'M';
      if (nueva.certeza === 'media') nueva.certeza = aporte.certeza;
      nueva.fuentes = (nueva.fuentes || []).concat(fuente);
      ref[campoR] = nueva.id;

    } else if (aporte.tipo === 'hijo') {
      var existenteH = findPersona(aporte.nombre);
      if (existenteH && esAncestro(state, existenteH.id, ref.id)) {
        aporte.aplicado = false;
        aporte.conflicto = 'No aplicado: crearía un ciclo familiar (esa persona ya es ascendiente).';
        return aporte;
      }
      var hijo = asegurarPersona(aporte.nombre, { sexo: aporte.sexo, nac: aporte.nac, notas: aporte.notas });
      var campoH = ref.sexo === 'F' ? 'madre' : 'padre';
      var actualH = ocupadoPorOtro(hijo, campoH);
      if (actualH && !pedirReemplazo(actualH, campoH, hijo)) return aporte;
      if (!hijo.sexo && aporte.sexo) hijo.sexo = aporte.sexo;
      hijo.certeza = aporte.certeza;
      hijo.fuentes = (hijo.fuentes || []).concat(fuente);
      hijo[campoH] = ref.id;

    } else if (aporte.tipo === 'pareja') {
      var pq = asegurarPersona(aporte.nombre, { sexo: aporte.sexo, nac: aporte.nac, notas: aporte.notas });
      vincularPareja(ref, pq);
    }

    aporte.aplicado = true;
    return aporte;
  }
  function pintarAportes() {
    var ul = $('#listaAportes');
    $('#numAportes').textContent = String(state.aportes.length);
    if (!state.aportes.length) {
      ul.innerHTML = '<li class="muted">Todavía no hay aportes registrados.</li>';
      return;
    }
    ul.innerHTML = state.aportes.map(function (a) {
      var rel = { padre: 'es padre de', madre: 'es madre de', hijo: 'es hijo/a de', pareja: 'es pareja de', persona: 'datos de' }[a.tipo] || a.tipo;
      var frase = a.tipo === 'persona'
        ? 'Datos de ' + esc(a.nombre)
        : esc(a.nombre) + ' ' + rel + ' ' + esc(a.refNombre || 'el cuestionado');
      var fecha = a.fecha ? new Date(a.fecha).toLocaleDateString() : '';
      return '<li>' +
        '<div class="aporte-top"><span class="aporte-quien">' + esc(a.informante || 'Anónimo') + '</span>' +
        '<span class="aporte-meta">' + esc(fecha) + (a.aplicado ? ' · <span class="badge aplicado">aplicado</span>' : ' · <span class="badge">pendiente</span>') + '</span></div>' +
        '<div>' + frase + ' <span class="aporte-meta">· certeza ' + esc(a.certeza) + '</span></div>' +
        (a.fuente ? '<div class="aporte-meta">Fuente: ' + esc(a.fuente) + '</div>' : '') +
        (a.notas ? '<div class="aporte-meta">' + esc(a.notas) + '</div>' : '') +
        (a.conflicto ? '<div class="aporte-meta conflicto">⚠ ' + esc(a.conflicto) + '</div>' : '') +
        '<div class="aporte-acciones">' +
        '<button class="small" data-aplicar-aporte="' + esc(a.id) + '">Aplicar al árbol</button>' +
        '<button class="small danger" data-borrar-aporte="' + esc(a.id) + '">Quitar</button>' +
        '</div></li>';
    }).join('');
  }

  /* --------------------------- banners --------------------------- */
  var bannerAccion = null;
  function aviso(texto, accionTexto, accion) {
    $('#bannerTexto').textContent = texto;
    var btn = $('#bannerAccion');
    if (accionTexto && accion) {
      btn.hidden = false; btn.textContent = accionTexto; bannerAccion = accion;
    } else { btn.hidden = true; bannerAccion = null; }
    $('#banner').hidden = false;
  }

  /* --------------------------- exportaciones --------------------------- */
  function exportarJSON() {
    descargar('arbol-genealogico.json', JSON.stringify({ meta: state.meta, personas: state.personas, aportes: state.aportes }, null, 2));
  }
  function exportarCSV() {
    var filas = [['nombre', 'alias', 'sexo', 'nacimiento', 'fallecimiento', 'lugar', 'padre', 'madre', 'parejas', 'certeza', 'notas']];
    state.personas.forEach(function (p) {
      var par = p.padre ? byId(p.padre) : null, mad = p.madre ? byId(p.madre) : null;
      filas.push([p.nombre, p.alias, p.sexo, p.nac, p.fall, p.lugar,
        par ? par.nombre : '', mad ? mad.nombre : '',
        (p.parejas || []).map(function (x) { var q = byId(x); return q ? q.nombre : ''; }).filter(Boolean).join(' / '),
        p.certeza, p.notas]);
    });
    var csv = filas.map(function (f) {
      return f.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    descargar('arbol-genealogico.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
  }
  function exportarGEDCOM() {
    var out = ['0 HEAD', '1 SOUR ARBOL-WEB-COLABORATIVO', '2 NAME Árbol genealógico web', '1 GEDC', '2 VERS 5.5', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', '1 DATE ' + new Date().toISOString().slice(0, 10)];
    var iNum = new Map(), fams = [], famc = new Map(), famsDe = new Map();
    state.personas.forEach(function (p, i) { iNum.set(p.id, 'I' + (i + 1)); });
    var usados = new Set();
    function famKey(ids) { return ids.slice().sort().join('|'); }
    state.personas.forEach(function (c) {
      var pr = [c.padre, c.madre].filter(Boolean);
      if (!pr.length) return;
      var key = famKey(pr);
      var fam = fams.filter(function (f) { return f.key === key; })[0];
      if (!fam) { fam = { key: key, padres: pr, hijos: [] }; fams.push(fam); }
      fam.hijos.push(c.id);
      famc.set(c.id, fam);
    });
    state.personas.forEach(function (p) {
      (p.parejas || []).forEach(function (qid) {
        var key = famKey([p.id, qid]);
        if (usados.has(key)) return;
        usados.add(key);
        if (!fams.some(function (f) { return f.key === key; })) fams.push({ key: key, padres: [p.id, qid], hijos: [] });
      });
    });
    // añadir hijos a familias de pareja si faltan
    state.personas.forEach(function (c) {
      var pr = [c.padre, c.madre].filter(Boolean);
      if (pr.length !== 2) return;
      var key = famKey(pr);
      var fam = fams.filter(function (f) { return f.key === key; })[0];
      if (fam && fam.hijos.indexOf(c.id) === -1) fam.hijos.push(c.id);
    });
    fams.forEach(function (f, i) { f.id = 'F' + (i + 1); f.padres.forEach(function (pid) { famsDe.set(pid, f); }); });

    state.personas.forEach(function (p) {
      out.push('0 @' + iNum.get(p.id) + '@ INDI');
      out.push('1 NAME ' + p.nombre.replace(/\//g, ' ') + ' /' + (p.alias || '') + '/');
      if (p.sexo) out.push('1 SEX ' + p.sexo);
      if (p.nac) out.push('1 BIRT\n2 DATE ' + yearOf(p.nac));
      if (p.fall) out.push('1 DEAT\n2 DATE ' + yearOf(p.fall));
      if (p.lugar) out.push('1 RESI\n2 PLAC ' + p.lugar);
      var f = famsDe.get(p.id); if (f) out.push('1 FAMS @' + f.id + '@');
      var fc = famc.get(p.id); if (fc) out.push('1 FAMC @' + fc.id + '@');
      if (p.notas) out.push('1 NOTE ' + p.notas.replace(/\n/g, ' '));
      (p.fuentes || []).forEach(function (fu) {
        out.push('1 SOUR ' + ((fu.texto || '') + ' ' + (fu.url || '')).trim());
      });
    });
    fams.forEach(function (f) {
      out.push('0 @' + f.id + '@ FAM');
      f.padres.forEach(function (pid) {
        var p = byId(pid); if (!p) return;
        out.push('1 ' + (p.sexo === 'F' ? 'WIFE' : 'HUSB') + ' @' + iNum.get(pid) + '@');
      });
      f.hijos.forEach(function (cid) { out.push('1 CHIL @' + iNum.get(cid) + '@'); });
    });
    out.push('0 TRLR');
    descargar('arbol-genealogico.ged', out.join('\n'), 'text/plain;charset=utf-8');
  }
  function exportarPNG() {
    if (!lay || !xs) { aviso('No hay nada que exportar todavía.'); return; }
    var scale = 2, W = worldSize.w, H = worldSize.h;
    var c = document.createElement('canvas');
    c.width = W * scale; c.height = H * scale;
    var ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#9aa8a1'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    edgePaths.forEach(function (d) { ctx.stroke(new Path2D(d)); });
    var d = distancias();
    lay.rows.forEach(function (list) {
      list.forEach(function (id) {
        var p = byId(id); if (!p) return;
        var x = xs.get(id) + PAD, y = lay.row.get(id) * ROW_STEP + PAD;
        var esRaiz = id === state.meta.raizId;
        ctx.save();
        ruta(ctx, x, y, CARD_W, CARD_H, 12);
        ctx.fillStyle = esRaiz ? '#fdf3e0' : '#ffffff'; ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = esRaiz ? '#b7791f' : '#dfe5e1';
        if (p.certeza === 'baja') ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#5c6b64'; ctx.font = '600 9px system-ui, sans-serif';
        ctx.fillText(etiquetaRelacion(id, d).toUpperCase().slice(0, 34), x + 12, y + 20);
        ctx.fillStyle = '#1c2a24'; ctx.font = '650 13px system-ui, sans-serif';
        ctx.fillText(recortar(ctx, p.nombre, CARD_W - 24), x + 12, y + 42);
        var meta = [p.nac ? yearOf(p.nac) : '', p.fall ? '– ' + yearOf(p.fall) : '', p.lugar].filter(Boolean).join(' · ');
        ctx.fillStyle = '#5c6b64'; ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(recortar(ctx, meta || 'sin datos', CARD_W - 24), x + 12, y + 60);
        ctx.beginPath();
        ctx.arc(x + CARD_W - 12, y + 12, 4, 0, Math.PI * 2);
        ctx.fillStyle = p.certeza === 'alta' ? '#2f855a' : (p.certeza === 'baja' ? '#c05621' : '#b7791f');
        ctx.fill();
        ctx.restore();
      });
    });
    try {
      var a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = 'arbol-genealogico.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { aviso('No se pudo generar el PNG en este navegador.'); }
  }
  function recortar(ctx, texto, maxW) {
    texto = String(texto || '');
    if (ctx.measureText(texto).width <= maxW) return texto;
    while (texto.length > 3 && ctx.measureText(texto + '…').width > maxW) texto = texto.slice(0, -1);
    return texto + '…';
  }
  function ruta(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function importarJSON(texto, modo) {
    var datos;
    try { datos = JSON.parse(texto); } catch (e) { aviso('El archivo no es un JSON válido.'); return; }
    var entrante = normalizeState(datos);
    if (!entrante.personas.length && !(datos.aportes || []).length) { aviso('El archivo no contiene personas.'); return; }
    if (modo === 'reemplazar') {
      seleccion = null;
      state = entrante;
      save(); render();
      aviso('Árbol reemplazado con ' + state.personas.length + ' personas.');
      return;
    }
    var nuevas = 0, vinculadas = 0;
    // 1) fusionar por nombre+año
    entrante.personas.forEach(function (pe) {
      var existente = state.personas.filter(function (x) {
        return norm(x.nombre) === norm(pe.nombre) &&
          (!yearOf(pe.nac) || !yearOf(x.nac) || yearOf(pe.nac) === yearOf(x.nac));
      })[0];
      if (!existente) { state.personas.push(pe); nuevas++; return; }
      // completar huecos
      ['alias', 'sexo', 'nac', 'fall', 'lugar', 'foto', 'notas'].forEach(function (k) {
        if (!existente[k] && pe[k]) existente[k] = pe[k];
      });
      if (pe.certeza === 'alta') existente.certeza = 'alta';
      if (pe.fuentes && pe.fuentes.length) existente.fuentes = (existente.fuentes || []).concat(pe.fuentes);
      pe._destino = existente.id;
    });
    // 2) reconstruir vínculos dentro del lote importado
    entrante.personas.forEach(function (pe) {
      var destino = pe._destino ? byId(pe._destino) : findPersona(pe.nombre);
      if (!destino) return;
      ['padre', 'madre'].forEach(function (campo) {
        var orig = byId(pe[campo]) || entrante.personas.filter(function (x) { return x.id === pe[campo]; })[0];
        if (!orig) return;
        var target = orig._destino ? byId(orig._destino) : findPersona(orig.nombre);
        if (target && destino[campo] !== target.id && !destino[campo]) { destino[campo] = target.id; vinculadas++; }
      });
      (pe.parejas || []).forEach(function (pid) {
        var orig = entrante.personas.filter(function (x) { return x.id === pid; })[0];
        if (!orig) return;
        var target = orig._destino ? byId(orig._destino) : findPersona(orig.nombre);
        if (target) vincularPareja(destino, target);
      });
    });
    // 3) aportes
    (entrante.aportes || []).forEach(function (a) {
      if (!state.aportes.some(function (x) { return x.id === a.id; })) state.aportes.push(a);
    });
    state.personas.forEach(function (p) { delete p._destino; });
    save(); render();
    aviso('Fusión lista: ' + nuevas + ' personas nuevas, ' + vinculadas + ' vínculos nuevos.');
  }

  /* --------------------------- envío --------------------------- */
  function enviarAportes() {
    var endpoint = state.meta.endpoint;
    if (!endpoint) {
      aviso('No hay endpoint configurado. Usa “Copiar enlace con mis aportes” o pásale el JSON al administrador.', 'Copiar enlace', copiarEnlace);
      return;
    }
    var payload = { proyecto: state.meta.titulo, informante: $('#aInformante').value.trim(), aportes: state.aportes };
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      aviso('¡Aportes enviados! Gracias.');
    }).catch(function (e) {
      aviso('No se pudo enviar (' + e.message + '). Prueba con el enlace o el JSON.', 'Copiar enlace', copiarEnlace);
    });
  }
  function copiarEnlace() {
    compartirEnlace({ v: 1, tipo: 'aporte', informante: $('#aInformante').value.trim(), aportes: state.aportes }, 'aporte',
      'Enlace con tus aportes copiado.');
  }
  function compartirArbol() {
    compartirEnlace({ v: 1, tipo: 'datos', meta: state.meta, personas: state.personas, aportes: state.aportes }, 'datos',
      'Enlace del árbol copiado.');
  }
  function enlaceDe(prefijo, contenido) {
    return location.origin + location.pathname + '#' + prefijo + '=' + contenido;
  }
  function compartirEnlace(payload, prefijo, mensaje) {
    var urlPlano = enlaceDe(prefijo, b64enc(JSON.stringify(payload)));
    if (!hayCrypto()) {
      copiar(urlPlano, 'Enlace copiado SIN cifrar (este navegador no permite cifrar). Cualquiera con el enlace puede leer los datos.');
      return;
    }
    var proteger = typeof confirm === 'function' &&
      confirm('¿Proteger el enlace con una contraseña?\n\nAceptar = se cifra: hará falta la contraseña para abrirlo.\nCancelar = enlace normal, legible por cualquiera que lo tenga.');
    if (!proteger) {
      copiar(urlPlano, 'Enlace copiado SIN cifrar. Cualquiera que lo reciba podrá leer los datos.');
      return;
    }
    var pass = typeof prompt === 'function' ? prompt('Contraseña para este enlace (compártela por un canal aparte, nunca en el mismo mensaje que el enlace):') : '';
    if (!pass) { aviso('No se copió nada: hacía falta una contraseña.'); return; }
    cifrarTexto(JSON.stringify(payload), pass).then(function (cifrado) {
      copiar(enlaceDe(prefijo + '-c', cifrado), mensaje + ' Cifrado: envía la contraseña por otro medio (y no la guardes en el mismo chat).');
    }).catch(function (e) {
      copiar(urlPlano, 'No se pudo cifrar (' + e.message + '); se copió el enlace normal, sin cifrar.');
    });
  }
  function copiar(texto, mensaje) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () { aviso(mensaje || 'Copiado.'); },
        function () { aviso(texto); });
    } else {
      aviso(texto);
    }
  }
  function limpiarHash() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
    location.hash = '';
  }
  function leerHash() {
    var h = String(location.hash || '');
    var m = h.length > 3 ? h.slice(1).match(/^(datos|aporte)(-c)?=(.+)$/) : null;
    if (!m) return;
    var tipo = m[1], cifrado = !!m[2], cuerpo = m[3];

    if (cifrado) {
      if (!hayCrypto()) {
        aviso('El enlace viene cifrado, pero este navegador no puede descifrarlo. Ábrelo en Chrome, Safari o Firefox actualizados.');
        return;
      }
      aviso('Enlace cifrado recibido. Hace falta la contraseña para abrirlo.', 'Abrir enlace cifrado', function () {
        var pass = typeof prompt === 'function' ? prompt('Contraseña del enlace:') : '';
        if (!pass) return;
        descifrarTexto(cuerpo, pass).then(function (texto) {
          aplicarPayload(JSON.parse(texto), tipo);
        }).catch(function () {
          aviso('No se pudo abrir: contraseña incorrecta o enlace dañado.');
        });
      });
      return;
    }

    try { aplicarPayload(JSON.parse(b64dec(cuerpo)), tipo); }
    catch (e) { aviso('No se pudo leer el enlace (formato inesperado).'); }
  }
  function aplicarPayload(datos, tipo) {
    if (!datos) return;
    if (tipo === 'aporte' || datos.tipo === 'aporte') {
      var lista = datos.aportes || [];
      if (!lista.length) { aviso('El enlace no trae aportes.'); return; }
      aviso('Aportes recibidos de ' + (datos.informante || 'anónimo') + ': ' + lista.length + ' registro(s).', 'Importar aportes', function () {
        lista.forEach(function (a) {
          if (!state.aportes.some(function (x) { return x.id === a.id; })) state.aportes.push(a);
        });
        save(); render(); pintarAportes();
        limpiarHash();
        aviso('Aportes importados. Revísalos y pulsa “Aplicar al árbol” en cada uno.');
      });
      return;
    }
    var n = (datos.personas || []).length, k = (datos.aportes || []).length;
    aviso('Árbol recibido: ' + n + ' persona(s) y ' + k + ' aporte(s). ¿Fusionarlo con lo que tienes ahora?', 'Fusionar en mi árbol', function () {
      importarJSON(JSON.stringify(datos), 'fusionar');
      limpiarHash();
    });
  }

  /* --------------------------- demo --------------------------- */
  function demo() {
    var base = {
      alias: '', fall: '', lugar: '', foto: '', notas: '', certeza: 'baja', fuentes: [], padre: '', madre: '', parejas: []
    };
    function per(id, nombre, extra) { return Object.assign({ id: id, nombre: nombre }, base, extra || {}); }
    return {
      meta: { titulo: state.meta.titulo || CONF.titulo, subtitulo: state.meta.subtitulo || CONF.subtitulo, raizId: 'cuestionado', actualizado: '' },
      personas: [
        per('abuelo-p', 'Abuelo paterno (por confirmar)', { sexo: 'M', certeza: 'baja' }),
        per('padre', 'Nombre del padre (por confirmar)', { sexo: 'M', nac: '1945', padre: 'abuelo-p', certeza: 'baja' }),
        per('madre', 'Nombre de la madre (por confirmar)', { sexo: 'F', nac: '1948', certeza: 'baja' }),
        per('cuestionado', 'El Cuestionado', {
          sexo: 'M', nac: '1972', certeza: 'alta', padre: 'padre', madre: 'madre', parejas: ['pareja'],
          notas: 'Persona central del árbol. Cambia el nombre por el real en la pestaña Ficha.'
        }),
        per('pareja', 'Pareja o cónyuge (por confirmar)', { sexo: 'F', certeza: 'media', parejas: ['cuestionado'] }),
        per('hijo1', 'Hijo/a 1 (por confirmar)', { sexo: 'M', nac: '2001', padre: 'cuestionado', madre: 'pareja', certeza: 'media' }),
        per('hijo2', 'Hijo/a 2 (por confirmar)', { sexo: 'F', nac: '2005', padre: 'cuestionado', madre: 'pareja', certeza: 'media' }),
        per('nieto1', 'Nieto/a 1 (por confirmar)', { sexo: 'X', nac: '2024', padre: 'hijo1', certeza: 'baja' })
      ],
      aportes: [{
        id: 'a-demo', informante: 'Vecino del barrio', fecha: new Date().toISOString(), tipo: 'hijo',
        refNombre: 'El Cuestionado', nombre: 'Hijo/a 2 (por confirmar)', sexo: 'F', nac: '2005',
        certeza: 'media', fuente: 'https://ejemplo.com/nota', notas: 'Aparece en una nota de prensa.', aplicado: true
      }]
    };
  }

  /* --------------------------- eventos --------------------------- */
  function initEventos() {
    // --- tabs
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.tab').forEach(function (x) { x.classList.remove('active'); });
        $$('.tab-panel').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        $('#tab-' + t.dataset.tab).classList.add('active');
        var titulo = $('#sheetTitulo');
        if (titulo) titulo.textContent = t.dataset.tab === 'aporte' ? 'Aportar datos' : (t.dataset.tab === 'datos' ? 'Datos y ajustes' : 'Ficha');
        var p = $('#panel');
        if (p) p.scrollTop = 0;
      });
    });

    // --- canvas: arrastrar con un dedo, pellizcar con dos, rueda en escritorio.
    //     La captura del puntero es perezosa: sólo cuando el gesto pasa a ser un
    //     arrastre, para que los toques sobre tarjetas sigan siendo clics normales.
    var lienzo = $('#lienzo'), movido = false, punteros = new Map(), gesto = null;

    function posEnLienzo(e) {
      var r = lienzo.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function capturarTodos() {
      punteros.forEach(function (p, id) { try { lienzo.setPointerCapture(id); } catch (err) { } });
    }
    function centroYDistancia() {
      var ids = Array.from(punteros.keys());
      if (ids.length < 2) return null;
      var a = punteros.get(ids[0]).pos, b = punteros.get(ids[1]).pos;
      var dx = a.x - b.x, dy = a.y - b.y;
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.max(1, Math.sqrt(dx * dx + dy * dy)) };
    }
    function iniciarGesto() {
      var ids = Array.from(punteros.keys());
      if (ids.length >= 2) {
        var c = centroYDistancia();
        gesto = { tipo: 'pinch', mid0: c.mid, dist0: c.dist, zoom0: view.zoom, vx: view.x, vy: view.y };
        capturarTodos();
      } else if (ids.length === 1) {
        var p = punteros.get(ids[0]).pos;
        gesto = { tipo: 'espera', x0: p.x, y0: p.y, vx: view.x, vy: view.y };
      } else {
        gesto = null;
      }
    }
    lienzo.addEventListener('pointerdown', function (e) {
      punteros.set(e.pointerId, { pos: posEnLienzo(e) });
      movido = false;
      lienzo.classList.add('dragging');
      iniciarGesto();
    });
    lienzo.addEventListener('pointermove', function (e) {
      var p = punteros.get(e.pointerId);
      if (!p) return;
      p.pos = posEnLienzo(e);
      if (!gesto) return;
      if (gesto.tipo === 'espera') {
        var dx = p.pos.x - gesto.x0, dy = p.pos.y - gesto.y0;
        if (Math.sqrt(dx * dx + dy * dy) < 8) return;      // todavía puede ser un toque
        capturarTodos();                                    // ya es un arrastre
        gesto = { tipo: 'pan', x0: gesto.x0, y0: gesto.y0, vx: gesto.vx, vy: gesto.vy };
        movido = true;
      }
      if (gesto.tipo === 'pan') {
        var ddx = p.pos.x - gesto.x0, ddy = p.pos.y - gesto.y0;
        view.x = gesto.vx + ddx;
        view.y = gesto.vy + ddy;
        movido = true;
      } else if (gesto.tipo === 'pinch') {
        var c = centroYDistancia();
        if (!c) return;
        var z = Math.min(2.5, Math.max(0.15, gesto.zoom0 * (c.dist / gesto.dist0)));
        // el punto que estaba entre los dedos sigue entre los dedos
        var wx = (gesto.mid0.x - gesto.vx) / gesto.zoom0;
        var wy = (gesto.mid0.y - gesto.vy) / gesto.zoom0;
        view.zoom = z;
        view.x = c.mid.x - wx * z;
        view.y = c.mid.y - wy * z;
        movido = true;
      }
      aplicarVista();
    });
    function soltar(e) {
      if (!punteros.has(e.pointerId)) return;
      punteros.delete(e.pointerId);
      try { lienzo.releasePointerCapture(e.pointerId); } catch (err) { }
      if (punteros.size) { iniciarGesto(); }
      else {
        gesto = null;
        lienzo.classList.remove('dragging');
        movido = false;              // el siguiente toque vuelve a ser un toque, no un arrastre
      }
    }
    lienzo.addEventListener('pointerup', soltar);
    lienzo.addEventListener('pointercancel', soltar);
    lienzo.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        zoomEn(e.deltaY < 0 ? 1.08 : 0.926, e.clientX, e.clientY);
      }
    }, { passive: false });

    $('#btnZoomIn').addEventListener('click', function () { zoomEn(1.18); });
    $('#btnZoomOut').addEventListener('click', function () { zoomEn(0.85); });
    $('#btnFit').addEventListener('click', ajustarTodo);
    $$('[data-zoom]').forEach(function (b) {
      b.addEventListener('click', function () {
        var accion = b.dataset.zoom;
        if (accion === 'in') zoomEn(1.25);
        else if (accion === 'out') zoomEn(0.8);
        else if (accion === 'raiz') {
          if (state.meta.raizId && xs && xs.has(state.meta.raizId)) centrarEn(state.meta.raizId);
          else ajustarTodo();
        } else ajustarTodo();
      });
    });

    // --- hoja inferior: cerrar con la ✕, con el fondo o arrastrando hacia abajo
    var panel = $('#panel'), cabeza = $('#sheetHead'), arrastre = null;
    $('#btnCerrarPanel').addEventListener('click', cerrarPanel);
    $('#backdrop').addEventListener('click', cerrarPanel);
    if (cabeza) {
      cabeza.addEventListener('pointerdown', function (e) {
        if (e.target.closest && e.target.closest('button')) return;
        arrastre = { y0: e.clientY, dy: 0 };
        panel.classList.add('arrastrando');
        try { cabeza.setPointerCapture(e.pointerId); } catch (err) { }
      });
      cabeza.addEventListener('pointermove', function (e) {
        if (!arrastre) return;
        arrastre.dy = Math.max(0, e.clientY - arrastre.y0);
        panel.style.transform = 'translateY(' + arrastre.dy + 'px)';
      });
      function soltarCabeza(e) {
        if (!arrastre) return;
        var dy = arrastre.dy;
        arrastre = null;
        panel.classList.remove('arrastrando');
        panel.style.transform = '';
        try { cabeza.releasePointerCapture(e.pointerId); } catch (err) { }
        if (dy > 70) cerrarPanel();
      }
      cabeza.addEventListener('pointerup', soltarCabeza);
      cabeza.addEventListener('pointercancel', soltarCabeza);
    }

    // --- tarjetas
    $('#tarjetas').addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      var arrastrado = movido;   // si venimos de arrastrar el lienzo, ignoramos este clic
      movido = false;
      if (!card || arrastrado) return;
      seleccionar(card.dataset.id, false);
      abrirPanel('ficha');
    });
    $('#tarjetas').addEventListener('dblclick', function (e) {
      var card = e.target.closest('.card');
      if (card) centrarEn(card.dataset.id);
    });

    // --- ficha: guardar / raíz / eliminar
    $('#btnGuardar').addEventListener('click', function () {
      var p = byId(seleccion);
      if (!p) return;
      if (esAncestro(state, p.id, $('#fPadre').value) || esAncestro(state, p.id, $('#fMadre').value)) {
        aviso('Ese padre/madre crearía un ciclo familiar; revisa los vínculos.');
        return;
      }
      p.nombre = $('#fNombre').value.trim() || 'Sin nombre';
      p.alias = $('#fAlias').value.trim();
      p.sexo = $('#fSexo').value;
      p.nac = $('#fNac').value.trim();
      p.fall = $('#fFall').value.trim();
      p.lugar = $('#fLugar').value.trim();
      p.foto = $('#fFoto').value.trim();
      p.certeza = $('#fCerteza').value;
      p.notas = $('#fNotas').value;
      p.padre = $('#fPadre').value;
      p.madre = $('#fMadre').value;
      p.fuentes = $('#fFuentes').value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
        var partes = l.split('|');
        return { texto: (partes[0] || '').trim(), url: (partes[1] || '').trim() };
      });
      save(); render(true);
      aviso('Ficha guardada.');
    });
    $('#btnRaiz').addEventListener('click', function () {
      if (!seleccion) return;
      state.meta.raizId = seleccion;
      save(); render();
      aviso('“' + byId(seleccion).nombre + '” es ahora el cuestionado.');
    });
    $('#btnBorrar').addEventListener('click', function () { if (seleccion) eliminarPersona(seleccion); });

    // --- hijos / parejas
    $('#btnAddHijo').addEventListener('click', function () {
      var p = byId(seleccion); if (!p) return;
      var nombre = $('#nuevoHijo').value.trim();
      if (!nombre) return;
      var hijo = asegurarPersona(nombre);
      if (hijo.id === p.id) { aviso('No puedes añadirlo como su propio hijo.'); return; }
      if (esAncestro(state, hijo.id, p.id)) { aviso('Eso crearía un ciclo familiar.'); return; }
      if (p.sexo === 'F') hijo.madre = p.id; else hijo.padre = p.id;
      if (!hijo.certeza) hijo.certeza = 'media';
      $('#nuevoHijo').value = '';
      save(); render(true); pintarFicha();
    });
    $('#nuevoHijo').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#btnAddHijo').click(); });
    $('#nuevaPareja').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#btnAddPareja').click(); });
    $('#btnAddPareja').addEventListener('click', function () {
      var p = byId(seleccion); if (!p) return;
      var nombre = $('#nuevaPareja').value.trim();
      if (!nombre) return;
      var q = asegurarPersona(nombre);
      if (q.id === p.id) return;
      vincularPareja(p, q);
      $('#nuevaPareja').value = '';
      save(); render(true); pintarFicha();
    });
    $('#tab-ficha').addEventListener('click', function (e) {
      var p = byId(seleccion); if (!p) return;
      var qh = e.target.closest('[data-quitar-hijo]');
      if (qh) {
        var hijo = byId(qh.dataset.quitarHijo);
        if (hijo) { if (hijo.padre === p.id) hijo.padre = ''; if (hijo.madre === p.id) hijo.madre = ''; }
        save(); render(true); pintarFicha();
        return;
      }
      var qp = e.target.closest('[data-quitar-pareja]');
      if (qp) {
        p.parejas = p.parejas.filter(function (x) { return x !== qp.dataset.quitarPareja; });
        var otro = byId(qp.dataset.quitarPareja);
        if (otro) otro.parejas = otro.parejas.filter(function (x) { return x !== p.id; });
        save(); render(true); pintarFicha();
      }
    });

    // --- buscar
    $('#buscar').addEventListener('input', buscar);
    $('#buscar').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var primera = $('.card.match');
        if (primera) { seleccionar(primera.dataset.id, true); abrirTab('ficha'); }
      }
    });

    // --- modo aporte
    $('#btnModo').addEventListener('click', function () {
      var enAporte = $('#btnModo').dataset.modo === 'aporte';
      if (enAporte) {
        $('#btnModo').dataset.modo = '';
        $('#btnModo').textContent = 'Modo aporte';
        cerrarPanel();
        abrirTab('ficha');
      } else {
        $('#btnModo').dataset.modo = 'aporte';
        $('#btnModo').textContent = 'Volver a edición';
        abrirPanel('aporte');
        $('#aRef').value = byId(state.meta.raizId) ? byId(state.meta.raizId).nombre : '';
      }
    });

    // --- atajos rápidos de aporte
    $$('[data-quick]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#aTipo').value = b.dataset.quick;
        $('#aRef').value = byId(state.meta.raizId) ? byId(state.meta.raizId).nombre : '';
        $('#aNombre').focus();
      });
    });

    // --- guardar aporte
    $('#btnAporte').addEventListener('click', function () {
      var nombre = $('#aNombre').value.trim();
      if (!nombre) { aviso('Escribe el nombre del familiar.'); $('#aNombre').focus(); return; }
      var refNombre = $('#aRef').value.trim() || (byId(state.meta.raizId) ? byId(state.meta.raizId).nombre : 'El cuestionado');
      var aporte = registrarAporte({
        informante: $('#aInformante').value.trim(),
        tipo: $('#aTipo').value,
        refNombre: refNombre,
        nombre: nombre,
        sexo: $('#aSexo').value,
        nac: $('#aNac').value.trim(),
        certeza: $('#aCerteza').value,
        fuente: $('#aFuente').value.trim(),
        notas: $('#aNotas').value.trim()
      }, $('#aAplicar').checked);
      $('#aNombre').value = ''; $('#aNotas').value = ''; $('#aFuente').value = ''; $('#aNac').value = '';
      save(); render();
      pintarAportes();
      aviso('Aporte guardado' + (aporte.aplicado ? ' y aplicado al árbol.' : '.'));
    });

    $('#listaAportes').addEventListener('click', function (e) {
      var ap = e.target.closest('[data-aplicar-aporte]');
      if (ap) {
        var a = state.aportes.filter(function (x) { return x.id === ap.dataset.aplicarAporte; })[0];
        if (a) { aplicarAporte(a); save(); render(); pintarAportes(); aviso('Aporte aplicado al árbol.'); }
        return;
      }
      var bo = e.target.closest('[data-borrar-aporte]');
      if (bo) {
        state.aportes = state.aportes.filter(function (x) { return x.id !== bo.dataset.borrarAporte; });
        save(); pintarAportes();
      }
    });

    $('#btnEnviar').addEventListener('click', enviarAportes);
    $('#btnLink').addEventListener('click', copiarEnlace);
    $('#btnEnlaceDatos').addEventListener('click', compartirArbol);

    // --- datos
    $('#btnExportJson').addEventListener('click', exportarJSON);
    $('#btnCsv').addEventListener('click', exportarCSV);
    $('#btnGedcom').addEventListener('click', exportarGEDCOM);
    $('#btnPng').addEventListener('click', exportarPNG);
    $('#btnImportJson').addEventListener('click', function () { $('#archivoJson').click(); });
    $('#archivoJson').addEventListener('change', function (e) {
      var archivo = e.target.files && e.target.files[0];
      if (!archivo) return;
      var lector = new FileReader();
      lector.onload = function () {
        var modo = confirm('Aceptar = REEMPLAZAR todo el árbol actual.\nCancelar = FUSIONAR con lo que ya hay.');
        importarJSON(String(lector.result), modo ? 'reemplazar' : 'fusionar');
      };
      lector.readAsText(archivo);
      e.target.value = '';
    });
    $('#btnGuardarCfg').addEventListener('click', function () {
      state.meta.titulo = $('#cfgTitulo').value.trim() || CONF.titulo;
      state.meta.subtitulo = $('#cfgSubtitulo').value.trim();
      state.meta.endpoint = $('#cfgEndpoint').value.trim();
      state.meta.repoUrl = $('#cfgRepo').value.trim();
      save(); tituloHeader();
      aviso('Ajustes guardados.');
    });
    $('#btnCopiarCfg').addEventListener('click', function () {
      var txt = 'window.ARBOL_CONFIG = {\n' +
        "  titulo: '" + String(state.meta.titulo || '').replace(/'/g, "\\'") + "',\n" +
        "  subtitulo: '" + String(state.meta.subtitulo || '').replace(/'/g, "\\'") + "',\n" +
        "  endpoint: '" + String(state.meta.endpoint || '') + "',\n" +
        "  repoUrl: '" + String(state.meta.repoUrl || '') + "'\n};\n";
      copiar(txt, 'config.js copiado al portapapeles: pégalo en el archivo config.js del repositorio.');
    });
    $('#btnDemo').addEventListener('click', cargarDemo);
    $('#btnDemoDatos').addEventListener('click', cargarDemo);
    $('#btnNueva').addEventListener('click', function () {
      var p = nuevaPersona({ nombre: 'El cuestionado', certeza: 'alta' });
      state.meta.raizId = p.id;
      save(); render();
      seleccionar(p.id, true);
      abrirTab('ficha');
      $('#fNombre').focus();
      $('#fNombre').select();
    });
    $('#btnVaciar').addEventListener('click', function () {
      if (!confirm('¿Vaciar todo el árbol y los aportes guardados en este navegador?')) return;
      state = normalizeState(null);
      seleccion = null;
      save(); render(); pintarAportes();
    });
    $('#bannerCerrar').addEventListener('click', function () { $('#banner').hidden = true; });
    $('#bannerAccion').addEventListener('click', function () { if (bannerAccion) bannerAccion(); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        cerrarPanel();
        seleccion = null; pintarFicha();
        $$('.card').forEach(function (c) { c.classList.remove('seleccionada'); });
      }
    });
    window.addEventListener('hashchange', leerHash);
  }

  function buscar() {
    var q = norm($('#buscar').value);
    var hits = 0;
    $$('.card').forEach(function (c) {
      var p = byId(c.dataset.id);
      if (!p) return;
      var coincide = q && (norm(p.nombre).indexOf(q) !== -1 || norm(p.alias).indexOf(q) !== -1);
      c.classList.toggle('match', !!coincide);
      c.classList.toggle('dim', !!q && !coincide);
      if (coincide) hits++;
    });
    if (q) $('#stats').textContent = plural(hits, 'coincidencia', 'coincidencias');
    else if (state.personas.length) {
      $('#stats').textContent = plural(state.personas.length, 'persona', 'personas') + ' · ' +
        plural(state.aportes.length, 'aporte', 'aportes');
    }
  }

  function cargarDemo() {
    if (state.personas.length && !confirm('Esto reemplaza el árbol actual por datos de ejemplo. ¿Continuar?')) return;
    state = normalizeState(demo());
    save(); render(); pintarAportes();
    seleccionar(state.meta.raizId, false);
    aviso('Datos de ejemplo cargados. Edita los nombres para poner los reales.');
  }

  /* --------------------------- arranque --------------------------- */
  function arranque() {
    var teniaDatos = load();
    initEventos();
    tituloHeader();
    pintarAportes();
    render();
    estadoDatos();
    if (!teniaDatos) {
      // intenta leer data.json del propio repositorio (si se sirve por http/https)
      fetch('data.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('sin data.json');
        return r.json();
      }).then(function (datos) {
        if (state.personas.length) return;
        var entrante = normalizeState(datos);
        if (!entrante.personas.length) return;
        state = entrante;
        save(); render(); pintarAportes();
        aviso('Datos cargados desde data.json del repositorio.');
      }).catch(function () { });
    }
    leerHash();
    // al girar el móvil o cambiar el tamaño no se pierde el zoom ni el encuadre
    window.addEventListener('resize', function () { if (lay) aplicarVista(); });
    if (window.matchMedia) {
      try { window.matchMedia('(max-width: 900px)').addEventListener('change', function () { if (lay) fit(esMovil() ? 'ancho' : 'todo'); }); } catch (e) { }
    }
  }

  /* --------------------------- depuración --------------------------- */
  // Consola del navegador: ARBOL_DEBUG.demo(), .getState(), .layout(), etc.
  if (typeof window !== 'undefined') {
    window.ARBOL_DEBUG = {
      getState: function () { return state; },
      setState: function (s) { state = normalizeState(s); return state; },
      demo: demo,
      normalizeState: normalizeState,
      layout: computeLayout,
      orderRows: orderRows,
      positionRows: positionRows,
      edges: buildEdges,
      distancias: distancias,
      etiquetaRelacion: etiquetaRelacion,
      registrarAporte: registrarAporte,
      aplicarAporte: aplicarAporte,
      compartirArbol: compartirArbol,
      leerHash: leerHash,
      hayCrypto: hayCrypto,
      cifrarTexto: cifrarTexto,
      descifrarTexto: descifrarTexto,
      esMovil: esMovil,
      abrirPanel: abrirPanel,
      cerrarPanel: cerrarPanel,
      ajustarTodo: ajustarTodo,
      vista: function () { return { zoom: view.zoom, x: view.x, y: view.y }; }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arranque);
  else arranque();
})();
