# language: es
Característica: El argv llega entero hasta el comando

  Como quien escribe el comando en la terminal
  Quiero que lo que escribo después del binario llegue al comando correcto
  Para no tener que saber qué función llama por dentro

  # 22 de los 172 casos de `cli-layer`: los 11 del wiring por `parseAsync`, los
  # 5 de `runClean` y los 6 de `runInit`.
  #
  # El riesgo de este bloque es otro: los tests del dispatcher llaman
  # `runBuild(dir, { full: true })` directo. Nadie prueba que `iteraciones build
  # --full` llegue a `runBuild` con `{ full: true }`. Acá va por argv de verdad.

  Regla de negocio: init deja un proyecto listo para compilar

    # Los tres archivos son el mínimo para que `build` ande. El `.gitignore` es
    # la cuarta cosa que importa: sin él, cada build deja `dist/` y
    # `.iteraciones/` sin trackear y el primer `git status` del usuario es un
    # muro de archivos.

    Escenario: init crea los archivos de un proyecto
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" existe
      Y el archivo "index.md" existe
      Y el archivo "bibliography.bib" existe
      Y el archivo ".gitignore" existe

    Escenario: El .gitignore de init cubre lo que el build genera
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Y el archivo ".gitignore" contiene "dist/"
      Y el archivo ".gitignore" contiene ".iteraciones/"
      Y el archivo ".gitignore" contiene "build.sh"
      Y el archivo ".gitignore" contiene "visual/**/*-page-*-diff.png"

      # `build.sh` se reescribe en cada build (#2481), así que ignorarlo tiene
      # que ser decisión del usuario y no del repo. Los snapshots de `visual
      # check` sí se versionan; los diffs no: son imágenes del fallo.

    Escenario: El config que genera init es mínimo y remite a la documentación
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Y el archivo "iteraciones.config.yaml" contiene "# Configuración del proyecto. Consulta docs/configuration.md"
      Y el archivo "iteraciones.config.yaml" contiene "theme: dark"
      Y el archivo "iteraciones.config.yaml" tiene como máximo 25 líneas
      Y el proyecto recién creado pasa validate
      Y la salida de error no lleva ningún error

      # Un config generado que no pasa `validate` es un config que el propio CLI
      # no acepta: el usuario lo copia tal cual y falla en el primer build.

    # Los defaults viven en el código, no en el archivo. Un `blocks` escrito acá
    # se volvería la configuración del proyecto para siempre y dejaría de
    # actualizarse con el CLI.

    Escenario: El config de init deja los defaults en el código
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Y el config del proyecto no declara "blocks"

  Regla de negocio: init no pisa lo que ya está

    Escenario: init no sobreescribe un .gitignore preexistente
      Dado que la raíz del proyecto está vacía
      Dado que el archivo ".gitignore" tiene este contenido
      """
      node_modules/
      """
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo ".gitignore" quedó con este contenido
      """
      node_modules/
      """

    Escenario: init no sobreescribe un proyecto que ya existe
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "iteraciones.config.yaml" contiene "Test"

  Regla de negocio: init crea la raíz que no existe

    # #2180: `init` sobre una ruta que no existe es exactamente su caso de uso,
    # así que es el único comando que no puede fallar por eso. Y el proyecto
    # creado tiene que compilar, no sólo existir.

    Escenario: init crea el directorio y el proyecto compila
      Dado que la raíz del proyecto no existe todavía
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "creado el directorio"
      Y el archivo "iteraciones.config.yaml" existe
      Y el archivo "index.md" existe
      Y compilo el proyecto recién creado
      Y el directorio "dist/files" tiene al menos 1 archivo .html

  Regla de negocio: new con --title por argv

    # El título no viaja en el path sino en una flag. Si el wiring no la pasa,
    # `new` lo infiere del nombre del archivo y el documento sale con otro
    # título — sin ningún error.

    Escenario: El título explícito por argv gana sobre el nombre del archivo
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando 'new --title "Título CLI" posts/articulo' sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el frontmatter de "posts/articulo.md" declara el título "Título CLI"

  Regla de negocio: clean borra lo que el build dejó

    Esquema del escenario: clean elimina <carpeta>
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que hay un build previo en la raíz del proyecto
      Cuando parseo el comando "clean" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el directorio "<carpeta>" no existe

      Ejemplos:
        | carpeta        |
        | dist           |
        | .iteraciones   |

    # #2183: el build con `--output out` deja la salida en `out/`, no en
    # `dist/`. Si `clean` mirara sólo `dist/`, el directorio de siempre
    # sobreviviría al clean y el usuario lo encontraría intacto después.

    Escenario: clean borra la salida que declara el estado del build
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el estado del build declara la salida "out"
      Dado que el directorio "out" existe
      Cuando parseo el comando "clean" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el directorio "out" no existe
      Y el directorio ".iteraciones" no existe

  Regla de negocio: clean --json declara lo que eliminó

    Escenario: clean con --json declara lo que eliminó
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que hay un build previo en la raíz del proyecto
      Cuando corro "clean" pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y el JSON declara la clave "ok" con el valor verdadero
      Y el JSON declara al menos 2 rutas eliminadas
      Y el JSON no declara fallos

    Escenario: clean con --json sin nada que eliminar
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando corro "clean" pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y el JSON declara la clave "ok" con el valor verdadero
      Y el JSON declara la lista "removed" vacía

    # El `--json` del argv, no el de la función: el flag tiene que llegar.

    Escenario: clean por argv con --json
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "clean --json" sobre la raíz del proyecto
      Y el JSON declara la clave "ok" con el valor verdadero

    # Un directorio sin permisos no se puede borrar. El mensaje tiene que decir
    # *qué* no se pudo eliminar, o el usuario busca un problema de disco.

    Escenario: clean con un directorio sin permisos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el directorio "dist/bloqueado" no tiene permisos
      Cuando corro "clean"
      Entonces el comando termina con el código de salida 1
      Y el error dice "no se pudo eliminar"
      Y devuelvo los permisos de "dist/bloqueado"

  Regla de negocio: list-filters y --version no necesitan proyecto

    Escenario: list-filters lista los filtros
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "list-filters" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "latex/02-dictum"

    Escenario: --version sale con el código de salida 0
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "--version"
      Entonces el comando termina con el código de salida 0

  Regla de negocio: build usa el root explícito y limpia la salida

    Escenario: build con --project-root explícito genera la salida
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando parseo el comando "build" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" existe

    Escenario: --output con la raíz del proyecto se rechaza
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando parseo el comando "build --output ." sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "--output"

    Escenario: --full dice qué limpió
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando construyo el proyecto en limpio y con detalle
      Entonces el comando termina con el código de salida 0
      Y la salida dice "--full: se eliminaron la caché y la salida anterior"

    # Sin `--full`, un build que falla después de escribir parte de la salida
    # deja `dist/` con archivos viejos mezclados con los nuevos. Peor: deja
    # archivos viejos y el usuario cree que son el resultado de este build.

    Escenario: Un build fallido en limpio no deja salida parcial
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que hay un build previo en la raíz del proyecto
      Dado que el archivo "dist/files/parcial.html" tiene este contenido
      """
      basura
      """
      Dado que el archivo "test.md" tiene este contenido
      """
      ---
      title: [roto
      ---

      Cuerpo.
      """
      Cuando construyo el proyecto en limpio
      Entonces el comando termina con el código de salida 1
      Y el directorio "dist/files" no existe