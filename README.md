# 🌳 Árbol genealógico del cuestionado

App web **estática** (HTML + CSS + JavaScript, sin dependencias, sin build) para:

1. **Captar datos**: registrar quiénes son los **padres** del cuestionado, quiénes son sus **hijos** y cualquier otro familiar, guardando *quién lo aporta*, *la fuente* y *el nivel de certeza*.
2. **Armar el árbol**: visualización por generaciones con zoom, arrastre, búsqueda y ficha editable de cada persona.
3. **Publicarlo gratis**: pensada para servirse tal cual desde **GitHub Pages**.

---

## 1. Probarla en tu Mac (10 segundos)

Doble clic en `index.html` funciona casi todo, pero para que también lea `data.json` conviene servirla:

```bash
bash abrir.sh          # levanta http://localhost:8000
```

O abre `index.html` directamente en el navegador.

## 2. Publicarla en GitHub Pages (gratis)

**Requisito:** un repositorio **público** en tu cuenta (Pages gratis no funciona en repos privados de cuentas Free).

```bash
# 1) Crea el repo vacío en github.com (sin README ni .gitignore), por ejemplo: arbol-cuestionado
# 2) Desde esta carpeta:
cd outputs/arbol-cuestionado
git init -b main
git add -A
git commit -m "Árbol genealógico: app web + datos"
git remote add origin https://github.com/TU-USUARIO/arbol-cuestionado.git
git push -u origin main
```

O simplemente: `bash deploy.sh TU-USUARIO arbol-cuestionado`

**3) Activa Pages:** en el repo → `Settings` → `Pages` → *Source*: **Deploy from a branch** → *Branch*: **main** / **/ (root)** → `Save`.

En ~1 minuto tu app estará en:

```
https://TU-USUARIO.github.io/arbol-cuestionado/
```

> El archivo `.nojekyll` ya está incluido para que GitHub no procese los archivos con Jekyll.

## 3. Cómo se usan los datos

| Quién | Qué hace |
|---|---|
| **Tú (administrador)** | Pestaña **Ficha**: edita personas, asigna padre/madre, añade hijos y parejas, marca quién es “el cuestionado”. Pestaña **Datos**: comparte el árbol e importa/exporta. |
| **Quien aporta datos** | Botón **Modo aporte** (arriba a la derecha): registra “X es el padre de…”, “Y es hija de…”, con fuente y certeza. |
| **Sin servidor** | Todo se guarda en **localStorage** del navegador de cada persona. Nada se sube a ningún sitio. |

Para que los aportes de otras personas te lleguen, hay tres vías (de menos a más automática):

