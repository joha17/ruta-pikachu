# Ruta Pikachu

PWA instalable para llevar mi colección de cartas Pokémon: hojas de 9 bolsillos, Caja, lista de
compras, binder, precios de TCGplayer (vía TCGdex) y escáner. Todo vive en el aparato (IndexedDB);
no hay servidor.

## Uso

```bash
npm install
npm run dev        # desarrollo
npm test           # tests de la lógica (Vitest)
npm run build      # build de producción en dist/
npm run preview    # servir el build (prueba de PWA y sin conexión)
```

## Datos

- `src/data/hojas/*.json`: las hojas fijas. Cada archivo es una hoja (`id`, `name`, `theme`,
  `order`, `cards`). Para añadir una hoja nueva basta con crear otro JSON con un `id` que no se
  repita; no hay que tocar código. Cada carta lleva su `tcg` (id de TCGdex) y, si quieres,
  `alts` (variantes para ese bolsillo) o `same` (misma carta física que otra clave).
- `src/data/listas.json`: metas, «para cambiar» y «para proteger».
- Claves de carta: `p:5`, `r:moltres`, `u:s1.c1` (hoja propia), `b:b1` (Caja). Son las mismas
  del Artifact, así que precios, fotos y favoritos siguen igual.

## Migración desde el Artifact

1. Descargar la página del Artifact y sus fotos (herramienta Artifact de Claude Code, `read`).
2. `node scripts/armar-migracion.mjs <pagina.html> <carpeta-fotos> <salida.json>`
3. En la app: **Respaldo** → «Importar desde el Artifact» → elegir el `.json` → revisar el informe → «Guardar en este aparato».

El paquete lleva tus fotos: guárdalo **fuera** del repo.

## Respaldo

- Pestaña **Respaldo**: «Descargar respaldo» (o «Compartir…» a Drive o correo en el celular) arma
  `ruta-pikachu-respaldo-AAAA-MM-DD.json` con la colección, los precios, el historial y tus fotos en base64
  (`src/model/backup.ts`, `src/backup.ts`). No lleva la clave de Claude ni la caché de TCGdex.
- «Restaurar un respaldo» revisa el archivo, muestra qué trae y, si confirmas, reemplaza todo lo del aparato.
- Si hay colección y el último respaldo tiene más de 7 días (o nunca hubo), sale un aviso arriba.
- Los respaldos llevan fotos personales: `.gitignore` ignora `ruta-pikachu-respaldo-*.json`.

## Sincronizar con Google Drive

Lo que se agrega en un aparato aparece en los demás (pestaña **Respaldo** → «Sincronizar con Google Drive»).

- Inicio de sesión con Google en el navegador (Google Identity Services), sin servidor. Permiso
  `drive.appdata`: la app solo ve su carpeta oculta en tu Drive, nunca tus archivos.
- En Drive: `coleccion.json` (colección y precios a mano) y una `foto-<huella>` por foto.
- **Combinar, no pisar** (`src/sync/merge.ts`): la colección se parte en elementos (cada carta
  marcada, deseo, precio a mano, variante, orden de hoja, hoja propia, carta de hoja propia, carta de
  la Caja y foto). Cada uno lleva la hora de su último cambio y gana el más reciente. Los borrados
  quedan como marcas, así un aparato desactualizado no resucita lo borrado. Las horas se ponen
  comparando con la última copia después de cada guardado, así que funciona sin conexión.
- Los ids nuevos llevan una marca del aparato (`b12k3f`) para que dos aparatos sin conexión no
  creen la misma carta n.º 12.
- Se sincroniza al abrir, unos segundos después de cada cambio, al volver a la app, al recuperar la
  conexión y cada 3 minutos mientras está abierta (`src/sync/engine.ts`).
- Google da un permiso de una hora. Después, el indicador de arriba dice «☁ Sincronizar»: un toque
  lo renueva (Google no deja renovarlo sin un toque en una app sin servidor). Los cambios se guardan
  mientras tanto.
