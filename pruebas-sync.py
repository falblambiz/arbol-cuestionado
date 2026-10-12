#!/usr/bin/env python3
"""
 pruebas-sync.py — prueba la sincronización con gist SIN tocar tu cuenta de GitHub.

 Levanta un servidor local que imita la API de gists de GitHub (con CORS), abre la
 app en Chrome real apuntando a él y comprueba el ciclo completo entre dos
 "dispositivos": crear gist, subir, bajar, fusionar, conflictos y errores.

 Uso:   python3 pruebas-sync.py [ruta-de-la-app]
"""
import base64
import http.server
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
PUERTO_APP = 8141
PUERTO_FAKE = 8142
PUERTO_CDP = 9344
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


class GistFalso(http.server.BaseHTTPRequestHandler):
    """Imita POST/GET/PATCH /gists[/id] con las mismas formas de respuesta y CORS."""
    gists = {}
    peticiones = []
    cerrado_por_token = None

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-GitHub-Api-Version")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Content-Type", "application/json")

    def _responder(self, codigo, cuerpo):
        datos = json.dumps(cuerpo).encode()
        self.send_response(codigo)
        self._cors()
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _autorizado(self, exigir=True):
        cabecera = self.headers.get("Authorization", "")
        if "token-malo" in cabecera:
            self._responder(401, {"message": "Bad credentials"})
            return False
        if GistFalso.cerrado_por_token and GistFalso.cerrado_por_token in cabecera:
            self._responder(401, {"message": "Bad credentials"})
            return False
        # GitHub permite leer un gist secreto por su ID sin token;
        # sólo las escrituras exigen autorización.
        if exigir and not cabecera.startswith("Bearer "):
            self._responder(401, {"message": "Requires authentication"})
            return False
        return True

    def _conToken(self, exigir):
        return self._autorizado(exigir)

    def _cuerpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode())
        except Exception:
            return {}

    def do_GET(self):
        if not self._autorizado(exigir=False):
            return
        GistFalso.peticiones.append(("GET", self.path, None))
        ruta = self.path.split("?")[0]
        if ruta == "/gists":
            return self._responder(200, [{"id": g} for g in GistFalso.gists])
        partes = [p for p in ruta.split("/") if p]
        if len(partes) == 2 and partes[0] == "gists":
            gid = partes[1]
            if gid not in GistFalso.gists:
                return self._responder(404, {"message": "Not Found"})
            return self._responder(200, GistFalso.gists[gid])
        return self._responder(404, {"message": "Not Found"})

    def do_POST(self):
        if not self._autorizado():
            return
        cuerpo = self._cuerpo()
        GistFalso.peticiones.append(("POST", self.path, cuerpo))
        if self.path.split("?")[0] != "/gists":
            return self._responder(404, {"message": "Not Found"})
        gid = "g" + str(len(GistFalso.gists) + 1) + "f" * 20
        GistFalso.gists[gid] = {
            "id": gid,
            "description": cuerpo.get("description", ""),
            "public": bool(cuerpo.get("public", False)),
            "files": {k: {"filename": k, "content": v.get("content", ""), "size": len(v.get("content", ""))}
                      for k, v in (cuerpo.get("files") or {}).items()},
        }
        return self._responder(201, GistFalso.gists[gid])

    def do_PATCH(self):
        if not self._autorizado():
            return
        cuerpo = self._cuerpo()
        GistFalso.peticiones.append(("PATCH", self.path, cuerpo))
        partes = [p for p in self.path.split("?")[0].split("/") if p]
        if len(partes) != 2 or partes[0] != "gists" or partes[1] not in GistFalso.gists:
            return self._responder(404, {"message": "Not Found"})
        gist = GistFalso.gists[partes[1]]
        for nombre, contenido in (cuerpo.get("files") or {}).items():
            if contenido is None:
                gist["files"].pop(nombre, None)
            else:
                gist["files"][nombre] = {"filename": nombre, "content": contenido.get("content", ""),
                                         "size": len(contenido.get("content", ""))}
        return self._responder(200, gist)


