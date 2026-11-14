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

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` prueba, construye y publica en cada push a `main`.
La ruta base se saca del nombre del repo (`/NOMBRE/`, o `/` si el repo es `USUARIO.github.io`).

1. Crear el repo en GitHub (por ejemplo `ruta-pikachu`) con esta carpeta como raíz.
2. En el repo: Settings → Pages → Source: **GitHub Actions**.
3. `git push` a `main`. La app queda en `https://USUARIO.github.io/ruta-pikachu/`.
4. En el celular: abrirla en Chrome → menú → «Instalar app». Luego restaurar un respaldo o importar
   desde el Artifact (cada dirección tiene sus propios datos).

Para probar la subruta en local: `BASE=/ruta-pikachu/ npm run build && BASE=/ruta-pikachu/ npm run preview`.

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
