# Referencia de frontmatter

Todos los archivos Markdown pueden declarar metadatos en un bloque YAML al inicio del archivo, delimitado por `---`. Este bloque se llama **frontmatter**.

```markdown
---
title: 'Mi artículo'
subtitle: 'Subtítulo opcional'
date: 2025-01-15
author:
  - Sofia García
  - Juan Pérez
---

Contenido del artículo...
```

## Campos

El pipeline consume **5 campos** del frontmatter:

| Campo | Tipo | Por defecto | Descripción |
|-------|------|-------------|-------------|
| `title` | `string` | `''` | Título del documento. Se usa para el slug y el maketitle del PDF. |
| `subtitle` | `string` | — | Subtítulo del documento. Se muestra bajo el título en el maketitle del PDF. Admite el bloque YAML literal (`\|`) para varias líneas, con las mismas reglas que las páginas de título internas (ver más abajo). |
| `date` | `string` | — | Fecha en formato `YYYY-MM-DD`. Con `pdf.show-date: true` se muestra en el maketitle; si no se declara, se usa la fecha de creación del archivo. |
| `author` | `string \| string[]` | `[]` | Uno o varios autores. El slug usa `title-por-author`: por defecto solo el primer autor; en caso de colisión se van añadiendo autores (`-y-`) y, si se agotan, se aplica un sufijo `-dN`. |
| `slug` | `string` | — | **Slug manual** (opcional): fija la URL del documento en lugar del esquema automático. Formato seguro: solo minúsculas, números y guiones simples (`^[a-z0-9]+(-[a-z0-9]+)*$`). Dos documentos con la misma salida (mismo directorio + slug) son un error de build y de `validate`. |

## Campos que fluyen a pandoc

El frontmatter completo se pasa a pandoc como metadata del documento. Los campos que el template y el pipeline consumen con efecto visible son:

| Campo | Efecto |
|-------|--------|
| `lang` | Idioma del documento (sobreescribe `lang` de la configuración) |
| `toc` | Activa/desactiva la tabla de contenidos de ese documento (sobreescribe `toc` de la configuración) |
| `description` | Meta description del HTML |
| `site-title`, `tagline`, `theme`, `accent`, `css` | Sobreescriben los valores de `format.html` para ese documento |

`validate` advierte sobre cualquier otro campo del frontmatter que no tenga efecto.

## Páginas de título internas (PDF)

Los campos `extratitle`, `frontispiece`, `titlehead`, `subject`, `dedication`, `uppertitleback`, `lowertitleback`, `publishers` y `colophon` definen las páginas de título del PDF (solo LaTeX/PDF; en HTML se ignoran). Son **metadatos multilinea**: se escriben con el bloque YAML literal (`|`), y el contenido se procesa como markdown normal. El campo `subtitle` también admite el bloque literal (`|`) con las mismas reglas para escribir varias líneas en la portada:

