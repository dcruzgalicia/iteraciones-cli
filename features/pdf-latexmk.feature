# language: es
@requires-latex
Característica: la fase PDF compila el LaTeX con latexmk

  Como quien quiere un PDF y no un proceso de compilación
  Quiero que el build invoque latexmk con las banderas correctas
  Para no tener que aprender las de latexmk ni a corregir a mano el `.tex`

  # Este feature antes probaba la clase del pool: `creo el pool de PDF`,
  # `encolo 6 documentos`, `cancelo el pool`, con un compilador falso de 15 ms.
  # Eso comprobaba la estructura del pool —workers, slots, `drain`, `cancel`—
  # y no el paso. Lo que un lector del proyecto necesita es lo otro: dado un
  # `.tex` de trabajo, la fase lo compila con las banderas que hacen falta y el
  # resultado es el PDF que espera en `dist`.
  #
  # Que el PDF exista de verdad pesa en `build-completo.feature`. Aquí se
  # verifica la entrada de la fase —la invocación— y el `.tex` que la recibe.

  Regla de negocio: latexmk recibe las banderas con las que el paso se repite a mano

    Escenario: El compilador se invoca en modo no interactivo sobre el trabajo
      Dado un proyecto con un documento y la fase PDF activa
      Cuando compilo el proyecto entero
      Entonces latexmk recibe la bandera "-pdf"
      Y latexmk recibe la bandera "-interaction=nonstopmode"
      Y latexmk compila el trabajo con nombre de job

  Regla de negocio: Sin bibliografía el compilador no pierde una corrida

    # `-nobibtex` equivale a `$bibtex_use = 0`: «nunca correr bibtex ni biber»,
    # según el propio manual de latexmk. Sin él, un proyecto que no tiene nada
    # que citar paga una corrida de biber por cada PDF que produce.

    Esquema del escenario: La bibliografía decide la corrida de biber
      Dado un proyecto con un documento y <estado> bibliografía
      Cuando compilo el proyecto entero
      Entonces latexmk <flag> la bandera "-nobibtex"

      Ejemplos:
        | estado | flag      |
        | con    | no recibe |
        | sin    | recibe    |

  Regla de negocio: La ubicación del número de página decide la macro del .tex

    # Los seis valores del enum, cada uno con su comando de `fancyhdr`. El `.tex`
    # que sale de `dist` lleva el que el autor pidió, y sólo ese: por eso la
    # tabla trae el valor junto a su macro y no una aserción suelta por valor.

    Esquema del escenario: pageNumber compone su macro en el preámbulo
      Dado un proyecto con un documento y pageNumber: <lugar>
      Cuando compilo el proyecto entero
      Entonces el .tex de dist lleva la macro <macro>

      Ejemplos:
        | lugar         | macro                 |
        | header-left   | \ihead*{\pagemark}    |
        | header-center | \chead*{\pagemark}    |
        | header-right  | \ohead*{\pagemark}    |
        | footer-left   | \ifoot*{\pagemark}    |
        | footer-center | \cfoot*{\pagemark}    |
        | footer-right  | \ofoot*{\pagemark}    |

  Regla de negocio: La portada depende de sus dos palancas

    # `\ifcourtepage` está siempre —es el primitivo de LaTeX—, lo que se enciende
    # o se apaga es `\courtepagetrue`, que es lo que mete `latex-composer.ts`
    # cuando `courtesyPage` vale true.

    Esquema del escenario: courtesyPage enciende la página de cortesía
      Dado un proyecto con un documento y courtesyPage: <valor>
      Cuando compilo el proyecto entero
      Entonces el .tex de dist <estado> el fragmento "\courtepagetrue"

      Ejemplos:
        | valor | estado    |
        | true  | lleva     |
        | false | no lleva  |

    # Con `showDate` la fecha del maketitle es la fecha legible; sin ella, un
    # `\date{}` vacío —no la fecha de creación del archivo, que es lo que saldría
    # si el campo no se mandara.

    Esquema del escenario: showDate decide el \date de la portada
      Dado un proyecto con un documento y showDate: <valor>
      Cuando compilo el proyecto entero
      Entonces el .tex de dist <estado> el fragmento "\date{<fecha>}"

      Ejemplos:
        | valor | estado | fecha                  |
        | true  | lleva  | 8 de agosto de 2026    |
        | false | lleva  |                        |
