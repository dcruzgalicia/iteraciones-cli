# Piloto universitario

Este documento define un piloto acotado para publicar un número de una revista
académica o estudiantil con `iteraciones`, sin intentar reemplazar OJS ni
DSpace. El piloto produce un sitio de consulta, PDF y EPUB, y un paquete de
metadatos para cargar en el repositorio institucional.

No implementa el piloto: define alcance, requisitos y criterios para decidir
si vale la pena.

## Resumen

| | |
|---|---|
| Caso | Un número de revista, cuaderno o memoria. |
| Volumen | 8 a 12 artículos, más una presentación y una ficha por autora. |
| Formatos | HTML, PDF y EPUB; Markdown fuente para preservación. |
| Duración | 6 semanas de preparación y cierre. |
| Equipo | 1 editor/a, 1 asistente editorial, 1 persona técnica, autores. |
| Fuera de alcance | OJS completo, DSpace completo, revisión por pares, OAI-PMH dinámico, DOI, SSO. |

El mismo esquema sirve para un cuaderno de prácticas o una memoria: cambia el
título y el número de piezas, no la arquitectura.

## Alcance

El piloto publica **un solo número** con:

- Una `collection` que representa el número y reúne los artículos.
- 8 a 12 artículos como `file`, con metadatos completos.
- Una presentación o editorial.
- Fichas de autoras y autores como `creator`.
- Una home y un índice del número.
- HTML navegable, PDF del número completo y EPUB del número.
- Un paquete de preservación con fuentes, configuración, versiones y
  checksums.

El equipo editorial trabaja en Markdown. No edita HTML, LaTeX ni CSS. Las
portadas y el diseño salen de la plantilla y de la configuración del proyecto.

### Lo que el piloto sí demuestra

- Que un equipo pequeño puede publicar un número sin aprender LaTeX.
- Que el mismo contenido sirve para web, PDF, EPUB y preservación.
- Que los metadatos se pueden mapear a Dublin Core y cargar a mano en OJS o
  DSpace.
- Que el sitio es accesible y que el paquete se puede reconstruir.

### Lo que el piloto no demuestra

- Que `iteraciones` reemplaza un repositorio institucional.
- Que soporta revisión por pares, roles, envíos o flujos de OJS.
- Que cosecha OAI-PMH o deposita en DSpace por API.
- Que asigna DOI o identificadores persistentes.
- Que sirve para varias revistas o varios números a la vez.

## Requisitos

### Metadatos

Cada artículo debe declarar, como mínimo:

| Campo | Dublin Core | Obligatorio | Ejemplo |
|---|---|---|---|
| `title` | `dc:title` | Sí | «Informe de ejemplo» |
| `creator` | `dc:creator` | Sí | «Ana Ejemplo» |
| `date` | `dc:date` | Sí | `2026-05-01` |
| `description` | `dc:description` | Sí | Resumen breve. |
| `abstract` | `dc:description` | Sí | Resumen completo. |
| `subject` | `dc:subject` | Sí | Materia o temas. |
| `keywords` | `dc:subject` | Sí | Palabras clave. |
| `publisher` | `dc:publisher` | Sí | Editorial o institución. |
| `language` | `dc:language` | Sí | `es-MX`. |
| `license` | `dc:rights` | Sí | `CC-BY-NC-ND-4.0` o la que apruebe el equipo. |
| `identifier` | `dc:identifier` | Sí | Folio local del artículo. |
| `source` | `dc:source` | No | Procedencia. |
| `relation` | `dc:relation` | No | Número o serie. |
| `coverage` | `dc:coverage` | No | Cobertura temporal o geográfica. |
| `doi` | `dc:identifier` | No | DOI si ya existe; el piloto no lo asigna. |

El número completo, como `collection`, declara `title`, `date`, `publisher`,
`license`, `collectionCreator`, `collectionCreatorPrefix`, `description` y
`files[]`.

El mapeo se entrega en una hoja de cálculo o CSV con una fila por artículo.
Ese archivo es el contrato con OJS/DSpace; no lo genera la CLI.

### Accesibilidad

El piloto toma como referencia WCAG 2.2 nivel AA para el sitio HTML. No se
promete que cada PDF sea accesible, pero sí que el HTML no tenga barreras
básicas.

Requisitos:

- Un solo `h1` por página y jerarquía de encabezados sin saltos.
- Texto alternativo en imágenes de contenido y retratos.
- Contraste suficiente en el tema elegido.
- Navegación completa con teclado, incluido el menú y los enlaces de
  descarga.
- Enlaces con texto descriptivo; no «clic aquí».
- Idioma declarado en el HTML (`lang`).
- Formularios o componentes interactivos solo si son necesarios; el sitio es
  estático.
