# language: es
@requires-latex
Característica: la fase PDF compila el LaTeX con latexmk

  Como quien quiere un PDF y no un proceso de compilación
  Quiero que el build invoque latexmk con las banderas correctas
  Para no tener que aprender las de latexmk ni a corregir a mano el `.tex`

  Regla de negocio: latexmk recibe las banderas con las que el paso se repite a mano

    Escenario: El compilador se invoca en modo no interactivo sobre el trabajo
      Dado un proyecto con un documento y la fase PDF activa
      Cuando compilo el proyecto entero
      Entonces latexmk recibe la bandera "-pdf"
      Y latexmk recibe la bandera "-interaction=nonstopmode"
      Y latexmk compila el trabajo con nombre de job

  Regla de negocio: Sin bibliografía el compilador no pierde una corrida

    Esquema del escenario: La bibliografía decide la corrida de biber
      Dado un proyecto con un documento y <estado> bibliografía
      Cuando compilo el proyecto entero
      Entonces latexmk <flag> la bandera "-nobibtex"

      Ejemplos:
        | estado | flag      |
        | con    | no recibe |
        | sin    | recibe    |

  Regla de negocio: La ubicación del número de página decide la macro del .tex

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

    Esquema del escenario: courtesyPage enciende la página de cortesía
      Dado un proyecto con un documento y courtesyPage: <valor>
      Cuando compilo el proyecto entero
      Entonces el .tex de dist <estado> el fragmento "\courtepagetrue"

      Ejemplos:
        | valor | estado    |
        | true  | lleva     |
        | false | no lleva  |

    Esquema del escenario: showDate decide el \date de la portada
      Dado un proyecto con un documento y showDate: <valor>
      Cuando compilo el proyecto entero
      Entonces el .tex de dist <estado> el fragmento "\date{<fecha>}"

      Ejemplos:
        | valor | estado | fecha                  |
        | true  | lleva  | 8 de agosto de 2026    |
        | false | lleva  |                        |
