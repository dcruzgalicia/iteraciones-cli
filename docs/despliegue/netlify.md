# Netlify

`iteraciones init sveltia` ya deja un proyecto listo para Netlify. Esta receta
no rehace esa configuración: conserva lo generado y agrega las cabeceras que
faltan.

## Lo que ya existe

`init sveltia` crea o actualiza:

| Archivo | Contenido |
|---|---|
| `netlify.toml` | `[build]` con `bun run build`, `publish = "dist/files"`, `BUN_VERSION` y el plugin `netlify-plugin-cache` para `.iteraciones` y `dist`. |
| `Brewfile.netlify` | Fórmulas de Homebrew que el build necesita según los formatos activos. |
| `package.json` | Scripts `build` y `dev`, dependencia de `@sveltia/cms` y `netlify-plugin-cache`. |
| `admin/` | Sveltia vendorizado y `admin/config.yml`. |

No reemplaces `[build]` ni `[[plugins]]` si ya están. Si el proyecto no usó
`init sveltia`, configura Netlify desde la interfaz con los mismos valores:

- Build command: `bun run build`
- Publish directory: `dist/files`
- Variable: `BUN_VERSION` con la versión de Bun que uses.

## Cabeceras

Agrega estas tablas al final de `netlify.toml`, después de `[[plugins]]`. No
cambian el build ni el plugin de caché.

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

La política y el porqué de cada valor están en
[cabeceras.md](cabeceras.md). En resumen:

- el HTML se revalida siempre (`max-age=0`);
- los assets con nombre fijo se cachean un día y se revalidan;
- la seguridad va en `/*` para todas las respuestas;
- no se usa `immutable` porque la CLI no genera nombres hasheados.

Si `/*.html` no cubre las páginas anidadas en tu deploy de Netlify, agrega
una regla por carpeta. Por ejemplo, para `textos/`:

```toml
[[headers]]
  for = "/textos/*.html"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
```

Repite el bloque para cada carpeta que publique HTML.

## El plugin de caché

`netlify-plugin-cache` guarda `.iteraciones` y `dist` entre builds de Netlify
para que el build incremental sea más rápido. No es caché del navegador y no
cambia las cabeceras. Las dos cosas se complementan:

- plugin de Netlify: acelera el build;
- `Cache-Control`: decide qué guarda el navegador.

## Dependencias del build

`Brewfile.netlify` declara las fórmulas de Homebrew que el build necesita.
Netlify puede detectarlo e instalar las fórmulas antes del build; es una
función experimental, así que revisa el log del primer deploy. En una máquina
macOS también puedes preparar el entorno con:

```bash
brew bundle --file=Brewfile.netlify
```

Si el build falla porque falta `pandoc` o `magick`, revisa que
`Brewfile.netlify` esté en la raíz y que Netlify lo haya leído; si no,
instala esas herramientas en el paso de build o compila en un CI con las
dependencias y publica el artefacto. `iteraciones doctor` dice qué falta.
Para PDF/LaTeX también hacen falta TeX Live, Biber y Poppler; el Brewfile los
incluye cuando esos formatos están activos, pero la instalación de TeX puede
ser lenta o fallar en la imagen de Netlify.

## Publicar

1. Conecta el repositorio del sitio en Netlify.
2. Verifica que Netlify lea `netlify.toml` (o configura los mismos valores en
   la interfaz).
3. Haz push a la rama de producción.
4. Abre la URL del deploy y revisa la home, un texto y una descarga.

Si usas Sveltia con OAuth, configura el proveedor de GitHub en Netlify y
revisa `admin/config.yml`. La CSP estricta puede bloquear el admin; ajusta
`connect-src` y `img-src` para GitHub y el proveedor de OAuth, o publica el
admin en otro dominio.

## Verificar

```bash
curl -I https://SITIO-DE-EJEMPLO.netlify.app/
curl -I https://SITIO-DE-EJEMPLO.netlify.app/assets/css/styles.css
```

El HTML debe traer `cache-control: public, max-age=0, must-revalidate` y los
assets `max-age=86400`. Si ves dos `cache-control` concatenados, hay reglas
superpuestas: deja la caché solo en `/`, `/*.html` y `/assets/*`.

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| 404 en todas las páginas | `publish` no es `dist/files` o el build no generó el HTML. |
| El build falla por `pandoc` o `magick` | La imagen no trae las herramientas; instálalas o usa CI. |
| Las cabeceras no aparecen | `netlify.toml` no está en la raíz o Netlify no lo leyó. |
| El admin queda en blanco | CSP demasiado estricta; revisa la consola del navegador. |
| Los assets siguen viejos | El navegador guardó la versión anterior; la regla de assets debe revalidar. |