- PDF con texto seleccionable, no imágenes de páginas.

Verificación: revisión automática con axe DevTools o Lighthouse en la home,
un artículo, el índice del número y una ficha de autora; revisión manual con
teclado; y una lista de comprobación firmada por el equipo.

### Preservación

El paquete de cierre incluye:

- Markdown fuente de todos los artículos y de la colección.
- `iteraciones.config.yaml`.
- `bun.lock` y el tarball de `iteraciones-cli` en `vendor/`.
- `package.json` con la versión fijada.
- PDF, EPUB y HTML publicados.
- Hoja de metadatos en CSV.
- `README` con la versión de Pandoc, LaTeX, Bun y del sistema operativo.
- `SHA256SUMS` de los archivos del paquete.

Criterio de preservación: el paquete se reconstruye en una máquina limpia con
las versiones documentadas y produce los mismos archivos, salvo diferencias
de fecha o de metadatos de compilación. Se guarda una copia en el repositorio
institucional o en el archivo que defina la universidad.

Si se activa PDF/X-1a, el PDF debe pasar la validación del build; si no se
activa, no se declara PDF/X.

## Integración con OJS y DSpace

El piloto no reemplaza ninguno de los dos. Entrega materiales para una carga
manual o semiautomática.

| Sistema | Qué se integra | Cómo |
|---|---|---|
| OJS | Metadatos Dublin Core del número y de cada artículo. | CSV/hoja de cálculo revisada por el equipo; carga manual en el número. |
| OJS | PDF de cada artículo como gálley. | El PDF se sube a OJS; el HTML queda como sitio de consulta. |
| DSpace | Metadatos Dublin Core. | CSV/hoja de cálculo para la importación que use la biblioteca. |
| DSpace | PDF y EPUB como bitstreams. | Carga manual en el ítem o colección. |
| Ambos | Licencia, idioma, fecha y derechos. | Campos del mapeo Dublin Core. |
| Ambos | URL estable del sitio. | Dominio o subdominio que defina la universidad; no lo genera la CLI. |

### Lo que no se integra

- **OAI-PMH dinámico:** no hay endpoint ni cosecha automática. El piloto genera un `oai.xml` estático para revisar el mapeo.
- **API de OJS o DSpace:** no hay depósito automático, autenticación ni
  sincronización.
- **Flujo editorial de OJS:** envíos, revisión por pares, roles, decisiones y
  notificaciones quedan fuera.
- **DOI:** no se asigna ni se registra; si el equipo ya tiene DOI, se escribe
  como texto.
- **Identificadores persistentes, SSO y permisos:** fuera del piloto.
- **Búsqueda con facetas:** el sitio tiene listas y palabras clave, no un
  buscador facetado.
- **Multi-revista o multi-número:** el piloto es un número.

### Exportación OAI-PMH estática

El piloto incluye una prueba acotada de exportación: `format.html.site.oai: true`
genera `oai.xml` con un `ListRecords` Dublin Core. No es un servidor OAI-PMH;
sirve para validar el mapeo antes de conectar un repositorio.

Pasos del piloto:

1. Activar `site.oai` y `site.url` en el proyecto del número.
2. Construir el sitio y revisar que `oai.xml` tenga un registro por artículo y
   por colección.
3. Comparar los campos con la plantilla de carga de la biblioteca.
4. Cargar una muestra de cinco registros en DSpace u OJS y confirmar que los
   metadatos y las URLs resuelven.

Mapeo Dublin Core:

| Elemento | Origen |
|---|---|
| `dc:title` | `title` |
| `dc:creator` | `creator`; si falta, «Anónima». |
| `dc:subject` | `keywords` |
| `dc:description` | `abstract` o `description` |
| `dc:date` | `date`; si falta, la fecha de modificación del archivo. |
| `dc:publisher` | `publisher` |
| `dc:identifier` | `identifier`, `doi`, `isbn` o la ruta del Markdown. |
| `dc:rights` | `rights` o `license` |
| `dc:type` | `Text` para `file`; `Collection` para `collection`. |
| `dc:language` | `language` del frontmatter, si existe. |

La exportación es reproducible: el orden de los registros se ordena por ruta y
solo cambia el `responseDate` de cada corrida.

## Criterios de éxito

El piloto se considera exitoso si cumple todos estos puntos. Cada uno tiene
evidencia verificable.

