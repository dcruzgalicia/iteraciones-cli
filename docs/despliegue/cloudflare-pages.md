# Cloudflare Pages

Cloudflare Pages publica un directorio estático y lee un archivo `_headers`
para las cabeceras. Es una alternativa a Netlify cuando quieres caché y
seguridad sin depender de `netlify.toml`.

## Opción A: integración con Git

En el panel de Cloudflare Pages:

- Framework preset: **None**.
- Build command: `bun run build && cp _headers dist/files/_headers`
- Build output directory: `dist/files`
- Variable: `BUN_VERSION` con la versión de Bun que uses (por ejemplo,
  `1.4.4`).

Copia el archivo canónico a la raíz del proyecto:

```bash
cp examples/despliegue/_headers _headers
```

El comando de build lo copia a `dist/files/_headers` después de construir. Si
prefieres no usar `cp` en el comando, puedes subir el archivo con un paso
posterior o publicar desde CI.

La imagen de Cloudflare Pages trae Bun, pero no garantiza Pandoc, ImageMagick
ni TeX Live. Si el build falla por herramientas faltantes, usa la opción B o
instala los binarios en el paso de build. `iteraciones doctor` dice qué falta.

## Opción B: construir en CI y publicar con Wrangler

Para PDF/LaTeX o para controlar las versiones de Pandoc e ImageMagick, compila
fuera de Pages y sube el resultado:

```bash
bun install --frozen-lockfile
bunx iteraciones doctor
bun run build
cp examples/despliegue/_headers dist/files/_headers
bunx wrangler pages deploy dist/files --project-name=mi-sitio
```

Necesitas `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el entorno. En
GitHub Actions puedes usar el mismo paso después de instalar las herramientas
que necesite el build.

Esta variante separa el build del hosting: Cloudflare solo recibe archivos
estáticos y no tiene que ejecutar Pandoc ni LaTeX.

## Cabeceras

Cloudflare lee `_headers` del directorio de salida. El archivo canónico está
en [`examples/despliegue/_headers`](../../examples/despliegue/_headers); estas
son las reglas:

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'

/
  Cache-Control: public, max-age=0, must-revalidate

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
  Cache-Control: public, max-age=86400, must-revalidate
```

Cloudflare aplica todas las reglas que coinciden y concatena los valores de
una misma cabecera. Este archivo no repite `Cache-Control` para la misma ruta:
la seguridad va en `/*` y la caché solo en `/`, `/*.html` y `/assets/*`.

La explicación de la política está en [cabeceras.md](cabeceras.md). En
resumen:

- HTML siempre se revalida;
- assets con nombre fijo se cachean un día y se revalidan;
- no se usa `immutable` porque la CLI no genera nombres hasheados;
- el admin de Sveltia puede necesitar una CSP más amplia.

## Publicar

1. Crea un proyecto de Pages y conecta el repositorio.
2. Configura el build y el output como arriba.
3. Agrega `BUN_VERSION` y, si usas la opción B, las credenciales de Wrangler.
4. Haz push a la rama de producción.
5. Abre la URL `*.pages.dev` y revisa la home, un texto y una descarga.

Si usas dominio propio, configúralo en **Custom domains**. Los archivos
generados usan rutas relativas, así que no hay que cambiar la base.

## Verificar

```bash
curl -I https://SITIO-DE-EJEMPLO.pages.dev/
curl -I https://SITIO-DE-EJEMPLO.pages.dev/assets/css/styles.css
```

Comprueba que el HTML trae `cache-control: public, max-age=0, must-revalidate`
y los assets `max-age=86400`. Si el HTML trae la caché de los assets o
viceversa, revisa el orden y las rutas de `_headers`.

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| 404 | El output no es `dist/files` o el build no generó HTML. |
| `_headers` no se aplica | El archivo no está en el directorio de salida. |
| Falla `pandoc` o `magick` | La imagen no trae las herramientas; usa CI o instálalas. |
| El admin queda en blanco | CSP demasiado estricta; ajusta `connect-src` e `img-src`. |
| El CSS sigue viejo | El navegador guardó la versión anterior; la regla debe revalidar. |