- El **doble espacio al final de línea** produce un salto de línea (`\\`).
- Una **línea en blanco** separa párrafos: se renderizan sin indentación en la portada/páginas de título (en el subtitle, `\subtitle` se redefine como long para permitirlo).
- Una línea con solo `::` produce un espacio vertical (`\vspace{\baselineskip}`).
- `uppertitleback` y `lowertitleback`: texto en `footnotesize`, interlineado 1 y sin indentación.
- `extratitle`: texto con letra normal en un bloque del 75% del ancho centrado, centrado **horizontal y verticalmente** en su página.
- `frontispiece`: página anterior a la portada, con el contenido anclado al fondo (relleno vertical antes). Si no hay `extratitle` ni `title-image`, la página de extratitle se llena por defecto con el `title`.
- `titlehead`, `subject`, `publishers`: elementos de la portada en letra normal. `subject` y `publishers` aceptan un solo valor o un array de strings (como `author`): los items se unen con ", ". Orden de la portada: `author` → `title` → `subtitle` → `subject` → `titlehead` → `date` → `publishers`, con espaciado normal de 1 baselineskip.
- `publishers-image`: imagen que sustituye al texto de `publishers` en la portada (solo LaTeX/PDF; si existe, el texto se ignora). Mismo mecanismo que `title-image`: ruta relativa al directorio del documento (o absoluta), centrada, con un **ancho máximo de 150px** (150pt a 72dpi; si la imagen natural es más pequeña se muestra a tamaño natural; si es mayor, se escala conservando la proporción). Formatos soportados: `jpg`, `jpeg`, `png` y `pdf`.
- `endpapers`: imagen de fondo (guardas) que cubre la hoja completa **solo en la primera página** del PDF, y **solo si esa página es la hoja de guarda en blanco** que se inserta antes de la página de extratitle (extratitle en la 3): si no existe esa página en blanco, el endpaper no se agrega en ningún caso. Solo LaTeX/PDF. Ruta relativa al directorio del documento (o absoluta). La imagen se mide y el **lado más corto** define la única dimensión fija (ancho o alto) = **tamaño de la hoja + 6mm**; la otra dimensión sigue la proporción (`keepaspectratio`): la imagen cubre la hoja sin deformarse. El tamaño de la hoja se toma del `documentclass`/`geometry` reales (incluido el override por proyecto), no se hardcodea. Formatos soportados: `jpg`, `jpeg`, `png` y `pdf`.
- `dedication`: texto con letra normal alineado a la derecha ocupando el 50% del ancho (como el dictum), con `\vspace*{7\baselineskip}` antes del contenido.
- `colophon`: colofón final del documento (solo LaTeX/PDF). Texto con letra normal en un bloque del 75% del ancho centrado, con el texto centrado dentro del bloque y `\vspace*{7\baselineskip}` antes. Con `title-image` definido, la imagen de portada también **abre el colofón** (antes del texto, centrada, máx. 50% del textwidth); con `publishers-image`, el logo **cierra el colofón** (después del texto, máx. 25% del textwidth). Siempre ocupa solo una página **par** al final del documento (si el body termina en página impar, el colofón va en la siguiente par; si termina en par, se inserta una página impar en blanco y el colofón va en la siguiente par). La página del colofón no muestra número de página y es siempre la última del documento.
- `title-image`: imagen que sustituye al texto del título en la portada del PDF (solo LaTeX/PDF; el resto de los formatos y el slug siguen usando `title`). Si está definido, también **sustituye el contenido de `extratitle`**: la página de extratitle (la tercera, tras dos páginas en blanco) muestra la imagen en lugar del texto (el campo `extratitle` se ignora). Ruta relativa al directorio del documento (o absoluta). En la portada la imagen se muestra centrada con un **ancho máximo del 80%** de la caja de texto; en la página de extratitle, hasta el **100% del ancho del bloque** (`0.75\textwidth`). Si la imagen natural es más pequeña se muestra a tamaño natural (no se amplía); si es mayor, se escala conservando la proporción. Formatos soportados: `jpg`, `jpeg`, `png` y `pdf`. Nota: cambiar el archivo de imagen sin modificar el `.md` no invalida la caché.

```yaml
---
title: 'Mi libro'
extratitle: 'Colección Editorial'
dedication: 'Para quienes sostienen la vida'
uppertitleback: |
  primera linea
  segunda linea

  ::

  tercera línea
lowertitleback: |
  Pie de portada con
  dos líneas
---
```

Orden de páginas en el PDF (flujo KOMA-Script): dos páginas en blanco (1 y 2) → `extratitle` (página 3, centrada) → `frontispiece` (página 4, contenido al fondo) → portada (impar: `author`, `title`, `subtitle`, `subject`, `titlehead`, `date`, `publishers`) → `uppertitleback` (arriba) y `lowertitleback` (abajo) en el reverso de la portada → `dedication` (página impar siguiente, bloque del 50% del ancho alineado a la derecha) → contenido → `colophon` (página par final, bloque del 75% del ancho centrado). Sin `extratitle`, `frontispiece`, `title-image` ni `titlebacks`, el documento abre con la portada en la página 1 (sin páginas en blanco). El espacio vertical post-portada/índice sigue el mismo criterio que sin estas páginas: se aplica cuando al contenido le sigue un párrafo normal.

## Citas bibliográficas

Cuando se encuentran archivos `.bib` en el proyecto (auto-descubrimiento), las citas en Markdown siguen el formato pandoc `[@clave]`:

```markdown
Este fenómeno ha sido ampliamente estudiado [@garcia2023; @mendez2024].

Según @ejemplo2024, el uso de citekeys facilita la gestión de referencias.
```

## Campos personalizados

El frontmatter acepta campos arbitrarios. Los campos no reconocidos se ignoran en el procesamiento estándar; `validate` advierte sobre ellos (ver la sección Campos).
