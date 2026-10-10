# language: es
Característica: los filtros de preámbulo que trae el paquete

  Como quien ajusta el diseño de su PDF
  Quiero saber qué filtros existen, qué hace cada uno y poder sustituir uno
  Para no reescribir el preámbulo entero y para no romper la cola de imprenta

  Regla de negocio: El catálogo de filtros del paquete

    Escenario: El catálogo tiene 31 filtros
      Entonces los filtros del paquete son 31

    Escenario: Cada filtro dice qué hace
      Entonces cada filtro del paquete tiene descripción

    Escenario: La cola de imprenta es siempre la última
      Entonces la cola de imprenta es '["97-eso-pic", "98-crop", "99-pdfx"]'

    Escenario: Todos los filtros traen su .tex
      Entonces todos los filtros del paquete traen su .tex

    Escenario: Un filtro desactivado no viene precargado
      Dado que los filtros desactivados son '["15-hyphenation-rules"]'
      Entonces los filtros precargados son 30
      Y el filtro "15-hyphenation-rules" no viene precargado

  Regla de negocio: El .tex del proyecto gana al del paquete

    Escenario: Un .tex propio sustituye al del paquete
      Dado que el proyecto reemplaza el filtro "15-hyphenation-rules" con su propio .tex
      Entonces el filtro "15-hyphenation-rules" trae el contenido del proyecto

  Regla de negocio: Un .tex del proyecto sirve para todos los types

    Esquema del escenario: El .tex propio gana cuando el type no tiene variante en el paquete
      Dado que el proyecto pone su propio .tex de "<filtro>" en "<directorio>"
      Entonces el filtro "<filtro>" del type "<type>" trae el contenido del proyecto

      Ejemplos:
        | filtro               | directorio | type         |
        | 09-tables            | preamble   | collection   |
        | 09-tables            | preamble   | creator      |
        | 09-tables            | preamble   | intervention |
        | 20-alignment         | preamble   | collection   |
        | 14-sectioning        | preamble   | creator      |
        | 15-hyphenation-rules | preamble   | intervention |

    Escenario: El type con variante propia en el paquete sigue mandando sobre el .tex genérico del proyecto
      Dado que el proyecto pone su propio .tex de "16-toc-styling" en "preamble"
      Entonces el filtro "16-toc-styling" del type "collection" NO trae el contenido del proyecto
      Y el filtro "16-toc-styling" del type "file" trae el contenido del proyecto

    Escenario: Un .tex del type en el proyecto gana al .tex genérico del proyecto
      Dado que el proyecto pone su propio .tex de "20-alignment" en "preamble"
      Y que el proyecto pone su propio .tex de "20-alignment" en "preamble-collection"
      Entonces el filtro "20-alignment" del type "collection" trae el contenido del proyecto