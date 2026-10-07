export const DESCRIPCIONES_LUA: Record<string, string> = {
  'html/01-dictum': 'Convierte Div.dictum a <blockquote class="dictum"> (formato HTML).',
  'html/02-verse': 'Convierte Div.verse a <div class="verse"> (formato HTML).',
  'html/03-center': 'Convierte Div.center a <div class="center"> (formato HTML).',
  'html/04-flushright': 'Convierte Div.flushright a <div class="flushright"> (formato HTML).',
  'html/05-spacer':
    'Convierte Div.spacer a un <div> con la utilidad de Tailwind `h-[1.5em]` (formato HTML): el separador vertical del marcador :: mide ~1.5em, el interlineado del tamaño base. Es una utilidad y no una clase de CSS propia porque el escáner de Tailwind la genera desde el HTML (#2487). La clase noindent se ignora (la sangría de párrafo es LaTeX-only).',
  'html/06-subparagraph':
    'Convierte ### (h3) en un <div> con las utilidades de Tailwind del \\subparagraph de LaTeX (KOMA-Script: negrita + itálica) antes de que pandoc intente generar un h7 (que no existe en HTML). Son utilidades y no una clase de CSS propia porque el escáner de Tailwind las genera desde el HTML (#2487). Los h1 y h2 se manejan con --shift-heading-level-by=4.',
  'html/07-titlepage-meta':
    "#2487 — los campos de la portada que LaTeX pasa por markdown (los mismos que lista latex/07-titlepages.lua) llegan aquí como texto plano en --metadata: el template los emite tal cual, así que un `collectionCreatorPrefix: *Edición*` salía con los asteriscos en vez de en cursiva. Este filtro los vuelve a leer como markdown y deja el resultado como inlines, que el template ya emite formateado. Los que no son markdown (title, creator, date) no se tocan. De los nombres de las creadoras hay un campo aparte (`author-names`, `collection-creator-names`), que llega como lista porque se pasa un --metadata por nombre. Cada uno va en un span `whitespace-nowrap` y se unen con ', ': es el equivalente del \\mbox de cada creator en LaTeX, para que la línea se parta entre nombres y nunca dentro de uno.",
  'latex/01-spacer':
    'Convierte Div.spacer en \\vspace{\\baselineskip} (formato LaTeX). Si el Div tiene la clase noindent (caso :;), agrega \\noindent al primer párrafo siguiente (solo si es Para).',
  'latex/02-dictum':
    'Convierte Div.dictum a \\dictum[author]{quote} (formato LaTeX), con \\noindent al párrafo siguiente si es Para. Soporta atributo width (0.1–1.0) para ancho personalizado. El espaciado lo gestiona el entorno dictum (preamble 21-dictum.tex).',
  'latex/03-verse':
    'Convierte Div.verse al entorno \\begin{verse}...\\end{verse} (formato LaTeX), con \\noindent al párrafo siguiente si es Para. El espaciado vertical lo gestiona el entorno verse (preamble 22-verse.tex).',
  'latex/04-center': 'Convierte Div.center al entorno \\begin{center}...\\end{center} (formato LaTeX).',
  'latex/05-flushright': 'Convierte Div.flushright al entorno \\begin{flushright}...\\end{flushright} (formato LaTeX).',
  'latex/06-mbox-sentence-end':
    'Envuelve en \\mbox{} las últimas 3 palabras de la oración final del párrafo (únicas palabras que reciben mbox: sin mbox por oración no final ni de inicio de oración). Solo dentro de bloques Para. El conteo usa palabras REALES: un grupo de énfasis (\\emph{...}) aporta sus palabras internas individualmente. Regla del wrap (últimas 3): A. sin énfasis      → \\mbox{ejemplo final.} B. dentro del grupo → \\emph{...en \\mbox{carne propia.}} (wrap interno) C. toca el inicio   → en \\mbox{\\emph{carne propia.}} (grupo completo) D. grupo de 1       → \\mbox{dice \\emph{ella.}} (extiende hacia atrás) Exclusión: []{.no-mbox} en el párrafo omite el mbox automático.',
  'latex/07-titlepages':
    "Convierte los campos de frontmatter multilinea (subtitle, extratitle, frontispiece, titlehead, subject, dedication, uppertitleback, lowertitleback, publishers, colophon) a LaTeX para la portada, las páginas de título internas y el colofón final. subject y publishers aceptan un array de strings (como author): se unen con ', '. Solo corre en la pasada latex (en HTML los campos se ignoran o los serializa el compositor HTML con \\n → espacio). titleImage (imagen de portada) no es contenido markdown: la ruta pasa literal como RawInline latex. El valor llega como MetaBlocks (frontmatter YAML |: los párrafos ya son bloques markdown) o MetaInlines (string simple). Se serializa con pandoc.write: el doble espacio al final de línea → \\\\, y un párrafo con solo :: (o :;) → \\vspace{\\baselineskip} (+ \\noindent). El resultado se guarda como MetaInlines(RawInline('latex')): el template lo emite sin re-escape.",
  'latex/08-textsize':
    'Convierte clases de tamaño LaTeX (\\small, \\footnotesize, \\Large, etc.) en comandos de tamaño raw. Soporta divs bloque (::: {.small}...:::) y spans inline ([texto]{.footnotesize}). Solo LaTeX: en HTML las clases se mantienen para estilizacion CSS.',
  'latex/09-quote-noindent':
    'Inserta \\noindent al primer párrafo normal que sigue a un BlockQuote (blockquote de markdown, convertido al entorno quote en LaTeX). El comportamiento es el mismo que dictum (02) y verse (03): tras un entorno list, el párrafo siguiente no debe sangrarse.',
  'latex/10-cjk':
    'Convierte Div.japanese/.chinese/.korean al entorno CJKutf8 de LaTeX (\\begin{CJK}{UTF8}{min|gbsn|ksc}...\\end{CJK}). El encoding por clase: .japanese → min (japonés), .chinese → gbsn (chino simplificado), .korean → ksc (coreano). En HTML el texto CJK funciona nativo (UTF-8): el div se ignora y el contenido fluye sin transformación. El paquete se carga en el preamble 27-cjk.tex.',
  'latex/11-uppercase':
    'Convierte el span [texto]{.uppercase} a \\MakeUppercase{texto} (solo LaTeX: el writer de pandoc ignora la clase y la deja como {texto}). En HTML el span conserva la clase uppercase y Tailwind la estiliza (text-transform).',
  'latex/12-mbox':
    'Convierte el span [texto]{.mbox} a \\mbox{texto} (solo LaTeX: evita que pandoc rompa el grupo de palabras entre lineas). En HTML el span conserva la clase mbox para estilizacion CSS.',
  'latex/13-spacing':
    'Convierte Div con atributo spacing en \\begin{spacing}{valor}...\\end{spacing} Requiere el paquete setspace (cargado en 03-spacing.tex).',
  'latex/14-textls':
    'Convierte spans/divs con atributo value en \\textls{valor}{texto} (microtype). Uso inline: [texto]{.textls value=-20} Uso bloque: ::: {.textls value=-20} párrafo ::: Valor: negativo = compresión, positivo = expansión (rango típico -100 a 100). Solo LaTeX: en HTML se ignora.',
  'semantic/ast/02-double-colon-noindent':
    'Convierte párrafos con solo ":;" en Div.spacer noindent (semántico). Solo transforma párrafos de nivel superior (no dentro de otros bloques).',
  'semantic/ast/03-qr-url':
    'Genera código QR como imagen JPG 300dpi a partir de [url]{.qr width="Xcm"}. Imagen generada en .iteraciones/processed-images/ del proyecto (content-addressed por hash MD5). Requiere: zxing-wasm (bun add zxing-wasm) y ImageMagick (magick).',
  'semantic/ast/04-image-paths':
    'Reescribe en el AST las rutas de imagen que el preproceso movió a assets/images (#2460). El mapa llega por fichero (ITERACIONES_PATHS_JSON), nunca por argv: crece con el número de imágenes. Va después de 03-qr-url (orden del directorio) y, si no hay mapa, no toca nada.',
  'semantic/string/01-double-colon':
    'Convierte líneas con solo "::" en Div.spacer (semántico, sin formato específico). El marcador es una línea cuyo único contenido es :: (pandoc normaliza los espacios trailing en el AST, así que ":: " es equivalente a "::").',
};