- Viajan también los últimos precios automáticos (`precios.json`): por carta gana el del día más reciente, así los totales dan igual en todos los aparatos.
- No viajan: la clave de Claude, el tema ni el historial completo de precios.

### Crear el ID de cliente (una sola vez)

1. Entrar a <https://console.cloud.google.com> con tu cuenta de Google.
2. Selector de proyecto → **Proyecto nuevo** → nombre `Ruta Pikachu` → **Crear**, y elegirlo.
3. Buscar **Google Drive API** → **Habilitar**.
4. **Google Auth Platform** (o «Pantalla de consentimiento de OAuth») → **Comenzar**: nombre
   `Ruta Pikachu`, tu correo, público **Externo** → **Crear**.
5. **Público** → «Usuarios de prueba» → **Add users** → tu Gmail.
6. **Acceso a los datos** → **Agregar o quitar permisos** → marcar `.../auth/drive.appdata` → **Guardar**.
7. **Clientes** → **Crear cliente** → **Aplicación web**. En **Orígenes autorizados de JavaScript**:
   `https://joha17.github.io` (sin ruta ni barra final). Para probar en la PC agrega también
   `http://localhost:5173`. Sin URI de redireccionamiento.
8. Copiar el **ID de cliente** (`….apps.googleusercontent.com`) a `src/sync/config.ts`
   (`CLIENT_ID_IN_CODE`). Es público, puede ir en el repo. El **secreto del cliente** no se usa y
   nunca va al repo.

La primera vez, Google avisa que «no verificó esta app»: es tu propia app; «Continuar».

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` prueba, construye y publica en cada push a `main`.
La ruta base se saca del nombre del repo (`/NOMBRE/`, o `/` si el repo es `USUARIO.github.io`).

1. Crear el repo en GitHub (por ejemplo `ruta-pikachu`) con esta carpeta como raíz.
2. En el repo: Settings → Pages → Source: **GitHub Actions**.
3. `git push` a `main`. La app queda en `https://USUARIO.github.io/ruta-pikachu/`.
4. En el celular: abrirla en Chrome → menú → «Instalar app». Luego restaurar un respaldo o importar
   desde el Artifact (cada dirección tiene sus propios datos).

Para probar la subruta en local: `BASE=/ruta-pikachu/ npm run build && BASE=/ruta-pikachu/ npm run preview`.

### Historial de precios (tcgcsv.com)

El mismo workflow corre también cada día a las 21:30 UTC. Antes de construir, `scripts/historial.mjs`
baja los archivos diarios de precios de TCGplayer de [tcgcsv.com](https://tcgcsv.com/faq) (gratis,
desde febrero de 2024; solo Pokémon y Pokémon Japón) y deja los últimos 6 meses en
`historial/<productId % 1000>.json`. tcgcsv no deja que la app los pida desde el navegador, por eso
se hace aquí. Los días ya bajados quedan en la caché de Actions. Baja del día más nuevo al más viejo,
como mucho 50 días por corrida y con pausas; si tcgcsv responde 429 (demasiadas descargas), espera y,
si sigue, deja el resto para la próxima corrida. Para completar los 6 meses más rápido se puede correr
a mano en «Actions» → «Publicar en GitHub Pages» → «Run workflow».

La app busca el ID de producto de TCGplayer que da TCGdex y completa con esos precios los días que no
tiene guardados (nunca cambia un precio guardado ni el de hoy). Si el paso falla, la app se publica
igual. GitHub pausa los workflows programados de un repo sin actividad en 60 días: se reactivan en
«Actions».

### Alertas con la app cerrada (Telegram)

Las alertas de precio se revisan en la app al abrirla. Para que avisen también con la app cerrada,
la publicación diaria corre `scripts/alertas.mjs` justo después del historial: revisa las alertas con
los precios de tcgcsv del día (las mismas reglas de la app, `src/model/alertRules.ts`) y avisa por
Telegram. Las alertas no van al repo, que es público: la app las copia a un gist secreto de la cuenta
(`ruta-pikachu-alertas.json`) y lo avisado vuelve en `ruta-pikachu-enviadas.json`, que la app pasa a
Alertas. Los registros de Actions solo muestran cuentas.