def servir_directorio(carpeta, puerto):
    import functools
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=carpeta)
    handler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", puerto), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def servir_gist():
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PUERTO_FAKE), GistFalso)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# --------------------------- guion de la prueba ---------------------------
GUION = r"""
(async () => {
  const out = [];
  const ok = (t, c, extra) => out.push((c ? 'OK   ' : 'FALLA ') + t + (extra ? '  [' + extra + ']' : ''));
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));
  const D = window.ARBOL_DEBUG;
  const API = 'http://127.0.0.1:8142';

  const claves = {};   // almacenamiento falso por "dispositivo"
  const hacerEspacio = (nombre) => {
    const guardado = {};
    return {
      nombre,
      leer: () => JSON.parse(guardado.arbol || 'null'),
      guardar: (v) => { guardado.arbol = JSON.stringify(v); },
      crudo: (k) => guardado[k] || null,
      poner: (k, v) => { guardado[k] = v; },
      todo: () => guardado
    };
  };

  // Redirigimos el almacenamiento del módulo a espacios separados
  // (equivale a dos navegadores/dispositivos distintos).
  window.__espacio = null;
  const almacen = {
    getItem: (k) => { const e = window.__espacio; return e ? (e.todo()[k] || null) : null; },
    setItem: (k, v) => { const e = window.__espacio; if (e) e.poner(k, String(v)); },
    removeItem: (k) => { const e = window.__espacio; if (e) e.poner(k, undefined); }
  };
  Object.defineProperty(window, '__almacenFalso', { value: almacen });

  // La app lee localStorage global; le inyectamos el intercambiable
  const original = { getItem: localStorage.getItem, setItem: localStorage.setItem, removeItem: localStorage.removeItem };
  localStorage.getItem = almacen.getItem;
  localStorage.setItem = almacen.setItem;
  localStorage.removeItem = almacen.removeItem;

  window.confirm = () => true;
  window.prompt = () => 'clave-compartida';

  // ---------- Dispositivo 1 (iPhone): captura datos y configura la sync ----------
  const iphone = hacerEspacio('iphone');
  window.__espacio = iphone;
  D.sync.token = 'github_pat_falso_para_pruebas';
  D.sync.apiBase = API;
  D.sync.clave = 'clave-compartida';
  D.sync.gistId = '';
  D.guardarAjustesSync();
  D.sync.apiBase = API;

  // datos propios del iPhone: el cuestionado, su padre y un hijo
  const st = D.getState();
  st.personas.push({ id: 'p1', nombre: 'El Cuestionado', sexo: 'M', nac: '1972', certeza: 'alta', padre: 'p2', madre: '', parejas: [], fuentes: [] });
  st.personas.push({ id: 'p2', nombre: 'Anselmo Escobar', sexo: 'M', nac: '1945', certeza: 'alta', padre: '', madre: '', parejas: [], fuentes: [] });
  st.personas.push({ id: 'p3', nombre: 'Lucía Escobar', sexo: 'F', nac: '2001', certeza: 'alta', padre: 'p1', madre: '', parejas: [], fuentes: [] });
  st.meta.raizId = 'p1';
  st.aportes.push({ id: 'a1', informante: 'Tío', tipo: 'padre', refNombre: 'El Cuestionado', nombre: 'Anselmo Escobar', certeza: 'alta', aplicado: true });

  // ---------- crear gist ----------
  const creado = await D.subirAlGist(false);
  ok('crea el gist y sube desde el iPhone', creado === true && !!D.sync.gistId, D.sync.gistId || D.sync.ultimoError);
  const gistId = D.sync.gistId;
  const respuestaGist = await fetch(API + '/gists/' + gistId);
  const textoGist = await respuestaGist.text();
  ok('el simulador devuelve el gist', respuestaGist.status === 200 && textoGist.length > 20,
     'HTTP ' + respuestaGist.status + ' · ' + textoGist.slice(0, 120));
  const gist = textoGist ? JSON.parse(textoGist) : {};
  const archivos = gist.files || {};
  const contenido = (archivos['arbol.json'] || {}).content || '';
  ok('en el gist hay un solo archivo', Object.keys(archivos).length === 1, Object.keys(archivos).join(','));
  ok('el gist es secreto (public=false)', gist.public === false);
  ok('el contenido está cifrado, sin nombres legibles',
     !/Cuestionado|Escobar|Lucía/.test(contenido) && contenido.length > 100, contenido.slice(0, 24) + '…');

  // ---------- Dispositivo 2 (Mac Mini): árbol distinto, baja y fusiona ----------
  const mac = hacerEspacio('mac');
  window.__espacio = mac;
  D.setState({ meta: { raizId: 'x1' }, personas: [{ id: 'x1', nombre: 'Dato de prueba del Mac', sexo: '', certeza: 'media' }], aportes: [] });
  D.guardarAjustesSync();
  D.sync.token = 'github_pat_falso_para_pruebas';
  D.sync.clave = 'clave-compartida';
  D.sync.gistId = gistId;
  D.guardarAjustesSync();
  ok('el Mac empieza con su propio árbol', D.getState().personas.length === 1, String(D.getState().personas.length));

  await D.bajarDelGist({ silencioso: true });
  const trasBajar = D.getState();
  ok('el Mac recibe las 3 personas del iPhone', trasBajar.personas.filter(p => ['El Cuestionado', 'Anselmo Escobar', 'Lucía Escobar'].includes(p.nombre)).length === 3,
     trasBajar.personas.map(p => p.nombre).join(' | '));
  out.push('     · árbol del Mac tras fusionar: ' + trasBajar.personas.map(p => p.nombre).join(' | ') +
           ' · ' + trasBajar.aportes.length + ' aporte(s)');
  ok('el Mac conserva su propio dato', !!trasBajar.personas.filter(p => p.nombre === 'Dato de prueba del Mac')[0]);
  ok('no se duplican personas', trasBajar.personas.length === 4, String(trasBajar.personas.length));
  const nCuestionado = trasBajar.personas.filter(p => p.nombre === 'El Cuestionado')[0];
  const nAnselmo = trasBajar.personas.filter(p => p.nombre === 'Anselmo Escobar')[0];
  const nLucia = trasBajar.personas.filter(p => p.nombre === 'Lucía Escobar')[0];
  ok('el padre quedó enlazado tras fusionar', !!nCuestionado && !!nAnselmo && nCuestionado.padre === nAnselmo.id,
     nCuestionado ? ('padre=' + JSON.stringify(nCuestionado.padre)) : 'falta El Cuestionado');
  ok('la hija quedó enlazada con su padre', !!nLucia && !!nCuestionado && nLucia.padre === nCuestionado.id,
     nLucia ? ('padre=' + JSON.stringify(nLucia.padre)) : 'falta Lucía');
  ok('el apunte del iPhone llegó al Mac', trasBajar.aportes.length === 1, String(trasBajar.aportes.length));

  // ---------- el Mac añade a la madre y sube ----------
  const stMac = D.getState();
  const hijo = stMac.personas.filter(p => p.nombre === 'El Cuestionado')[0];
  ok('el Mac tiene a El Cuestionado para editar', !!hijo, stMac.personas.map(p => p.nombre).join(' | '));
  stMac.personas.push({ id: 'm1', nombre: 'Fernanda Vergara', sexo: 'F', nac: '1948', certeza: 'alta', padre: '', madre: '', parejas: [], fuentes: [] });
  if (hijo) hijo.madre = 'm1';
  const subido2 = await D.subirAlGist(false);
  ok('el Mac sube su cambio', subido2 === true, D.sync.ultimoError || 'ok');

  // ---------- el iPhone baja y ve la madre ----------
  window.__espacio = iphone;
  await D.bajarDelGist({ silencioso: true });
  const stIphone2 = D.getState();
  ok('el iPhone recibe a la madre', !!stIphone2.personas.filter(p => p.nombre === 'Fernanda Vergara')[0]);
  ok('el iPhone no duplicó al cuestionado', stIphone2.personas.filter(p => p.nombre === 'El Cuestionado').length === 1,
     String(stIphone2.personas.filter(p => p.nombre === 'El Cuestionado').length));
  const iCuestionado = stIphone2.personas.filter(p => p.nombre === 'El Cuestionado')[0];
  const iMadre = stIphone2.personas.filter(p => p.nombre === 'Fernanda Vergara')[0];
  ok('el vínculo madre quedó aplicado en el iPhone', !!iCuestionado && !!iMadre && iCuestionado.madre === iMadre.id,
     iCuestionado ? ('madre=' + JSON.stringify(iCuestionado.madre)) : 'falta El Cuestionado');

  // ---------- conflicto: el iPhone con datos viejos intenta subir ----------
  // Partimos de una situación distinta de la real: el iPhone NO ha bajado el
  // cambio de la madre, así que su copia local es anterior a la del gist.
  window.__espacio = iphone;
  D.setState({ meta: { raizId: 'p1' }, personas: [
    { id: 'p1', nombre: 'El Cuestionado', sexo: 'M', nac: '1972', certeza: 'alta', padre: 'p2', madre: '', parejas: [], fuentes: [] },
    { id: 'p2', nombre: 'Anselmo Escobar', sexo: 'M', nac: '1945', certeza: 'alta', padre: '', madre: '', parejas: [], fuentes: [] }
  ], aportes: [] });
  D.sync.ultimoContenidoSubido = 'contenido-de-una-version-anterior';
  D.sync.alDia = false;
  const subidaConConflicto = await D.subirAlGist(false);
  ok('no pisa el gist si hay cambios remotos sin bajar', subidaConConflicto === false, D.sync.ultimoError || 'bloqueado');
  ok('avisa del conflicto', document.getElementById('bannerTexto').textContent.indexOf('no se ha subido') !== -1,
     document.getElementById('bannerTexto').textContent);
  const gistTrasConflicto = await (await fetch(API + '/gists/' + gistId)).json();
  const archivosTrasConflicto = gistTrasConflicto.files || {};
  const contenidoTrasConflicto = (archivosTrasConflicto['arbol.json'] || {}).content || '';
  let descifrado = '';
  try { descifrado = await D.descifrarTexto(contenidoTrasConflicto, 'clave-compartida'); } catch (e) { descifrado = 'ERROR: ' + e.message; }
  out.push('     · contenido del gist en el momento del conflicto: ' + descifrado.slice(0, 50) + '…');
  ok('el gist conserva lo bueno: la madre que subió el Mac', descifrado.indexOf('Fernanda Vergara') !== -1 &&
     descifrado.indexOf('El Cuestionado') !== -1, descifrado.slice(0, 70));
  ok('el gist NO contiene la versión recortada del iPhone', descifrado.indexOf('Lucía Escobar') !== -1,
     descifrado.indexOf('Lucía Escobar') === -1 ? '¡el iPhone la pisó!' : 'intacta');

  // ---------- tras bajar y fusionar, el iPhone ya puede subir ----------
  document.getElementById('bannerAccion').click();     // «Bajar y fusionar»
  await esperar(1200);
  const subidaOk = await D.subirAlGist(false);
  ok('tras fusionar, el iPhone sube sin problema', subidaOk === true, D.sync.ultimoError || 'ok');
  ok('el iPhone ya tiene a la madre del Mac',
     !!D.getState().personas.filter(p => p.nombre === 'Fernanda Vergara')[0],
     D.getState().personas.map(p => p.nombre).join(' | '));

  // ---------- caso crítico: el Mac edita DESPUÉS de que el iPhone suba ----------
  window.__espacio = mac;
  D.sync.ultimoContenidoSubido = 'otra-version-anterior';   // el Mac no ha visto la última subida
  D.sync.alDia = false;
  const macIntenta = await D.subirAlGist(false);
  ok('el Mac tampoco pisa lo del iPhone a ciegas', macIntenta === false, D.sync.ultimoError || 'bloqueado');
  D.sync.alDia = true;                                      // el Mac ya está al día (lo normal tras bajar)
  const macSube = await D.subirAlGist(false);
  ok('con el Mac al día, su edición sí sube', macSube === true, D.sync.ultimoError || 'ok');

  window.__espacio = iphone;
  await D.bajarDelGist({ silencioso: true });
  const gistFinal = await (await fetch(API + '/gists/' + gistId)).json();
  let finalDescifrado = '';
  try { finalDescifrado = await D.descifrarTexto(((gistFinal.files || {})['arbol.json'] || {}).content || '', 'clave-compartida'); }
  catch (e) { finalDescifrado = 'ERROR'; }
  const finalJson = JSON.parse(finalDescifrado);
  const nombresFinal = finalJson.datos.personas.map(p => p.nombre);
  ok('nadie perdió datos: están las 5 personas', nombresFinal.length === 5, nombresFinal.join(' | '));
  ok('están el cuestionado, sus padres, su hija y el dato del Mac',
     ['El Cuestionado', 'Anselmo Escobar', 'Fernanda Vergara', 'Lucía Escobar', 'Dato de prueba del Mac']
       .every(n => nombresFinal.indexOf(n) !== -1), nombresFinal.join(' | '));

  // ---------- errores ----------
  D.sync.token = 'token-malo';
  const fallo = await D.bajarDelGist({ silencioso: true });
  ok('token inválido: falla con aviso claro', fallo === false && !!D.sync.ultimoError, D.sync.ultimoError || '(sin mensaje)');
  out.push('     · mensaje con token inválido: ' + D.sync.ultimoError);
  D.sync.token = 'github_pat_falso_para_pruebas';
  await D.bajarDelGist({ silencioso: true });
  ok('tras arreglar el token vuelve a sincronizar', !D.sync.ultimoError, D.sync.ultimoError || 'sin error');

  D.sync.gistId = 'no-existe-000';
  const falloGist = await D.bajarDelGist({ silencioso: true });
  ok('gist inexistente: avisa', falloGist === false && /no encontrado/i.test(D.sync.ultimoError), D.sync.ultimoError);
  D.sync.gistId = gistId;

  D.sync.clave = 'otra-contraseña';
  const falloClave = await D.bajarDelGist({ silencioso: true });
  ok('contraseña distinta: no puede descifrar y lo dice', falloClave === false && /descifr|contraseña|error/i.test(D.sync.ultimoError),
     D.sync.ultimoError);
  D.sync.clave = 'clave-compartida';
  await D.bajarDelGist({ silencioso: true });

  // ---------- el panel muestra el estado ----------
  D.pintarSync();
  ok('el panel muestra el estado de sincronización',
     /Sincronizado|Error|Subiendo|Bajando/.test(document.getElementById('syncEstado').textContent),
     document.getElementById('syncEstado').textContent);
  ok('el panel tiene los campos de configuración',
     !!document.getElementById('syncToken') && !!document.getElementById('syncClave') &&
     !!document.getElementById('syncGistId') && !!document.getElementById('btnSyncOlvidar'));

  // restauramos el almacenamiento real
  localStorage.getItem = original.getItem;
  localStorage.setItem = original.setItem;
  localStorage.removeItem = original.removeItem;
  return out.join('\n');
})()
"""


