# GitHub Pages

GitHub Pages publica archivos estáticos desde un repositorio. Sirve para un
sitio HTML, pero **no permite cabeceras personalizadas**: no hay
`Cache-Control`, CSP, HSTS, COOP ni XFO configurables. Tampoco hay `_headers`
ni `netlify.toml`.

## Lo que necesitas

- El sitio construido en `dist/files/`.
- El repositorio en GitHub.
- GitHub Actions habilitado.
- Si usas Sveltia, actualiza `admin/config.yml` con la URL de Pages.

## Ruta base

Un sitio de proyecto se publica en:

```text
https://OWNER.github.io/REPO/
```

No en la raíz del dominio. La buena noticia es que `iteraciones` genera
enlaces relativos (`./`, `../`), así que el mismo `dist/files/` funciona en
la raíz y en un subdirectorio. No hay que configurar una `base` ni reescribir
las rutas.

Reglas:

- No empieces las rutas del contenido con `/`; usa rutas relativas.
- `format.html.site.logo` debe ser relativo al proyecto y no puede empezar
  con `/` ni contener `..`.
- Si usas un dominio propio, el sitio se sirve en la raíz; los mismos archivos
  siguen funcionando.
- Si el repositorio se llama `OWNER.github.io`, el sitio se sirve en la raíz.

Para probar la ruta base en local:

```bash
rm -rf /tmp/pages-preview
mkdir -p /tmp/pages-preview/REPO
cp -R dist/files/. /tmp/pages-preview/REPO/
python3 -m http.server 8000 --directory /tmp/pages-preview
```

Abre `http://localhost:8000/REPO/` y recorre la home, un texto, una ficha de
autora y una descarga. Si algo funciona en `/` pero no en `/REPO/`, hay una
ruta absoluta en el contenido o en la configuración.

## Publicar con GitHub Actions

Es la opción recomendada: construye en el runner y publica el artefacto, sin
guardar `dist/` en la rama.

1. Copia [`examples/despliegue/github-pages.yml`](../../examples/despliegue/github-pages.yml)
   a `.github/workflows/pages.yml` en el proyecto del sitio.
2. En GitHub, abre **Settings → Pages** y elige **GitHub Actions** como
   fuente.
3. Haz push a `main`.

El workflow:

- instala Bun, Pandoc, ImageMagick y librsvg;
- ejecuta `bun install --frozen-lockfile`;
- comprueba el entorno con `iteraciones doctor`;
- construye con `bun run build`;
- sube `dist/files/` como artefacto de Pages;
- publica con `actions/deploy-pages`.

El ejemplo está pensado para HTML, EPUB y Markdown. Si el proyecto genera PDF
o LaTeX, el runner necesita TeX Live, Biber y Poppler; agrégalos al paso de
herramientas o compila en un contenedor con esas dependencias. También puedes
quitar `iteraciones doctor` del workflow si prefieres que el build falle
directamente.

## Publicar desde una rama

La alternativa es **Deploy from a branch**. GitHub Pages sirve el contenido
de una rama y una carpeta:

- `main` / `/docs`, o
- `gh-pages` / `/`.

`iteraciones` escribe en `dist/files/`, que está en `.gitignore` y no se
versiona. Para usar una rama tienes que publicar los archivos construidos:

```bash
bun run build
# copia dist/files/ a la rama gh-pages y haz push
```

También puedes generar `gh-pages` en CI con `git subtree` o una acción de
publicación. Si no quieres versionar la salida, usa Actions.

En **Settings → Pages**, elige la rama y la carpeta. La primera publicación
puede tardar unos minutos.

## Sveltia y la URL

`init sveltia` configura `admin/config.yml` con un dominio de Netlify. Si
publicas en Pages, cámbialo:

```yaml
site_url: https://OWNER.github.io/REPO/
display_url: https://OWNER.github.io/REPO/
```

Revisa también el backend si usas OAuth. El admin se copia a
`dist/files/admin/` y queda disponible en
`https://OWNER.github.io/REPO/admin/`.

## Cabeceras

GitHub Pages no permite configurarlas. En particular:

- No puedes cambiar la caché de HTML ni de assets.
- No puedes enviar CSP, HSTS, COOP ni XFO.
- No puedes usar `_headers`.

Si necesitas esas cabeceras, publica el mismo `dist/files/` en
[Netlify](netlify.md) o [Cloudflare Pages](cloudflare-pages.md), o pon un CDN
con cabeceras delante de Pages. La política recomendada está en
[cabeceras.md](cabeceras.md).

## Lista de comprobación

- [ ] `bun run build` termina sin errores.
- [ ] `dist/files/index.html` existe.
- [ ] El sitio funciona en `http://localhost:8000/REPO/`, no solo en `/`.
- [ ] Los enlaces de descarga y el admin usan rutas relativas.
- [ ] `admin/config.yml` apunta a la URL de Pages.
- [ ] La fuente de Pages es GitHub Actions o la rama correcta.
- [ ] Sabes que las cabeceras de seguridad no están disponibles en Pages.
