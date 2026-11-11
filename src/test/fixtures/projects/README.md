# Fixtures de proyectos

Copias mínimas y reproducibles de los dos proyectos de ejemplo que usa el plan:

| Fixture | Origen | Qué representa |
| --- | --- | --- |
| `sitio/` | `historikas` | Sitio HTML con menú, anuncio, creadora y colección |
| `libro/` | `cuidar-se` | Libro con colección, creadora y todos los formatos |

No son copias completas ni dependen de `/Users/david/Proyectos/historikas` o
`/Users/david/Proyectos/cuidar-se`: todo lo necesario vive aquí y usa rutas relativas.

## Estructura

- `sitio/`: configuración HTML, `inicio.md`, `menu.md`, `anuncio.md`, `autora.md`,
  `coleccion.md`, dos notas y un PNG de 1×1.
- `libro/`: configuración con LaTeX, PDF, HTML, EPUB y Markdown, `antologia.md`,
  `ana-ejemplo.md` y dos capítulos.

Los nombres y slugs son deliberadamente estables porque los escenarios de
`features/fixtures-proyectos.feature` verifican las salidas y el conteo de archivos.

## Compilar y verificar

```sh
bun tools/fixtures-build.sh
# o sólo los escenarios de fixtures
bunx cucumber-js features/fixtures-proyectos.feature
```

Salidas esperadas:

- `sitio`: 7 archivos en `dist/files` (incluye `index.html` generado por la lista).
- `libro`: 12 archivos en `dist/files` (LaTeX, PDF, HTML, EPUB y Markdown por documento).

## Regenerar o actualizar

Las fixtures se editan a mano para mantenerlas pequeñas. Para actualizarlas cuando
cambie el formato de los proyectos reales:

1. Copia sólo el archivo o la estructura mínima que haga falta desde el proyecto
   original a `src/test/fixtures/projects/<sitio|libro>/`.
2. Recorta el contenido editorial a unas cuantas líneas y conserva únicamente los
   campos de frontmatter que el escenario necesita.
3. No agregues rutas absolutas ni assets pesados; para imágenes usa PNG de 1×1.
4. Corre `bun tools/fixtures-build.sh` y ajusta los conteos del feature si la
   estructura cambió a propósito.

El build de verdad sigue viviendo en los proyectos originales; estas fixtures sólo
congelan la forma mínima que el CLI debe seguir compilando.
