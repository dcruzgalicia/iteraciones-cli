# language: es
Característica: las reglas de la regresión visual

  Como quien cambia una coma en el frontmatter
  Quiero saber si eso movió algo en la página
  Para no tener que abrir los ochenta PDF a mano

  Regla de negocio: Las páginas se ordenan por número, no por texto

    Esquema del escenario: El orden de las páginas es numérico
      Cuando ordeno las páginas "<archivos>"
      Entonces el orden es "<esperado>"

      Ejemplos:
        | archivos | esperado |
        | p-10.png, p-2.png, p-1.png | p-1.png, p-2.png, p-10.png |
        | p-100.png, p-002.png, p-001.png | p-001.png, p-002.png, p-100.png |

  Regla de negocio: El diff de una página se llama con su número, y vive junto al snapshot

    Escenario: El nombre del diff lleva la página y su relleno
      Dado que la raíz del proyecto está vacía
      Entonces el nombre del diff de la página 5 es "index-page-005-diff.png"
      Y el nombre del diff de la página 128 es "index-page-128-diff.png"

    Escenario: El diff de un PDF de un subdirectorio va a su lado
      Dado que la raíz del proyecto está vacía
      Entonces el diff de "PROYECTO/visual/anexos/index.pdf" va junto a su snapshot

  Regla de negocio: El snapshot espeja `dist/files`

    Esquema del escenario: El nombre del snapshot
      Dado que la raíz del proyecto está vacía
      Entonces el slug de "<pdf>" es "<slug>"

      Ejemplos:
        | pdf | slug |
        | PROYECTO/dist/files/99-intervention.pdf | 99-intervention |
        | PROYECTO/Mi Documento.PDF | mi-documento |

    Esquema del escenario: La ruta del snapshot dentro del proyecto
      Dado que la raíz del proyecto está vacía
      Entonces el snapshot de "<pdf>" vive en "<esperado>"

      Ejemplos:
        | pdf | esperado |
        | PROYECTO/dist/files/index.pdf | visual/index.pdf |
        | PROYECTO/dist/files/anexos/index.pdf | visual/anexos/index.pdf |
        | PROYECTO/suelto.pdf | visual/suelto.pdf |
        | PROYECTO/otra/Mi Documento.pdf | visual/mi-documento.pdf |

  Regla de negocio: El desenfoque mide lo mismo en superficie física

    Esquema del escenario: La sigma del desenfoque sigue al dpi
      Dado que la raíz del proyecto está vacía
      Entonces el desenfoque a 150 dpi es 1
      Y el desenfoque a 300 dpi es 2
      Y el desenfoque a 600 dpi es 4

  Regla de negocio: Los defaults son los que hacen comparables dos snapshots

    Escenario: Los valores por defecto
      Dado que la raíz del proyecto está vacía
      Entonces los valores por defecto son dpi 300, umbral "0.005" y fuzz 15

    Esquema del escenario: Un flag inválido se rechaza nombrándolo
      Dado que la raíz del proyecto está vacía
      Cuando resuelvo las opciones visuales con "<flags>"
      Entonces las opciones visuales fallan diciendo "<motivo>"

      Ejemplos:
        | flags | motivo |
        | dpi=0 | --dpi inválido |
        | dpi=300.5 | --dpi inválido |
        | dpi=rapido | --dpi inválido |
        | threshold=-1 | --threshold inválido |
        | fuzz=101 | --fuzz inválido |

    Escenario: Flags válidos se aplican
      Dado que la raíz del proyecto está vacía
      Cuando resuelvo las opciones visuales con "dpi=150, threshold=0.1, fuzz=5"
      Entonces las opciones son dpi 150, umbral "0.1" y fuzz 5

  Regla de negocio: El directorio de trabajo vive dentro del proyecto cuando lo hay

    Escenario: Sin proyecto, el directorio de trabajo va al temporal
      Dado que la raíz del proyecto está vacía
      Y que el proyecto no tiene configuración
      Cuando resuelvo el directorio de trabajo del snapshot "doc"
      Entonces el directorio de trabajo está en "<temporal>/iteraciones-visual/doc"

    Escenario: Con proyecto, el directorio de trabajo va dentro
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene configuración
      Cuando resuelvo el directorio de trabajo del snapshot "doc"
      Entonces el directorio de trabajo está en "PROYECTO/.iteraciones/tmp/visual/doc"
      Y el caché del visual está en "PROYECTO/.iteraciones/tmp/visual/cache.json"

  Regla de negocio: Sólo se comparan PDF, y sólo se borran los diffs de un snapshot

    Escenario: Al listar sólo se quedan los PDF
      Dado que la raíz del proyecto está vacía
      Y que el directorio de salida tiene "b.pdf, sub/a.pdf, nota.txt"
      Cuando listo los PDF de la salida
      Entonces los PDF son "b.pdf, sub/a.pdf"

    Escenario: Un directorio que no existe no da PDF
      Dado que la raíz del proyecto está vacía
      Cuando listo los PDF de la salida
      Entonces los PDF son ""

    Escenario: Borrar los diffs de un snapshot no toca los demás
      Dado que la raíz del proyecto está vacía
      Y que el directorio de salida tiene "index-page-005-diff.png, index-page-012-diff.png, otro-page-001-diff.png, index.pdf"
      Cuando borro los diffs del snapshot "index"
      Entonces en el directorio quedan "index.pdf, otro-page-001-diff.png"

    Escenario: Borrar los diffs de todos deja el snapshot
      Dado que la raíz del proyecto está vacía
      Y que el directorio de salida tiene "index-page-005-diff.png, index.pdf"
      Cuando borro los diffs del snapshot "todos"
      Entonces en el directorio quedan "index.pdf"

  Regla de negocio: El informe dice qué se comparó, con qué y dónde está el diff

    Escenario: El informe trae los conteos, el umbral y las páginas cambiadas
      Dado que la raíz del proyecto está vacía
      Y que comparé 88 páginas con 85 sin cambios y 3 modificadas
      Cuando armo el informe visual
      Entonces el informe dice "dist/files/index.pdf vs visual/index.pdf · 300 dpi · umbral 0.005 % · fuzz 15 %"
      Y el informe dice "páginas 88 · sin cambios 85 · modificadas 3"
      Y el informe dice "0.4213 %"
      Y el informe dice "page-003-diff.png"
      Y el informe dice "page-017-diff.png"

    Escenario: El informe avisa cuando las páginas no coinciden
      Dado que la raíz del proyecto está vacía
      Y que comparé contra una referencia con 2 páginas y generé 1
      Cuando armo el informe visual
      Entonces el informe dice "páginas distintas: referencia 2 · generado 1"

    Escenario: El resumen acorta las rutas de los diffs
      Dado que la raíz del proyecto está vacía
      Y que comparé 12 páginas con 11 sin cambios y 1 modificadas
      Cuando armo el resumen visual
      Entonces el resumen dice "páginas 12 · sin cambios 11 · modificadas 1"
      Y el resumen dice "  pág 5  0.0486 %  visual/index-page-005-diff.png"

  Regla de negocio: El tamaño sale de la cabecera IHDR, y si no hay PNG no hay tamaño

    Escenario: El tamaño se lee del IHDR
      Dado que la raíz del proyecto está vacía
      Y que tengo un PNG de 2480 por 3508
      Entonces el PNG mide 2480 por 3508

    Esquema del escenario: Un buffer que no es un PNG no tiene tamaño
      Dado que la raíz del proyecto está vacía
      Y que tengo algo que no es un PNG de <bytes> bytes
      Entonces el PNG no tiene tamaño legible

      Ejemplos:
        | bytes |
        | 10 |
        | 64 |
