# Cabeceras de caché y seguridad

Las cabeceras HTTP se configuran en el hosting o en el CDN, no en el HTML.
`iteraciones` genera HTML, CSS e imágenes; no puede enviar `Cache-Control`,
`Strict-Transport-Security`, `Cross-Origin-Opener-Policy` ni
`X-Frame-Options` desde un archivo estático.

`<meta http-equiv="Content-Security-Policy">` existe, pero es una parte
limitada de CSP y no sirve para HSTS, COOP ni XFO. Para el sitio publicado,
usa el panel del hosting o un archivo de configuración como `_headers` o
`netlify.toml`.

## Caché

| Recurso | Cabecera | Por qué |
|---|---|---|
| HTML | `Cache-Control: public, max-age=0, must-revalidate` | El HTML cambia con cada publicación y no lleva hash en la URL. El navegador guarda una copia, pero pregunta antes de usarla. |
| Assets con nombre fijo (`assets/css/styles.css`, `assets/images/...`) | `Cache-Control: public, max-age=86400, must-revalidate` | Se cachean un día, pero se revalidan. Es el compromiso mientras el nombre no cambie. |
| Assets con hash en el nombre | `Cache-Control: public, max-age=31536000, immutable` | Si el contenido cambia, cambia la URL. |

La CLI **no** genera nombres hasheados para los assets: el CSS siempre es
`assets/css/styles.css` y las imágenes conservan un nombre estable. Por eso no
conviene poner `immutable` en `/assets/*`: después de publicar una imagen
nueva, el navegador seguiría usando la vieja.

Si necesitas la caché larga que pide Lighthouse, agrega un paso de
fingerprint en tu CI: renombra los assets con un hash y reescribe el HTML.
Mientras no lo hagas, `max-age=86400` reduce el problema, pero Lighthouse
puede seguir marcando los assets.

## Seguridad

| Cabecera | Valor recomendado | Nota |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'` | `style-src 'unsafe-inline'` es necesario por los atributos `style` del HTML generado. Si los quitas, usa `style-src 'self'`. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Solo si todo el dominio y sus subdominios van por HTTPS. No uses `preload` hasta estar listo para la lista de precarga. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Aísla la ventana de otros orígenes. Puede romper ventanas emergentes de OAuth; revisa el admin de Sveltia. |
| `X-Frame-Options` | `DENY` | Evita el iframe. `frame-ancestors 'none'` de CSP ya lo cubre en navegadores modernos. |
| `X-Content-Type-Options` | `nosniff` | Evita que el navegador adivine el tipo de archivo. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | No envía la ruta completa a otros dominios. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Apaga permisos que el sitio no usa. |

### El admin de Sveltia

El build copia `admin/` a `dist/files/admin/` cuando existe. Sveltia necesita
hablar con la API de GitHub y con el proveedor de OAuth; una CSP estricta
puede dejar el admin en blanco o impedir el guardado.

Si publicas el admin en el mismo dominio:

- Abre la consola del navegador en `/admin/` y revisa qué orígenes bloquea la
  CSP.
- Ajusta `connect-src`, `img-src` y `frame-src` para GitHub y el proveedor de
  OAuth.
- Si no quieres mantener esa lista, publica el admin en otro dominio o no lo
  incluyas en el directorio de publicación.

No bajes la CSP de todo el sitio por el admin. Es mejor una regla específica
para `/admin/*` o un sitio aparte.

## `_headers` canónico

Guarda este archivo como `_headers` en el directorio publicado (Cloudflare
Pages) o úsalo como referencia para traducirlo a `netlify.toml`. El ejemplo
completo está en
[`examples/despliegue/_headers`](../../examples/despliegue/_headers).

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

Cloudflare aplica todas las reglas que coinciden; si declaras
`Cache-Control` dos veces para la misma ruta, los valores se concatenan. Este
archivo evita ese choque: la seguridad va en `/*`, la caché solo en `/`,
`/*.html` y `/assets/*`.

## Netlify

En `netlify.toml`, las cabeceras se declaran con `[[headers]]`. Si ya tienes
el archivo que generó `init sveltia`, no reemplaces `[build]` ni
`[[plugins]]`: agrega las tablas al final.

```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
    Cross-Origin-Opener-Policy = "same-origin"
    X-Frame-Options = "DENY"
    Strict-Transport-Security = "max-age=31536000; includeSubDomains"
    Content-Security-Policy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=86400, must-revalidate"

[[headers]]
  for = "/"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
```

En Netlify, si `/*.html` no cubre las páginas anidadas en tu deploy, agrega
una regla por carpeta (`/textos/*.html`, `/creadoras/*.html`, etc.) o usa el
archivo `_headers` con las rutas de tu sitio.

La receta completa de Netlify está en [netlify.md](netlify.md).

## Cloudflare Pages

Cloudflare lee `_headers` del directorio de salida. Copia el archivo después
del build:

```bash
bun run build
cp examples/despliegue/_headers dist/files/_headers
```

O usa un comando de build que lo haga:

```bash
bun run build && cp examples/despliegue/_headers dist/files/_headers
```

Cloudflare aplica las reglas en el orden en que aparecen y hereda las
cabeceras de todas las reglas que coinciden. La receta completa está en
[cloudflare-pages.md](cloudflare-pages.md).

## GitHub Pages

GitHub Pages **no permite cabeceras personalizadas**. No hay `_headers` ni
`netlify.toml`; tampoco puedes cambiar `Cache-Control`, CSP, HSTS, COOP ni
XFO. GitHub Pages decide su propia caché.

Si necesitas esas cabeceras, publica el mismo `dist/files/` en Netlify,
Cloudflare Pages o un CDN delante de Pages. La receta de
[GitHub Pages](github-pages.md) explica la ruta base y la publicación.

## Verificar

```bash
curl -I https://SITIO-DE-EJEMPLO.example/
curl -I https://SITIO-DE-EJEMPLO.example/assets/css/styles.css
```

Comprueba que el HTML trae `cache-control` con `max-age=0` y que los assets
traen la caché que elegiste. Si el hosting devuelve dos `cache-control`
concatenados, revisa que no haya reglas superpuestas.

## Lo que no se configura en el HTML

- `Strict-Transport-Security`: solo funciona por HTTPS y el navegador la
  recuerda; no se puede poner en `<meta>`.
- `X-Frame-Options` y `frame-ancestors`: no se pueden poner en `<meta>`.
- `Cross-Origin-Opener-Policy`: no se puede poner en `<meta>`.
- `Cache-Control`: no se puede poner en `<meta>`; el navegador no la lee.
- `Content-Security-Policy`: en `<meta>` funciona parcialmente y no cubre
  `frame-ancestors`; para el sitio publicado, usa la cabecera HTTP.