def main():
    carpeta = AQUI
    for arg in sys.argv[1:]:
        if not arg.startswith("http"):
            carpeta = arg

    # la app apunta a la API falsa: parcheamos el módulo al vuelo desde la prueba
    app_original = open(os.path.join(carpeta, "app.js"), encoding="utf-8").read()
    app_parcheada = app_original.replace(
        "fetch('https://api.github.com' + ruta", "fetch((window.__apiGist || 'https://api.github.com') + ruta")
    if app_parcheada == app_original:
        # el parche es sólo para la prueba: si no encaja, no tocamos tu cuenta
        print("AVISO: no se pudo redirigir la API al simulador; se aborta para no usar GitHub de verdad.")
        return 1

    import tempfile
    tmp = tempfile.mkdtemp(prefix="arbol-sync-")
    for f in ("index.html", "styles.css", "config.js", "data.json", "manifest.json", "icono-192.png", "icono-512.png"):
        src = os.path.join(carpeta, f)
        if os.path.exists(src):
            open(os.path.join(tmp, f), "wb").write(open(src, "rb").read())
    open(os.path.join(tmp, "app.js"), "w", encoding="utf-8").write(app_parcheada)
    # el simulador también responde a /--peticiones y sirve el listado de gists
    servidor_app = servir_directorio(tmp, PUERTO_APP)
    servidor_gist = servir_gist()

    perfil = tempfile.mkdtemp(prefix="arbol-sync-perfil")
    chrome = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
         "--window-size=1200,900",
         f"--remote-debugging-port={PUERTO_CDP}", f"--user-data-dir={perfil}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("pn", os.path.join(carpeta, "pruebas-navegador.py"))
        pn = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pn)

        ws_url = None
        for _ in range(60):
            try:
                info = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PUERTO_CDP}/json/list", timeout=2))
                pag = [t for t in info if t.get("type") == "page"]
                if pag:
                    ws_url = pag[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.5)
        if not ws_url:
            print("No se pudo conectar con Chrome.")
            return 1
        ws = pn.ws_conectar("127.0.0.1", PUERTO_CDP, ws_url.split(f":{PUERTO_CDP}", 1)[1])
        pn.cdp(ws, "Page.enable")
        pn.cdp(ws, "Runtime.enable")
        pn.cdp(ws, "Page.navigate", {"url": f"http://127.0.0.1:{PUERTO_APP}/index.html"})
        time.sleep(2.5)
        pn.cdp(ws, "Runtime.evaluate", {
            "expression": f"window.__apiGist = 'http://127.0.0.1:{PUERTO_FAKE}';", "returnByValue": True})
        res = pn.cdp(ws, "Runtime.evaluate", {
            "expression": GUION, "awaitPromise": True, "returnByValue": True}, timeout=120)
        if res.get("exceptionDetails"):
            print("Excepción en la página:", json.dumps(res["exceptionDetails"])[:800])
            return 1
        print(res["result"]["value"])
        return 0
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except Exception:
            chrome.kill()
        servidor_app.shutdown()
        servidor_gist.shutdown()


if __name__ == "__main__":
    sys.exit(main())
