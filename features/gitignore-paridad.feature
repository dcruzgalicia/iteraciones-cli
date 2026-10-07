# language: es
@requires-git
Característica: las reglas del proyecto se comportan como las de git

  Como quien ya tiene un `.gitignore` en su repositorio
  Quiero que el build decida lo mismo que git decide
  Para que no compile un documento que git ya tenía excluido, ni al revés

  # `docs/architecture.md` llama a `isIgnoredByRules` «el único mecanismo de
  # exclusión de contenido» del proyecto. Si se aparta de git, un documento deja
  # de compilarse —o se compila— y ninguna otra suite lo nota: el resto comprueba
  # qué se compila *dado* un conjunto de reglas, no que las reglas sean las de git.
  #
  # Por eso la comparación es contra `git check-ignore` de verdad, no contra una
  # lista de expectativas escrita a mano: escribirla sería reescribir git. Lo
  # único escrito a mano es `DIVERGENCIAS_CONOCIDAS`, que son los límites que el
  # propio `architecture.md` declara como aceptados. Una divergencia **nueva**
  # falla; una conocida pasa.

  Regla de negocio: Los patrones que git resuelve, iteraciones también

    # Una fila por comportamiento, no un caso por ruta: la tabla es el catálogo
    # de lo que git distingue y esta suite compara los dos motores sobre ella.

    Esquema del escenario: Una regla se comporta como en git
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el .gitignore dice:
        """
        <reglas>
        """
      Y que los archivos a consultar son:
        """
        <rutas>
        """
      Cuando comparo las reglas de iteraciones con git check-ignore
      Entonces las únicas diferencias son las documentadas

      Ejemplos:
        | reglas                    | rutas                              |
        | *.md                      | nota.md, notas/nota.md             |
        | /raiz.md                  | raiz.md, sub/raiz.md               |
        |build/<br>!build/keeps.md   | build/x.tex, build/keeps.md        |
        |*.log<br>!importante.log    | app.log, importante.log, sub/app.log |
        | doc?.md                   | doc1.md, doc12.md, doc.md          |
        |**/cache/**                | cache/a.txt, x/cache/b.txt         |

  Regla de negocio: Un directorio ignorado se propaga

    Esquema del escenario: Lo que cuelga de un directorio ignorado
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el .gitignore dice:
        """
        notas/
        """
      Y que los archivos a consultar son:
        """
        notas/a.md, notas/sub/b.md, otras/notes/c.md, notas.md
        """
      Cuando comparo las reglas de iteraciones con git check-ignore
      Entonces las únicas diferencias son las documentadas

  Regla de negocio: Sin reglas no hay exclusión

    # Un proyecto sin `.gitignore` no debe inventarse reglas: esto es lo que
    # hace el `default` de `loadGitignoreRules`.

    Escenario: Un proyecto sin .gitignore no ignora nada
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el .gitignore dice:
        """
        """
      Y que los archivos a consultar son:
        """
        a.md, notas/b.md, dist/files/c.md
        """
      Cuando comparo las reglas de iteraciones con git check-ignore
      Entonces las únicas diferencias son las documentadas
