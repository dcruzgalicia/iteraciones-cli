# Temas y templates

El sistema de temas controla el HTML que envuelve el contenido de cada página: el layout principal, el template de pandoc y los templates por tipo de documento.

## Estructura de archivos

```
proyecto/
  layouts/
    default.html       # layout principal (opcional: sobreescribe el del tema)
  pandoc/
    template.html      # template de pandoc (opcional: sobreescribe el del tema)
  templates/
    file.html          # template para tipo 'file' (opcional)
    collection.html    # template para tipo 'collection' (opcional)
    author.html        # ... y así para cada tipo
```

## Jerarquía de resolución

Para cada archivo, la resolución sigue tres niveles de prioridad:

1. **Proyecto** — `cwd/layouts/default.html`, `cwd/pandoc/template.html`, `cwd/templates/{type}.html`
2. **Tema built-in seleccionado** — `themes/{name}/layouts/…`
3. **CLI defaults** — raíz del paquete (tema `light` por defecto)

Si un archivo existe en el proyecto, tiene prioridad absoluta sobre el tema seleccionado.

## Temas integrados

### `light` (por defecto)

Tema claro con tipografía sans-serif. Se usa cuando `theme:` no está declarado o está vacío en `_iteraciones.yaml`.

### `dark`

Tema oscuro. Para activarlo:

```yaml
# _iteraciones.yaml
theme: 'dark'
```

## Seleccionar un tema

```yaml
# _iteraciones.yaml
theme: 'dark'
```

Si se declara un nombre no reconocido, se usa `light` con un aviso en `stderr`.

## Personalizar el layout

El layout principal (`layouts/default.html`) es un template HTML con variables del motor de templates de iteraciones. Las variables se acceden con la sintaxis `$nombre-variable$`.

Variables disponibles en el layout:

| Variable | Descripción |
|----------|-------------|
| `$site-title$` | Título del sitio (`site.title`) |
| `$site-tagline$` | Tagline del sitio (`site.tagline`) |
| `$site-lang$` | Idioma (`site.lang`) |
| `$if(site-logo)$$site-logo$$endif$` | Ruta al logo (condicional) |
| `$page-title$` | Título del documento actual |
| `$body$` | HTML del contenido del documento |
| `$content-before$` | Slot para bloques de región `content-before` |
| `$content-after$` | Slot para bloques de región `content-after` |
| `$sidebar-primary$` | Slot para bloques de región `sidebar-primary` |
| `$sidebar-secondary$` | Slot para bloques de región `sidebar-secondary` |
| `$footer-left$` | Slot para bloques de región `footer-left` |
| `$footer-center$` | Slot para bloques de región `footer-center` |
| `$footer-right$` | Slot para bloques de región `footer-right` |

## Templates por tipo

Cada tipo de documento puede tener su propio template HTML en `templates/{type}.html`. Este template recibe el HTML fragment producido por pandoc e inyecta las variables del contexto del tipo.

Para sobreescribir solo el template de artículos:

```
proyecto/
  templates/
    file.html   # sobreescribe solo el template de 'file'
```

Los demás tipos usarán el template del tema activo.

## Template de pandoc

El archivo `pandoc/template.html` es el template que pandoc usa para convertir Markdown a HTML fragment. Rara vez necesita modificación.

## Color de acento

El color de acento controla los colores primarios del CSS generado con Tailwind CSS v4. Se configura en `_iteraciones.yaml`:

```yaml
site:
  accent: 'blue'   # cualquier color Tailwind v4 con escala completa
```

Ver [docs/configuration.md](configuration.md) para la lista de colores válidos.
