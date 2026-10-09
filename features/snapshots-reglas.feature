# language: es
Característica: las reglas de los snapshots

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

  Regla de negocio: Los nombres llevan la página con su relleno

    Esquema del escenario: El nombre de un snapshot y el de su diff
      Dado que la raíz del proyecto está vacía
      Entonces el nombre de la página <pagina> de <clase> es "<esperado>"

      Ejemplos:
        | pagina | clase | esperado |
        | 5      | snap  | index--page-005.png |
        | 128    | snap  | index--page-128.png |
        | 5      | diff  | index--page-005--diff.png |
        | 1      | diff  | index--page-001--diff.png |

  Regla de negocio: El camino del snapshot se aplana con --

    Esquema del escenario: El prefijo que recibe cada PDF
      Dado que la raíz del proyecto está vacía
      Entonces el prefijo del snapshot de "<pdf>" es "<esperado>"

      Ejemplos:
        | pdf | esperado |
        | PROYECTO/dist/files/index.pdf | index |
        | PROYECTO/dist/files/anexos/index.pdf | anexos--index |
        | PROYECTO/dist/files/a/b/c/libro.pdf | a--b--c--libro |
        | PROYECTO/dist/files/libro/parte-2.pdf | libro--parte-2 |
        | PROYECTO/dist/files/a--b/libro.pdf | a-b--libro |
        | PROYECTO/suelto.pdf | suelto |

  Regla de negocio: El prefijo sale del slug del archivo suelto

    Esquema del escenario: El nombre del snapshot
      Dado que la raíz del proyecto está vacía
      Entonces el slug de "<pdf>" es "<slug>"

      Ejemplos:
        | pdf | slug |
        | PROYECTO/dist/files/99-intervention.pdf | 99-intervention |
        | PROYECTO/Mi Documento.PDF | mi-documento |

  Regla de negocio: La comparación es estricta y no se configura

    Escenario: dpi, umbral y fuzz son fijos
      Dado que la raíz del proyecto está vacía
      Entonces la comparación es dpi 300, umbral 0 y fuzz 0

  Regla de negocio: El directorio de trabajo vive dentro del proyecto cuando lo hay

    Escenario: Sin proyecto, el directorio de trabajo va al temporal
      Dado que la raíz del proyecto está vacía
      Y que el proyecto no tiene configuración
      Cuando resuelvo el directorio de trabajo del snapshot "doc"
      Entonces el directorio de trabajo queda bajo "<temporal>/iteraciones-snapshots" y termina en "doc"
      Y el directorio de trabajo no se comparte con otro proyecto

    Escenario: Con proyecto, el directorio de trabajo va dentro
      Dado que la raíz del proyecto está vacía
      Y que el proyecto tiene configuración
      Cuando resuelvo el directorio de trabajo del snapshot "doc"
      Entonces el directorio de trabajo está en "PROYECTO/.iteraciones/tmp/snapshots/doc"
      Y el caché de los snapshots está en "PROYECTO/.iteraciones/tmp/snapshots/cache.json"

  Regla de negocio: Sólo se comparan PDF, y sólo se borran lo de un prefijo

    Escenario: Al listar sólo se quedan los PDF
      Dado que la raíz del proyecto está vacía
      Y que el directorio de salida tiene "b.pdf, sub/a.pdf, nota.txt"
      Cuando listo los PDF de la salida
      Entonces los PDF son "b.pdf, sub/a.pdf"

    Escenario: Un directorio que no existe no da PDF
      Dado que la raíz del proyecto está vacía
      Cuando listo los PDF de la salida
      Entonces los PDF son ""

    Escenario: Borrar los diffs de un prefijo no toca los demás
      Dado que la raíz del proyecto está vacía
      Y que el directorio de salida tiene "index--page-005--diff.png, index--page-012--diff.png, otro--page-001--diff.png, index.pdf"
      Cuando borro los diffs del snapshot "index"
      Entonces en el directorio quedan "index.pdf, otro--page-001--diff.png"

    Escenario: Borrar los diffs de todos deja lo demás
      Dado que la raíz del proyecto está vacía
      Y que el directorio de salida tiene "index--page-005--diff.png, index.pdf"
      Cuando borro los diffs del snapshot "todos"
      Entonces en el directorio quedan "index.pdf"

    Escenario: Guardar de nuevo el mismo prefijo retira las páginas viejas
      Dado que la raíz del proyecto está vacía
      Y que el directorio de salida tiene "index--page-001.png, index--page-002.png, otro--page-001.png"
      Cuando borro los snapshots del prefijo "index"
      Entonces en el directorio quedan "index--page-001.png, index--page-002.png, otro--page-001.png"

  Regla de negocio: El informe dice qué se comparó, con qué y dónde está el diff

    Escenario: El informe trae los conteos, el umbral y las páginas cambiadas
      Dado que la raíz del proyecto está vacía
      Y que comparé 88 páginas con 85 sin cambios y 3 modificadas
      Cuando armo el informe visual
      Entonces el informe dice "dist/files/index.pdf vs snapshots/index · 300 dpi · umbral 0 % · fuzz 0 %"
      Y el informe dice "páginas 88 · sin cambios 85 · modificadas 3"
      Y el informe dice "0.4213 %"
      Y el informe dice "page-003--diff.png"
      Y el informe dice "page-017--diff.png"

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
      Y el resumen dice "  pág 5  0.0486 %  diff/index--page-005--diff.png"

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