Para activarlo (una sola vez):

1. En Telegram, `/newbot` con @BotFather; guardar el token y escribirle un mensaje al bot.
2. Crear un token de GitHub *fine-grained* con **Account permissions → Gists: Read and write**.
3. En Settings → Secrets and variables → Actions, crear `GIST_TOKEN` (ese token) y `TELEGRAM_TOKEN`
   (el del bot). `TELEGRAM_CHAT_ID` es opcional: sin él se usa el primer chat que le escribió al bot.
4. En la app, Alertas → «Avisos con la app cerrada», pegar el mismo token de GitHub.
5. Opcional: crear también `ANTHROPIC_API_KEY` (tu clave de Claude, la misma del escáner) para que cada
   alerta llegue con una línea de Claude (Haiku) que explica el movimiento del precio
   (`scripts/explicar.mjs`). El gasto del mes queda en el gist y la app lo suma a su tope mensual; de noche
   se corta en $1 al mes o en lo que le quede al tope de la app.

## Escáner

- Pestaña «Escanear»: cámara en vivo con marco de carta, o fotos de la galería. Modo ráfaga para varias seguidas.
- El texto se lee en el aparato con Tesseract.js (`src/scan/ocr.ts`): franja de abajo (número) y de arriba (nombre).
  El lector (worker, motor WebAssembly y datos de inglés, ≈ 7 MB) se copia de `node_modules` al build en `ocr/`
  (plugin en `vite.config.ts`), no se precarga al instalar y se guarda en la caché `lector-ocr` la primera vez.
- Recorte sin OpenCV (`src/scan/crop.ts`): marco guía en la cámara; en fotos, detección por bordes y ajuste a 63×88.
- Número → TCGdex (`cards?localId=…`) y filtro por el total impreso con la lista de sets (`src/scan/match.ts`,
  `src/scan/identify.ts`). Si no se lee el número, se busca por nombre en tus hojas y en TCGdex.
- Tu foto recortada solo se guarda si marcas la casilla, y solo en el aparato.

## Ayuda de Claude (opcional, de pago)

- Apagada por defecto. Se activa en «Escanear» → «🤖 Ayuda de Claude» con tu propia clave de la API de Anthropic.
- La clave vive solo en el aparato (IndexedDB, clave `claude` aparte de los ajustes): no va al repo, ni a la URL,
  ni a los respaldos.
- La llamada sale del navegador con el SDK oficial `@anthropic-ai/sdk` (`dangerouslyAllowBrowser`, que manda
  `anthropic-dangerous-direct-browser-access: true`). El SDK (≈ 80 KB gzip) se baja solo al usarlo y no se precarga.
- Modelo `claude-haiku-5-5` (esfuerzo bajo) o `claude-sonnet-5-5` (esfuerzo medio, con respaldo del lado del
  servidor `fallbacks: "default"` por si se niega). Respuesta con salida estructurada (`output_config.format`)
  `{ok, n, num, set, rar, lang, graded, tcg, match, conf, why}` (`src/scan/claude-core.ts`).
- Cada botón muestra el costo estimado y, después, lo que costó según los tokens que informa Anthropic.
  La app suma el gasto del aparato; el cobro real se ve en console.anthropic.com.
- La respuesta se cruza con tu catálogo (`match`), con el ID de TCGdex (`tcg`) o buscando nombre y número.
  Si TCGdex no la tiene (muchas japonesas), se guarda en la caja con los datos de Claude (idioma y gradeo incluidos).

## Reglas

- Las imágenes oficiales se enlazan desde `assets.tcgdex.net`; nunca se copian al repo, al build
  ni a la caché del service worker.
- Mis fotos solo viven en el aparato y en mis respaldos.
- Nada personal ni claves de API en la URL. La foto solo se envía a Anthropic cuando tocas «Preguntar a Claude».