| Criterio | Meta | Evidencia |
|---|---|---|
| Contenido | 8 a 12 artículos, presentación y fichas de autoría publicados. | Índice del número y árbol de `dist/files/`. |
| Build | `iteraciones validate` con 0 errores y `iteraciones build --full` con código 0. | Salida de los comandos. |
| Tiempo de build | Menos de 20 minutos en una laptop de referencia, sin pasos manuales sobre `dist/`. | Registro de tiempo. |
| Metadatos | 100% de los artículos tienen los 11 campos obligatorios. | CSV validado contra la lista. |
| Accesibilidad | 0 violaciones críticas o serias en axe DevTools en 4 plantillas: home, artículo, número y autora. | Captura o reporte de axe. |
| Teclado | Menú, enlaces, descargas y navegación funcionan sin ratón. | Lista de comprobación firmada. |
| PDF | El número abre, el índice tiene entradas y los folios coinciden; 0 enlaces internos rotos en una muestra de 20. | Revisión manual. |
| EPUB | `epubcheck` sin errores en el número. | Reporte de `epubcheck`. |
| Enlaces | 0 enlaces rotos en una muestra de 50 enlaces del sitio. | Reporte del verificador. |
| OJS/DSpace | Los 11 campos obligatorios tienen un mapeo definido a Dublin Core; 3 artículos de prueba se cargan en staging sin corregir metadatos. | Hoja de mapeo y captura de la carga. |
| Preservación | `SHA256SUMS` verifica; el paquete se reconstruye en una máquina limpia al cierre. | Registro de la reconstrucción. |
| Reconstrucción diferida | A los 30 días, un segundo build limpio vuelve a pasar. | Registro con fecha. |
| Autonomía | 2 personas del equipo editorial publican un artículo nuevo sin ayuda técnica después de 2 sesiones. | Observación y checklist. |
| Sin edición manual | 0 cambios manuales en HTML, LaTeX o CSS durante el piloto. | Historial de Git. |

Si falla un criterio, el piloto se documenta como parcial y se decide si se
corrige o se detiene. No se maquilla el resultado.

## Plan de seis semanas

| Semana | Trabajo | Salida |
|---|---|---|
| 1 | Acordar alcance, número, licencia, metadatos y responsables. | Documento de alcance y CSV vacío. |
| 2 | Montar el proyecto, la plantilla, el repositorio y el build. | `build` de un artículo de prueba. |
| 3 | Cargar los artículos y las fichas; completar metadatos. | Número completo en HTML. |
| 4 | Ajustar PDF, EPUB, portada, índice y descargas. | PDF y EPUB del número. |
| 5 | Accesibilidad, enlaces, mapeo a OJS/DSpace y prueba de carga. | Reportes y CSV definitivo. |
| 6 | Paquete de preservación, reconstrucción limpia y retrospectiva. | Paquete, `SHA256SUMS` y decisión. |

## Roles

| Rol | Responsabilidad |
|---|---|
| Editor/a | Decide contenido, orden, licencia y criterios editoriales. |
| Asistente editorial | Revisa metadatos, autoras, imágenes y enlaces. |
| Persona técnica | Mantiene el proyecto, el build, el hosting y el paquete de preservación. |
| Autoras y autores | Entregan Markdown o texto y aprueban metadatos. |
| Biblioteca o repositorio | Define el mapeo y hace la carga en OJS/DSpace. |

Una persona puede cubrir más de un rol en un piloto pequeño, pero la
responsabilidad de la carga en OJS/DSpace debe ser explícita.

## Entregables

- Sitio HTML publicado.
- PDF del número y PDF por artículo.
- EPUB del número.
- Markdown fuente y configuración.
- CSV de metadatos Dublin Core.
- Reporte de accesibilidad y enlaces.
- Paquete de preservación con checksums.
- Retrospectiva con la decisión de continuar, corregir o detener.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El equipo no tiene Pandoc, LaTeX o ImageMagick. | Preparar el entorno en la semana 2 y documentar la instalación. |
| Los metadatos llegan incompletos. | Validar el CSV antes de cargar y usar `iteraciones validate`. |
| OJS/DSpace exige un formato que no está mapeado. | Probar 3 artículos en staging antes de la carga completa. |
| El PDF no cumple PDF/X. | Decidir desde el inicio si se requiere; si sí, activar y validar. |
| El admin de Sveltia no encaja con la CSP o el hosting. | Publicar el admin aparte o dejarlo fuera del alcance. |
| El sitio no se puede reconstruir en 30 días. | Congelar versiones, guardar el tarball y probar la reconstrucción. |

## Decisión

Al cierre, el equipo responde:

1. ¿Se cumplieron todos los criterios de éxito?
2. ¿El trabajo técnico fue menor que el flujo anterior?
3. ¿OJS/DSpace recibió los metadatos sin retrabajo?
4. ¿El paquete se reconstruye sin ayuda del proveedor?
5. ¿Vale la pena repetirlo para el siguiente número?

Si las respuestas 1 y 4 son sí, el piloto se puede repetir. Si la 3 es no, el
siguiente paso es definir una exportación de metadatos más automatizada, no
ampliar el piloto a toda la institución.
