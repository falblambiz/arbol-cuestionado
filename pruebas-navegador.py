#!/usr/bin/env python3
"""
 pruebas-navegador.py — verifica la app en Chrome de verdad (sin capturas de pantalla).

 Usa el protocolo de depuración de Chrome (CDP) para abrir la página, ejecutar
 comprobaciones dentro del navegador real y devolver el informe como texto.
 Comprueba sobre todo el cifrado de enlaces (WebCrypto: PBKDF2 + AES-GCM),
 que no se puede verificar de forma fiable fuera del navegador.

 Uso:   python3 pruebas-navegador.py [ruta-de-la-app]
 Requiere: Google Chrome instalado.
"""
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PUERTO_APP = 8131
PUERTO_CDP = 9333


# --------------------------- servidor estático ---------------------------
def servir(carpeta):
    import http.server
    import functools
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=carpeta)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PUERTO_APP), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# --------------------------- cliente WebSocket mínimo ---------------------------
def ws_conectar(host, puerto, ruta):
    s = socket.create_connection((host, puerto), timeout=30)
    clave = base64.b64encode(os.urandom(16)).decode()
    peticion = (
        f"GET {ruta} HTTP/1.1\r\nHost: {host}:{puerto}\r\nUpgrade: websocket\r\n"
        f"Connection: Upgrade\r\nSec-WebSocket-Key: {clave}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(peticion.encode())
    datos = b""
    while b"\r\n\r\n" not in datos:
        trozo = s.recv(4096)
        if not trozo:
            raise RuntimeError("sin respuesta en el handshake")
        datos += trozo
    if b"101" not in datos.split(b"\r\n")[0]:
        raise RuntimeError("handshake rechazado: " + datos[:120].decode("utf-8", "replace"))
    return s


def ws_enviar(s, texto):
    carga = texto.encode()
    cabecera = b"\x81"
    n = len(carga)
    if n < 126:
        cabecera += bytes([0x80 | n])
    elif n < 65536:
        cabecera += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        cabecera += bytes([0x80 | 127]) + struct.pack(">Q", n)
    mascara = os.urandom(4)
    s.sendall(cabecera + mascara + bytes(b ^ mascara[i % 4] for i, b in enumerate(carga)))


def ws_recibir(s):
    def leer(n):
        d = b""
        while len(d) < n:
            trozo = s.recv(n - len(d))
            if not trozo:
                raise EOFError("conexión cerrada")
            d += trozo
        return d

    b1, b2 = leer(2)
    largo = b2 & 0x7F
    if largo == 126:
        largo = struct.unpack(">H", leer(2))[0]
    elif largo == 127:
        largo = struct.unpack(">Q", leer(8))[0]
    if b2 & 0x80:
        leer(4)
    return leer(largo).decode("utf-8", "replace")


def cdp(ws, metodo, params=None, timeout=60):
    ident = cdp.contador = getattr(cdp, "contador", 0) + 1
    ws_enviar(ws, json.dumps({"id": ident, "method": metodo, "params": params or {}}))
    limite = time.time() + timeout
    while time.time() < limite:
        mensaje = json.loads(ws_recibir(ws))
        if mensaje.get("id") == ident:
            if "error" in mensaje:
                raise RuntimeError(f"{metodo}: {mensaje['error']}")
            return mensaje.get("result", {})
    raise TimeoutError(f"sin respuesta a {metodo}")


# --------------------------- comprobaciones dentro de la página ---------------------------
COMPROBACIONES = r"""
(async () => {
  const out = [];
  const ok = (t, c, extra) => out.push((c ? 'OK   ' : 'FALLA ') + t + (extra ? '  [' + extra + ']' : ''));
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));
  const D = window.ARBOL_DEBUG;
  const medir = 'Datos privados: padre = Juan Perez, hija = Ana Perez';

  ok('la app expone ARBOL_DEBUG', !!D);
  ok('WebCrypto disponible', D.hayCrypto());

  // --- cifrado ---
  const cif1 = await D.cifrarTexto(medir, 'clave1234');
  const cif2 = await D.cifrarTexto(medir, 'clave1234');
  ok('cifra sin exponer el texto', cif1.indexOf('Juan') === -1 && cif1.length > 40, cif1.length + ' caracteres');
  let bin = '';
  try { bin = atob(cif1.replace(/-/g, '+').replace(/_/g, '/')); } catch (e) {}
  ok('el binario no contiene el texto original', bin.indexOf('Juan') === -1);
  ok('cada enlace es distinto (salt+iv aleatorios)', cif1 !== cif2);
  const vuelto = await D.descifrarTexto(cif1, 'clave1234');
  ok('descifra con la contraseña correcta', vuelto === medir);
  let rechazado = false;
  try { await D.descifrarTexto(cif1, 'clave-mala'); } catch (e) { rechazado = true; }
  ok('rechaza la contraseña incorrecta', rechazado);

  // --- interfaz: cargar demo ---
  window.confirm = () => true;
  document.getElementById('btnDemo').click();
  await esperar(60);
  const tarjetas = document.querySelectorAll('#tarjetas .card').length;
  ok('el demo pinta 8 tarjetas en el DOM real', tarjetas === 8, tarjetas + ' tarjetas');
  ok('hay aristas dibujadas en el SVG', document.querySelectorAll('#aristas path').length === 7,
     document.querySelectorAll('#aristas path').length + ' aristas');
  const tarjetaRaiz = document.querySelector('#tarjetas .card.raiz');
  ok('la tarjeta raíz tiene tamaño real', tarjetaRaiz.offsetWidth === 208 && tarjetaRaiz.offsetHeight === 80,
     tarjetaRaiz.offsetWidth + 'x' + tarjetaRaiz.offsetHeight);
  const rectLienzo = document.getElementById('lienzo').getBoundingClientRect();
  const fuera = Array.from(document.querySelectorAll('#tarjetas .card')).filter(c => {
    const r = c.getBoundingClientRect();
    return r.left < rectLienzo.left - 2 || r.right > rectLienzo.right + 2 || r.top < rectLienzo.top - 2 || r.bottom > rectLienzo.bottom + 2;
  }).length;
  ok('“Ajustar” deja todo el árbol dentro del lienzo', fuera === 0, fuera + ' tarjetas fuera');
  ok('sin desbordes horizontales en escritorio', document.documentElement.scrollWidth <= window.innerWidth + 1,
     document.documentElement.scrollWidth + ' vs ' + window.innerWidth);

  // --- enlace cifrado del árbol, generado por la interfaz ---
  let copiado = '';
  navigator.clipboard.writeText = (t) => { copiado = t; return Promise.resolve(); };
  let contrasenas = 0;
  window.prompt = () => { contrasenas++; return 'clave1234'; };
  window.confirm = () => true;
  document.getElementById('btnEnlaceDatos').click();
  await esperar(400);
  ok('la interfaz genera un enlace cifrado', copiado.indexOf('#datos-c=') !== -1, copiado.slice(0, 48) + '…');
  ok('el enlace no lleva nombres legibles', !/(Cuestionado|Renombrado|Escobar|Madre)/.test(copiado));
  ok('pide contraseña una sola vez', contrasenas === 1, String(contrasenas));

  // --- abrir el enlace recibido (otra pestaña lógica: mismo navegador) ---
  const antes = D.getState().personas.length;
  history.replaceState(null, '', location.pathname);   // partimos de un hash limpio
  const parteCifrada = copiado.slice(copiado.indexOf('#'));
  location.hash = parteCifrada;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await esperar(60);
  ok('avisa de que el enlace viene cifrado', document.getElementById('bannerTexto').textContent.indexOf('cifrado') !== -1,
     document.getElementById('bannerTexto').textContent);
  ok('ofrece abrirlo', !document.getElementById('bannerAccion').hidden);
  document.getElementById('bannerAccion').click();
  await esperar(400);
  ok('descifra y avisa del contenido', document.getElementById('bannerTexto').textContent.indexOf('Árbol recibido') !== -1,
     document.getElementById('bannerTexto').textContent);
  document.getElementById('bannerAccion').click();
  await esperar(120);
  ok('fusiona sin duplicar personas', D.getState().personas.length === antes,
     antes + ' → ' + D.getState().personas.length);

  // --- enlace normal (sin cifrar) y aviso ---
  window.confirm = () => false;
  copiado = '';
  document.getElementById('btnEnlaceDatos').click();
  await esperar(60);
  ok('sin contraseña avisa de que va sin cifrar', copiado.indexOf('#datos=') !== -1 &&
     document.getElementById('bannerTexto').textContent.indexOf('SIN cifrar') !== -1,
     document.getElementById('bannerTexto').textContent);

  // --- persistencia real (localStorage del navegador) ---
  const guardado = JSON.parse(localStorage.getItem('arbol-genealogico/v1'));
  ok('guarda en localStorage del navegador', guardado && guardado.personas.length === 8, guardado ? guardado.personas.length + ' personas' : 'nada');

  const fallos = out.filter(l => l.indexOf('FALLA') === 0).length;
  out.push('');
  out.push('====================  ' + (out.length - 2 - fallos) + '/' + (out.length - 2) + ' comprobaciones en Chrome real  ====================');
  return out.join('\n');
})()
"""


MOBILE_COMPROBACIONES = r"""
(async () => {
  const out = [];
  const ok = (t, c, extra) => out.push((c ? 'OK   ' : 'FALLA ') + t + (extra ? '  [' + extra + ']' : ''));
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));
  const D = window.ARBOL_DEBUG;
  ok('la app detecta el modo móvil', D.esMovil());
  window.confirm = () => true;
  document.getElementById('btnDemo').click();
  await esperar(80);

  const vp = window.innerHeight, vpW = window.innerWidth;
  const lienzo = document.getElementById('lienzo').getBoundingClientRect();
  ok('el lienzo ocupa la pantalla', lienzo.height > vp * 0.6, Math.round(lienzo.height) + ' de ' + Math.round(vp) + 'px');
  ok('el lienzo ocupa todo el ancho', lienzo.width >= vpW * 0.98, Math.round(lienzo.width) + ' de ' + vpW + 'px');
  ok('el lienzo no se sale por abajo', lienzo.bottom <= vp + 1, Math.round(lienzo.bottom) + ' vs ' + vp);
  ok('sin desbordes horizontales', document.documentElement.scrollWidth <= vpW + 1,
     document.documentElement.scrollWidth + ' vs ' + vpW);
  const campo = document.getElementById('fNombre');
  ok('campos a 16px (iOS no hace zoom al enfocar)', parseFloat(getComputedStyle(campo).fontSize) >= 16,
     getComputedStyle(campo).fontSize);
  const z = D.vista().zoom;
  const anchoTarjeta = document.querySelector('#tarjetas .card').offsetWidth * z;
  ok('tarjetas legibles sin tocar nada', anchoTarjeta >= 110, Math.round(anchoTarjeta) + 'px de ancho');
  const flotantes = Array.from(document.querySelectorAll('.zoom-flotante .icon'));
  ok('controles flotantes visibles y de 44px+', flotantes.length === 4 &&
     flotantes.every(b => b.getBoundingClientRect().width >= 44),
     flotantes.length + ' botones de ' + Math.round(flotantes[0].getBoundingClientRect().width) + 'px');
  ok('los zoom del encabezado se ocultan en móvil',
     getComputedStyle(document.querySelector('.tools .zoom')).display === 'none');
  ok('la leyenda de escritorio se oculta', getComputedStyle(document.querySelector('.leyenda .chip')).display === 'none');
  ok('misma clave de almacenamiento (tus datos sobreviven)',
     !!localStorage.getItem('arbol-genealogico/v1'), localStorage.getItem('arbol-genealogico/v1') ? 'presente' : 'ausente');
  ok('la hoja arranca cerrada', !document.getElementById('panel').classList.contains('abierto'));
  out.push('');
  out.push('COORDENADAS_LIENZO ' + JSON.stringify({ x: Math.round(lienzo.left + lienzo.width / 2), y: Math.round(lienzo.bottom - 90) }));
  out.push('ZOOM_INICIAL ' + z);
  return out.join('\n');
})()
"""

ESTADO_PANEL = r"""
(() => {
  const panel = document.getElementById('panel');
  const fondo = document.getElementById('backdrop');
  return JSON.stringify({
    abierto: panel.classList.contains('abierto'),
    cuerpo: document.body.classList.contains('panel-abierto'),
    transform: getComputedStyle(panel).transform,
    fondoVisible: getComputedStyle(fondo).display !== 'none',
    fichaActiva: document.getElementById('tab-ficha').classList.contains('active'),
    tituloHoja: (document.getElementById('sheetTitulo') || {}).textContent || '',
    zoom: window.ARBOL_DEBUG.vista().zoom
  });
})()
"""


def toque(ws, tipo, puntos):
    cdp(ws, "Input.dispatchTouchEvent", {"type": tipo, "touchPoints": puntos})


def fase_movil(ws, url):
    """Simula un iPhone: métricas, toques y pellizco reales."""
    salida = []
    cdp(ws, "Emulation.setDeviceMetricsOverride", {
        "width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": True
    })
    cdp(ws, "Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    cdp(ws, "Page.reload", {"ignoreCache": True})
    time.sleep(3)

    def evaluar(expr):
        return cdp(ws, "Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True},
                   timeout=60)["result"].get("value")

    informe = evaluar(MOBILE_COMPROBACIONES)
    lienzo, zoom0 = None, None
    for linea in informe.split("\n"):
        if linea.startswith("COORDENADAS_LIENZO "):
            lienzo = json.loads(linea.split(" ", 1)[1])
        elif linea.startswith("ZOOM_INICIAL "):
            zoom0 = float(linea.split(" ", 1)[1])
        else:
            salida.append(linea)

    # --- pellizco para ampliar (con la hoja cerrada) ---
    x, y = lienzo["x"], lienzo["y"]
    for separacion in (60, 120, 190):
        toque(ws, "touchStart", [
            {"x": x - separacion // 2, "y": y, "radiusX": 10, "radiusY": 10, "force": 1, "id": 1},
            {"x": x + separacion // 2, "y": y, "radiusX": 10, "radiusY": 10, "force": 1, "id": 2},
        ])
        time.sleep(0.08)
        for paso in range(1, 5):
            sep = separacion + paso * 30
            toque(ws, "touchMove", [
                {"x": x - sep // 2, "y": y, "radiusX": 10, "radiusY": 10, "force": 1, "id": 1},
                {"x": x + sep // 2, "y": y, "radiusX": 10, "radiusY": 10, "force": 1, "id": 2},
            ])
            time.sleep(0.05)
        toque(ws, "touchEnd", [])
        time.sleep(0.1)
    estado = json.loads(evaluar(ESTADO_PANEL))
    salida.append(("OK   " if estado["zoom"] > zoom0 * 1.3 else "FALLA ") + "el pellizco amplía el árbol" +
                  "  [zoom " + str(round(zoom0, 2)) + " → " + str(round(estado["zoom"], 2)) + "]")

    # --- un dedo: arrastre ---
    vista0 = json.loads(evaluar("JSON.stringify(window.ARBOL_DEBUG.vista())"))
    toque(ws, "touchStart", [{"x": x, "y": y, "radiusX": 10, "radiusY": 10, "force": 1, "id": 1}])
    time.sleep(0.1)
    for paso in (30, 60, 90):
        toque(ws, "touchMove", [{"x": x + paso, "y": y - paso // 2, "radiusX": 10, "radiusY": 10, "force": 1, "id": 1}])
        time.sleep(0.06)
    toque(ws, "touchEnd", [])
    time.sleep(0.25)
    vista1 = json.loads(evaluar("JSON.stringify(window.ARBOL_DEBUG.vista())"))
    salida.append(("OK   " if abs(vista1["x"] - vista0["x"]) > 40 else "FALLA ") + "un dedo desplaza el árbol" +
                  "  [x " + str(round(vista0["x"])) + " → " + str(round(vista1["x"])) + "]")

    # --- «ver todo» y toque en una tarjeta ---
    evaluar("window.ARBOL_DEBUG.ajustarTodo();")
    time.sleep(0.35)
    zoomTodo = json.loads(evaluar(ESTADO_PANEL))["zoom"]
    salida.append(("OK   " if zoomTodo < estado["zoom"] else "FALLA ") + "«ver todo» encaja el árbol completo" +
                  "  [zoom " + str(round(zoomTodo, 2)) + "]")
    coords = json.loads(evaluar(
        "JSON.stringify((()=>{const c=document.querySelector('#tarjetas .card.raiz').getBoundingClientRect();"
        "return {x: Math.round(c.left+c.width/2), y: Math.round(c.top+c.height/2), alto: Math.round(c.height),"
        "visible: c.top>0 && c.bottom<window.innerHeight};})())"))
    salida.append(("OK   " if coords["visible"] else "FALLA ") + "el cuestionado queda visible en pantalla")

    punto = {"x": coords["x"], "y": coords["y"], "radiusX": 12, "radiusY": 12, "force": 1, "id": 1}
    toque(ws, "touchStart", [punto])
    time.sleep(0.12)
    toque(ws, "touchEnd", [])
    time.sleep(0.5)
    estado = json.loads(evaluar(ESTADO_PANEL))
    salida.append(("OK   " if estado["abierto"] else "FALLA ") + "un toque en la tarjeta abre la hoja" +
                  ("  [abierto]" if estado["abierto"] else "  [no se abrió]"))
    salida.append(("OK   " if estado["fondoVisible"] else "FALLA ") + "aparece el fondo oscurecido")
    salida.append(("OK   " if estado["fichaActiva"] else "FALLA ") + "la hoja abre en la pestaña Ficha")
    salida.append(("OK   " if estado["transform"] in ("matrix(1, 0, 0, 1, 0, 0)", "none") else "FALLA ") +
                  "la hoja queda dentro de la pantalla  [" + estado["transform"] + "]")

    # --- cerrar tocando el fondo, y luego con la ✕ ---
    toque(ws, "touchStart", [{"x": 195, "y": 30, "radiusX": 10, "radiusY": 10, "force": 1, "id": 1}])
    time.sleep(0.1)
    toque(ws, "touchEnd", [])
    time.sleep(0.4)
    estado = json.loads(evaluar(ESTADO_PANEL))
    salida.append(("OK   " if not estado["abierto"] else "FALLA ") + "tocar el fondo cierra la hoja")

    # --- sin desbordes tras todo el ejercicio ---
    ancho = json.loads(evaluar("JSON.stringify([document.documentElement.scrollWidth, window.innerWidth,"
                               " document.getElementById('lienzo').getBoundingClientRect().width])"))
    sw, iw, lw = ancho
    salida.append(("OK   " if sw <= iw + 1 and lw >= iw * 0.98 else "FALLA ") +
                  "sin desbordes y lienzo a ancho completo  [" + str(sw) + " vs " + str(iw) + ", lienzo " + str(round(lw)) + "]")
    return salida


def main():
    carpeta = os.path.dirname(os.path.abspath(__file__))
    url = None
    for arg in sys.argv[1:]:
        if arg.startswith("http"):
            url = arg
        else:
            carpeta = arg
    if not os.path.exists(CHROME):
        print("Chrome no está instalado; no se puede verificar en navegador real.")
        return 0

    httpd = None
    if url is None:
        httpd = servir(carpeta)
        url = f"http://127.0.0.1:{PUERTO_APP}/index.html"
    perfil = tempfile.mkdtemp(prefix="arbol-cdp-")
    chrome = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
         "--window-size=1440,900",
         f"--remote-debugging-port={PUERTO_CDP}", f"--user-data-dir={perfil}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws_url = None
        for _ in range(60):
            try:
                info = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PUERTO_CDP}/json/list", timeout=2))
                paginas = [t for t in info if t.get("type") == "page"]
                if paginas:
                    ws_url = paginas[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.5)
        if not ws_url:
            print("No se pudo conectar con Chrome (CDP).")
            return 1

        ruta_ws = ws_url.split(f":{PUERTO_CDP}", 1)[1]
        ws = ws_conectar("127.0.0.1", PUERTO_CDP, ruta_ws)
        cdp(ws, "Page.enable")
        cdp(ws, "Runtime.enable")
        cdp(ws, "Page.navigate", {"url": url})
        time.sleep(2.5)
        resultado = cdp(ws, "Runtime.evaluate", {
            "expression": COMPROBACIONES, "awaitPromise": True, "returnByValue": True, "timeout": 60000
        }, timeout=90)
        valor = resultado.get("result", {})
        if resultado.get("exceptionDetails"):
            print("Excepción en la página:", json.dumps(resultado["exceptionDetails"])[:600])
            return 1
        print(valor.get("value", "(sin resultado)"))
        print()
        print("═══ Fase móvil (iPhone simulado: 390x844, táctil) ═══")
        for linea in fase_movil(ws, url):
            print(linea)
        return 0
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except Exception:
            chrome.kill()
        if httpd:
            httpd.shutdown()


if __name__ == "__main__":
    sys.exit(main())
