# language: es
Característica: El argv llega entero hasta el comando

  Como quien escribe el comando en la terminal
  Quiero que lo que escribo después del binario llegue al comando correcto
  Para no tener que saber qué función llama por dentro

  Regla de negocio: init deja un proyecto listo para compilar

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
      Entonces el archivo ".gitignore" contiene "dist/"
      Y el archivo ".gitignore" contiene ".iteraciones/"
      Y el archivo ".gitignore" contiene "build.sh"
      Y el archivo ".gitignore" contiene "visual/**/*-page-*-diff.png"

    Escenario: El config que genera init es mínimo y válido
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Entonces el archivo "iteraciones.config.yaml" contiene "language: es-MX"
      Y el archivo "iteraciones.config.yaml" contiene "theme: dark"
      Y el archivo "iteraciones.config.yaml" tiene como máximo 25 líneas
      Y el proyecto recién creado pasa validate
      Y la salida de error no lleva ningún error

    Escenario: El config de init deja los defaults en el código
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init" sobre la raíz del proyecto
      Entonces el config del proyecto no declara "blocks"

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

    Escenario: clean por argv con --json
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "clean --json" sobre la raíz del proyecto
      Entonces el JSON declara la clave "ok" con el valor verdadero

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