export const DESCRIPCIONES_PREAMBLE: Record<string, string> = {
  '01-documentclass': '\\documentclass con clase KOMA-Script y opciones por defecto',
  '02-fonts':
    'Codificación (fontenc, inputenc) y fuente principal. newtxtext + newtxmath (familia Times, incluida en TeX Live/MacTeX full): mathptmx no tiene shape small-caps reales y \\scshape degeneraba a regular en silencio (autores del maketitle, TOC). newtx sí los provee.',
  '03-spacing': 'Interlineado con setspace (\\setstretch{1.5})',
  '04-margins': 'Márgenes con geometry (2.54cm, carta)',
  '05-language':
    'Idioma con babel (configurable por el lang de la configuración; el valor lo expone el CLI como metadata babel-lang en cada conversión markdown → latex)',
  '06-headers': 'Encabezados con scrlayer-scrpage',
  '07-typography': 'Microtipografía (microtype) y penalizaciones de composición',
  '08-hyperref': 'Enlaces PDF (hidelinks)',
  '09-tables': 'Paquetes de tablas (longtable, booktabs, array, calc)',
  '10-lists': 'Listas con enumitem (noitemsep, nosep)',
  '11-bibliography': 'Bibliografía (csquotes, biblatex con estilo APA)',
  '12-counters': 'Contadores de secciones (secnumdepth, tocdepth)',
  '13-setkomafont': 'Fuentes de la portada (\\setkomafont para title, subtitle, author, date)',
  '14-sectioning': 'Estilo de secciones (\\RedeclareSectionCommand para todos los niveles)',
  '15-hyphenation-rules': 'Agrega \\hyphenation{} con nombres propios de ejemplo',
  '16-toc-styling':
    "Personaliza el indice (TOC): nombre, espaciado, fuentes y lideres \\languagename sigue al idioma activo de babel (configuración lang): sin él, un PDF con lang no-español fallaba con 'not defined at language spanish'. \\BeforeTOCHead ajusta solo la apariencia del TOC: el subsubsection del cuerpo mantiene sus propios skips (14-sectioning.tex).",
  '17-toc-section':
    'Redefine \\tableofcontents para usar \\subsubsection* en lugar de \\chapter* (el pipeline usa --top-level-division=section: un \\chapter* crearía un salto de página fantasma). Riesgo conocido: \\tocbasic@listhead@toc es un comando interno de KOMA-Script (el manual lo documenta como interno pero estable); no existe equivalente público para cambiar el nivel del heading de una lista. Guardia: el smoke PDF de cli-layer compila con toc: true (regresión ante cambios de KOMA). Revisar en cada actualización de TeX Live.',
  '18-bibliography-heading': 'Cambia titulo de bibliografia de chapter a subsubsection',
  '19-maketitle':
    "Personaliza \\maketitle: 2 baselineskip antes de title/author/date, titulo en mayusculas, y las páginas de título internas (extratitle, uppertitleback, lowertitleback, dedication) definidas en 28-titlepages.tex. Orden de páginas (cada elemento en recto con verso en blanco solo en twoside+openright; en oneside/openany van encadenados sin blanks): guarda del startpaper (pág 1, solo si startpaper) → courtesy page (solo si courtepage) → extratitle (pág impar, bloque del 75% del ancho centrado con \\vspace*{7\\baselineskip} antes, solo si definido) → frontispiece (pág par en twoside, siguiente a extratitle o con impar anterior en blanco si no hay extratitle) → portada (impar) → titlebacks (reverso de la portada; el \\vfill ancla el lowertitleback al fondo, sin minipage) → dedication (página impar en twoside, ancho completo justificado, centrado verticalmente) → blank verso (solo twoside+openright, el contenido siguiente empieza en página impar). \\titlepage@next/\\titlepage@nextdouble (28-titlepages.tex): \\clearpage + \\thispagestyle{empty} (+ página impar en twoside), SIN el \\setparsizes de \\next@tpage (que dejaría \\parindent a 0 en todo el documento). KOMA define \\subtitle con \\newcommand* (no-long): una línea en blanco en el argumento (párrafo del frontmatter |) rompe la compilación con 'Paragraph ended before \\subtitle was complete'. Se redefine como long (\\renewcommand sin estrella) para permitir subtítulos multilínea con párrafos. titleImage (campo del frontmatter, solo LaTeX/PDF): imagen que sustituye al texto del título en la portada. graphicx NO venía cargado en el preamble.",
  '20-alignment': 'Redefine center/flushright/flushleft sin espacio vertical extra',
  '20-pandocbounded':
    'pandoc 3.2.1+ envuelve \\includegraphics en \\pandocbounded para imágenes sin width/height explícito. Muestra la imagen a tamaño natural pero la escala si excede el ancho (\\linewidth) o alto (\\textheight) del texto. Dependencia: graphicx (cargado en 19-maketitle.tex).',
  '21-dictum': 'Configuración de epígrafes (\\dictumwidth, fuente del autor)',
  '22-verse': 'Redefine el entorno verse con márgenes y espaciado tipográfico',
  '23-quote': 'Redefine el entorno quote con margen izquierdo de 4em y espaciado tipográfico',
  '27-cjk': 'Soporte de caracteres CJK (japonés, chino, coreano) con pdflatex.',
  '28-titlepages':
    'Páginas de título (extratitle, frontispiece, titlehead, subject, dedication, uppertitleback, lowertitleback, publishers) para el flujo del pipeline. Los comandos KOMA originales solo GUARDAN el contenido (\\gdef): el renderizado vive en el \\maketitle original de KOMA. Como 19-maketitle.tex lo redefine, este archivo re-expone los comandos (idénticos a KOMA) y define \\titlebackformat, el formato que 19-maketitle.tex aplica al imprimir el contenido en sus páginas. El contenido llega serializado a LaTeX por el filter latex/10-titlepages.lua (markdown → latex: el doble espacio al final de línea → \\\\, una línea con solo :: → \\vspace{\\baselineskip}).',
  '29-text-decoration':
    'Decoración de texto inline (sintaxis markdown de pandoc): subrayado ([texto]{.underline} → \\ul), tachado (~~texto~~ → \\st) y resaltado (==texto== → \\hl). ulem con [normalem] para no redefinir \\emph; soul para \\hl con fondo amarillo (verificado con acentos en pdflatex).',
  '30-startpaper':
    'Startpaper (guardas): imagen de fondo SOLO en la página 1 (la hoja de guarda en blanco que se inserta antes de la página de extratitle, que está en la 3): en ninguna otra página. Modo COVER recortado: la imagen cubre la hoja sin espacios en blanco ni deformación, y se RECORTA (viewport + clip de graphicx) para que el visible sea exactamente el tamaño del papel. Cuando 98-crop está activo, el preamble dinámico agrega +6mm (3mm por lado) al cálculo para cubrir el stock más grande de las marcas de corte. La escala cover y la ventana central (en unidades naturales de la imagen) se calculan con l3fp en \\setstartpaper, a partir del \\sbox (a tamaño natural: \\wd = ancho, \\ht = alto) y de \\paperwidth/\\paperheight reales (documentclass o geometry, incluido el override del proyecto): no se hardcodea. El centro de la imagen se alinea con el centro de la hoja: el \\put en (.5\\paperwidth, ±.5\\paperheight) — el signo depende del grid de 97-eso-pic (desplaza el origen del \\put al borde superior); la caja 0×0 con \\hss/\\vss centra la imagen sobre ese punto.',
  '97-eso-pic':
    'Fondo de página con eso-pic (desactivado por defecto) La activación del grid se hace en RUNTIME y no cargando el paquete con opciones: 30-startpaper.tex ya carga \\usepackage{eso-pic} sin opciones de forma incondicional, y en LaTeX las opciones se fijan en el PRIMER \\usepackage (un segundo load con opciones distinta dispara "option clash"). Como la cola de imprenta (97-99) es deliberadamente la última (issue #1952), 97 nunca puede ser el primer cargador de eso-pic. Aquí se reproduce exactamente lo que hace la opción grid del paquete (ESO@gridtrue + añadir \\ESO@gridpicture al hook de fondo) con gridBG y texcoord, y los colores por defecto del filter; gridunit queda en mm, el default del paquete. Es el mismo tipo de acceso a internos que ya usa 30-startpaper.tex (\\ESO@HookIIIBG). El override por proyecto (preamble/97-eso-pic.tex) lo reemplaza por completo si se quieren parámetros distintos.',
  '98-crop':
    'Marcas de corte con crop (desactivado por defecto). noinfo: solo las líneas de corte, sin el texto de información ("jobname" — fecha — hora — page N — #índice) que este paquete crop imprime por defecto en el área de marcas.',
  '99-pdfx':
    'PDF/X-1a para impresión profesional (desactivado por defecto) pdfx escribe /TrimBox, /BleedBox y /CropBox vía \\pdfpagesattr en cada shipout y solo si el atributo está vacío: la línea \\pdfpagesattr{} que había aquí vaciaba esos boxes y producía un PDF/X-1a inválido sin TrimBox. Nota: PDF/X-1a excluye funciones interactivas por especificación: pdfx desactiva los enlaces (draft mode) — es el comportamiento correcto para imprenta, no un fallo. El estándar del proyecto es estrictamente PDF/X-1a:2001 (#1964): se usa la opción `x-1a1` (ISO 15930-1:2001). La opción desnuda `x-1a` del paquete equivale a `x-1a3` (PDF/X-1a:2003) — no 2001. La identificación XMP (pdfxid:GTS_PDFXVersion) la completa el template override de src/lib/resources/xmp/pdfx.xmp (#1967).',
};
