# language: es
Característica: El build dice qué hizo y por qué

  Como quien corre build un millón de veces por día
  Quiero saber si reprocesó o reutilizó, y por qué
  Para no pagar un build completo sin enterarme de que no hacía falta

  # 10 de los 72 casos que quedan de `cli-layer`. El bloque `runBuild` son 1.643
  # líneas y 72 casos heterogéneos: cada uno monta un estado distinto del
  # proyecto y comprueba algo distinto. Va por partes.

  Regla de negocio: Un build sin cambios reutiliza la salida

    Escenario: El segundo build marca el documento como reutilizado
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "(reutilizado)"

    # #2240: el documento queda cacheado pero su archivo disappears. Un build
    # incremental que confíe en la caché deja la salida incompleta y el usuario
    # descubre que le falta un HTML justo cuando va a publicar.

    @requires-pandoc
    Escenario: Si borro un output cacheado el build lo regenera sin --full
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Y el archivo "dist/files/test-document.html" existe
      Dado que borro el archivo "dist/files/test-document.html"
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" existe

  Regla de negocio: El resumen dice POR QUÉ reprocesa

    # Sin esto, un build que reprocesa por un cambio de configuración es
    # indistinguible de uno que reprocesa porque el documento cambió. Y el modo
    # default tiene que decirlo cuando NO reprocesó: "sin invalidaciones" en vez
    # de una línea vacía, porque la línea vacía parece un bug de formato.

    Escenario: Con la caché completa el resumen lo dice
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Entonces hago un build del proyecto
      Y la salida dice "(todos reutilizados)"

    Escenario: Un cambio de configuración aparece como razón
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Dado que el título del sitio es "Otro"
      Y hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice que se reprocesó por "configuración HTML"
      Y la salida no dice "(todos reutilizados)"
      Y la salida no dice "reprocesados"

  Regla de negocio: --json reemplaza toda la salida humana

    # Un watcher parsea `stdout`. Si el build --json dejara una fila de progreso
    # o el resumen humano antes del objeto, el `JSON.parse` revienta en el
    # consumidor y no en el build.

    Escenario: El JSON de un build nuevo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 0
      Y la salida es una sola línea
      Y el JSON declara la clave "processed" con el número 1
      Y el JSON declara la clave "cached" con el número 0
      Y el JSON declara la lista "formats" con el valor "html"
      Y el JSON declara "outputDir" como la ruta real de la salida
      Y el JSON declara "durationMs" como número
      Y el JSON declara la lista "invalidations" con el valor "sin caché previa"

      # `outputDir` es la ruta canónica: la misma que ve `process.cwd()` después
      # de resolver symlinks. Sin eso, comparar rutas en el consumidor falla en
      # macOS, donde `/tmp` es un symlink a `/private/tmp`.

    Escenario: Un build roto en --json declara el error y sale con 1
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que el archivo "roto.md" tiene este contenido
      """
      ---
      title: "sin cerrar
      ---

      Contenido.
      """
      Cuando hago un build del proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 1
      Y el JSON declara "error" diciendo "frontmatter YAML inválido"

    # #2239: cuando el build falla, los avisos que ya había emitido se pierden.
    # El consumidor recibe `error` y cree que no hubo nada antes.

    Escenario: Un build roto en --json conserva los avisos previos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la configuración desactiva un filtro global "filtro-inexistente"
      Dado que el archivo "roto.md" tiene este contenido
      """
      ---
      title: "sin cerrar
      ---

      Contenido.
      """
      Cuando hago un build del proyecto pidiendo JSON
      Entonces el comando termina con el código de salida 1
      Y el JSON declara "error" diciendo "frontmatter YAML inválido"
      Y el JSON declara al menos 1 aviso que menciona "filtro-inexistente"

    # `--json` y `--verbose` piden formatos incompatibles de la misma corrida:
    # o un objeto para máquinas o filas para una persona.

    Escenario: --json y --verbose no se pueden pedir juntos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando pido el build en JSON y con detalle
      Entonces el comando termina con el código de salida 1
      Y el error dice "--json y --verbose son mutuamente excluyentes"

  Regla de negocio: --output apunta dentro del proyecto

    Escenario: Un --output fuera del proyecto sale con contexto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build con la salida "../fuera"
      Entonces el comando termina con el código de salida 1
      Y el error dice "✖ [build] --output"

    # Un `--output` relativo se resuelve contra la raíz del PROYECTO, no contra
    # el directorio desde el que se invocó el binario. Un build que escribe
    # `salida/` en el cwd del proceso deja archivos donde el usuario no los
    # busca y donde el siguiente build no los encuentra.

    Escenario: Un --output relativo se resuelve contra la raíz del proyecto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build con la salida "salida"
      Entonces el comando termina con el código de salida 0
      Y el archivo "salida/test-document.html" existe
      Y el directorio temporal no tiene una carpeta "salida"

    # Regresión de la caché con `--output`: mismo contenido, otro directorio. Si
    # la caché no mirara el directorio de salida, el segundo build "reutilizaría"
    # documentos que nunca se escribieron ahí y dejaría el directorio vacío.

    Escenario: Cambiar el directorio de salida entre builds regenera los documentos
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Y el archivo "dist/files/test-document.html" existe
      Cuando hago un build con la salida "salida2"
      Y el archivo "salida2/test-document.html" existe
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/test-document.html" existe