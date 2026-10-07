# language: es
Característica: la validación PDF/X de la salida

  Como quien manda a imprimir
  Quiero que la salida se certifique antes de darla por buena
  Para que un PDF sin incrustar las fuentes no llegue a la imprenta

  # Tramo 31 de la migración. 8 de los 17 casos de `pdfx-check.test.ts`.

  # El filtro 99-pdfx es la señal de imprenta. Esta fase se comporta al revés
  # que las demás: no es una advertencia, es una puerta. Un PDF que no
  # certifica detiene el build.
  #
  # Todo lo que el binario necesita se escribe de mentira: compilar el
  # validador real es Rust y cargo. Lo que se prueba es la lectura del informe.
  # `XDG_CACHE_HOME` se aísla en el temporal de cada escenario para no compilar
  # nada de verdad en la caché del usuario.

  Regla de negocio: Sin PDFs que validar no hay fase

    Escenario: Sin binario compilado se advierte y no se rompe
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "doc.pdf"
      Y no hay binario de validación compilado
      # Sin binario y sin permiso para compilarlo, la fase se salta avisando.
      # Romper el build por no poder validar sería peor que no validar.
      Cuando valido los PDF de la salida
      Entonces la validación se omite en silencio
      Y stderr anuncia "no se validaron"

    Escenario: No hay PDFs en la salida
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      # Una corrida sin PDF no abre la fase: el log diría "0 documentos" en una
      # fase que no hizo nada.
      Cuando valido los PDF de la salida
      Entonces la validación se omite en silencio
      Y stderr está vacío

  Regla de negocio: 99-pdfx desactivado apaga la fase entera

    # Desactivar el filtro es la forma de decir "esto no va a imprenta". Con la
    # fase apagada no se toca stderr: si no hay nada que decir, no se dice.

    Escenario: El filtro 99-pdfx desactivado omite la validación
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX desactivada
      Y la salida tiene un PDF llamado "doc.pdf"
      Cuando valido los PDF de la salida
      Entonces la validación se omite en silencio
      Y stderr está vacío

  Regla de negocio: El aviso de compilación va antes del aviso de omisión

    # Si el build va a compilar el binario, lo dice PRIMERO. Anunciar sólo el
    # fallo y no el intento deja al autor pensando que la máquina no puede.

    Escenario: Anuncia la compilación antes de intentar construirla (#2163)
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "doc.pdf"
      Y compilar el binario va a fallar
      Cuando valido los PDF de la salida permitiendo compilar el binario
      # Cargo ausente: el aviso de "compilando" tiene que aparecer antes del
      # "no se validaron".
      Entonces la validación se omite en silencio
      Y stderr anuncia "compilando iteraciones-pdfcheck" antes de "no se validaron"

  Regla de negocio: Un PDF que no certifica detiene el build

    # El mensaje muestra TODOS los fallos y warnings por PDF (issue #1971): la
    # ruta de fallo del build no imprime los warnings acumulados, así que si el
    # mensaje no los lleva, esa información se pierde para siempre.

    Escenario: Un PDF que no certifica muestra archivo, página y código (D2)
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "doc.pdf"
      Y el binario de validación declara:
      """
      {"valid": false, "level": "PDF/X-1a:2001", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"},{"code":"FontNotEmbedded","message":"fuente no incrustada","page":2,"object_id":null,"clause":"6.2"}], "warnings": [{"code":"ProducerNotSet","message":"sin Producer","page":null,"object_id":null,"clause":null}]}
      """
      # Las páginas del informe son 0-indexadas; el mensaje las muestra en 1.
      Cuando valido los PDF de la salida
      Entonces la validación falla diciendo "1 de 1 PDFs no certifican PDF/X-1a. ;; doc.pdf ;; MissingTrimBox ;; FontNotEmbedded ;; (2 fallos) ;; página 1 ;; página 3 ;; ProducerNotSet ;; advertencia —"

    # El pipeline escribe los PDFs según la ruta del documento, no sólo en la
    # raíz: si el barrido no baja a los subdirectorios, los PDFs de los
    # capítulos no se certificarían nunca.
    Escenario: Se validan los PDF anidados en subdirectorios de la salida
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "index.pdf"
      Y la salida tiene un PDF llamado "capitulos/doc.pdf"
      Y el binario de validación declara:
      """
      {"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}
      """
      Cuando valido los PDF de la salida
      # Los dos: uno en la raíz y otro anidado.
      Entonces se validan 2 PDF y fallan 0
      Y la línea de resumen dice "Validación PDF/X-1a: 2 PDFs certifican PDF/X-1a"

    Escenario: Un PDF anidado que no certifica se nombra con su ruta relativa
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "capitulos/doc.pdf"
      Y el binario de validación declara:
      """
      {"valid": false, "level": "PDF/X-1a:2001", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"}], "warnings": []}
      """
      Cuando valido los PDF de la salida
      # Con la ruta relativa: "doc.pdf" a secas no dice de qué capítulo es.
      Entonces la validación falla diciendo "capitulos/doc.pdf ;; MissingTrimBox"

  Regla de negocio: Un PDF que sí certifica no dice nada

    # El silencio es el contrato: si el build dice "1 PDF certifica" en stderr,
    # en un build de 200 documentos nadie lo lee y se pierde entre el ruido.

    Escenario: Sin fallos, la línea de resumen confirma y stderr calla (#1960)
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "doc.pdf"
      Y el binario de validación declara:
      """
      {"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}
      """
      Cuando valido los PDF de la salida
      # La línea de resumen lleva el recuento; stderr queda vacío.
      Entonces se validan 1 PDF y fallan 0
      Y la línea de resumen dice "Validación PDF/X-1a: 1 PDF certifica PDF/X-1a"
      Y stderr está vacío