1. **Enlace**: el colaborador pulsa **“Copiar enlace con mis aportes”** y te lo manda; al abrirlo, tú pulsas *Importar aportes*.
2. **JSON**: **Descargar JSON** → te lo envía → **Importar JSON** (fusiona por nombre, sin duplicar).
3. **Endpoint** (opcional): crea un formulario gratis en [formspree.io](https://formspree.io), pega la URL en **Datos → Ajustes → Endpoint** y el botón **Enviar al administrador** funcionará.

## 3-bis. Dos modos de publicar (elige uno)

**Modo A — datos publicados.** Descarga el JSON, guárdalo como `data.json` en la raíz del repo y haz `git push`: todo el que entre verá el árbol.

**Modo B — app pública, datos privados (el recomendado por defecto aquí).** El repositorio tiene **solo el código**; `data.json` se queda vacío. Los datos viven en el navegador de quien los tenga y se comparten por enlace:

- **Copiar enlace del árbol** (pestaña Datos) → pregunta si quieres **contraseña**.
  - Con contraseña: el enlace se cifra de verdad (**PBKDF2 + AES-GCM**, WebCrypto del navegador). Sin la contraseña no se puede leer.
  - Sin contraseña: el enlace va en base64, que **no es cifrado**: cualquiera que lo tenga puede leerlo. La app te lo advierte antes.
- El trozo con los datos va detrás del `#`, así que **no se envía a ningún servidor** (queda en el navegador de quien lo abre), pero sí en su historial y en sus marcadores.
- Comparte la contraseña **por otro canal** (no en el mismo mensaje que el enlace).
- `.gitignore` ya bloquea `datos*.json`, `*-privado.json`, `*.local.json`… para que no subas tu copia por accidente.
- Si solo quieres ver tu árbol sin publicar nada: abre `index.html` en tu Mac y guarda el JSON como copia de seguridad **fuera** del repositorio.

> Ninguna opción es tan segura como no publicar: si algún nombre es sensible (menores, paternidad disputada), usa el Modo B con contraseña, o iniciales.


## 4. Qué incluye

- **Árbol visual** por generaciones (ascendientes arriba, descendientes abajo), con barra de unión para parejas, pan/zoom, ajuste a pantalla y centrado con doble clic.
- **Familias sin vínculo** al cuestionado: se dibujan en bandas propias debajo, no se mezclan.
- **Certeza por dato** (alta / media / baja): las tarjetas de certeza baja van con borde discontinuo y punto naranja.
- **Aportes con trazabilidad**: informante, fecha, fuente y notas; cada aporte se ve en la lista y se aplica (o no) al árbol.
- **Conflictos protegidos**: no se sobrescribe un padre/madre ya registrado sin confirmación, y se bloquean parentescos imposibles (ciclos).
- **Exportaciones**: JSON (copia/edición), **GEDCOM 5.5** (para MyHeritage, Ancestry, GRAMPS…), **CSV**, **PNG** del árbol.
- **Ficha por persona**: nombre, alias, sexo, nacimiento/fallecimiento, lugar, foto (URL), notas y fuentes.
- **Búsqueda** con resaltado y salto a la coincidencia (Enter).
- **Responsive**: usable desde el teléfono (útil para captar datos en una reunión familiar).

## 5. Ajustes (`config.js`)

```js
window.ARBOL_CONFIG = {
  titulo: 'Árbol genealógico — El Cuestionado',
  subtitulo: 'Quiénes son sus padres y quiénes sus hijos',
  endpoint: '',   // opcional: URL de Formspree para recibir aportes
  repoUrl: ''     // opcional
};
```

Lo que se cambie en **Datos → Ajustes** se guarda en el navegador; usa **“Copiar ajustes para config.js”** para dejarlo fijo en el repositorio.

## 6. Estructura de datos

```json
{
  "meta":    { "titulo": "...", "raizId": "cuestionado", "actualizado": "..." },
  "personas": [ { "id": "p1", "nombre": "…", "sexo": "M",
                  "nac": "1972", "fall": "", "lugar": "", "foto": "",
                  "notas": "…", "certeza": "media",
                  "fuentes": [ { "texto": "…", "url": "…" } ],
                  "padre": "p2", "madre": "p3", "parejas": ["p4"] } ],
  "aportes": [ { "id": "a1", "informante": "…", "tipo": "padre",
                 "refNombre": "El Cuestionado", "nombre": "…",
                 "certeza": "media", "fuente": "…", "notas": "…",
                 "aplicado": true, "fecha": "…" } ]
}
```

Los hijos **no** se guardan en la persona: se derivan de los campos `padre`/`madre` (una sola fuente de verdad, evita incoherencias).

## 7. Limitaciones honestas

- No hay backend: sin endpoint, dos personas no ven el mismo árbol en tiempo real; se sincroniza por enlace/JSON/`data.json`.
- Los datos viven en el navegador: si se borran los datos del sitio, se pierden (descarga el JSON de vez en cuando).
- El repositorio y `data.json` son **públicos**: publica solo información que puedas o quieras hacer pública.
- El diseño de árbol resuelve bien casos habituales (parejas, hijos de distintas uniones, familias sueltas), pero no es un motor genealógico completo (no maneja matrimonios múltiples solapados ni adopciones como relación explícita; se anotan en Notas).

## 8. Archivos

```
index.html    estructura y paneles
styles.css    estilos (claro, responsive)
app.js        estado, captura de aportes, layout del árbol, exportaciones
config.js     título/subtítulo/endpoint
data.json     datos publicados (edítalo y haz push para publicar cambios)
deploy.sh     ayuda para subir a GitHub
abrir.sh      servidor local de prueba
```

## 9. Notas para desarrollo / verificación

- `pruebas-smoke.js` ejecuta la app entera con un DOM simulado (sin navegador) y comprueba render, botones, aportes, conflictos, enlaces con y sin cifrado, exportaciones y persistencia:

  ```bash
  osascript -l JavaScript pruebas-smoke.js     # 67 comprobaciones
  ```

- `pruebas-navegador.py` abre la app en **Chrome real** (por el protocolo de depuración) y verifica lo que no se puede probar fuera del navegador: el cifrado de enlaces con WebCrypto, el DOM renderizado, el ajuste a pantalla, la fusión de un enlace recibido y el localStorage:

  ```bash
  python3 pruebas-navegador.py                 # 20 comprobaciones en Chrome
  ```

- En la consola del navegador, `ARBOL_DEBUG` expone utilidades para inspeccionar el estado:
  `ARBOL_DEBUG.getState()`, `ARBOL_DEBUG.demo()`, `ARBOL_DEBUG.layout()`, `ARBOL_DEBUG.cifrarTexto(...)`, `ARBOL_DEBUG.edges(...)`.
- Sin dependencias ni compilación: se puede editar `app.js` y recargar.

