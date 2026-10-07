# language: es
Característica: la validación PDF/X de la salida

  Como quien manda a imprimir
  Quiero que la salida se certifique antes de darla por buena
  Para que un PDF sin incrustar las fuentes no llegue a la imprenta

  Regla de negocio: Sin PDFs que validar no hay fase

    Escenario: Sin binario compilado se advierte y no se rompe
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "doc.pdf"
      Y no hay binario de validación compilado
      Cuando valido los PDF de la salida
      Entonces la validación se omite en silencio
      Y stderr anuncia "no se validaron"

    Escenario: No hay PDFs en la salida
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Cuando valido los PDF de la salida
      Entonces la validación se omite en silencio
      Y stderr está vacío

  Regla de negocio: 99-pdfx desactivado apaga la fase entera

    Escenario: El filtro 99-pdfx desactivado omite la validación
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX desactivada
      Y la salida tiene un PDF llamado "doc.pdf"
      Cuando valido los PDF de la salida
      Entonces la validación se omite en silencio
      Y stderr está vacío

  Regla de negocio: El aviso de compilación va antes del aviso de omisión

    Escenario: Anuncia la compilación antes de intentar construirla (#2163)
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "doc.pdf"
      Y compilar el binario va a fallar
      Cuando valido los PDF de la salida permitiendo compilar el binario
      Entonces la validación se omite en silencio
      Y stderr anuncia "compilando iteraciones-pdfcheck" antes de "no se validaron"

  Regla de negocio: Un PDF que no certifica detiene el build

    Escenario: Un PDF que no certifica muestra archivo, página y código (D2)
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "doc.pdf"
      Y el binario de validación declara:
      """
      {"valid": false, "level": "PDF/X-1a:2001", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"},{"code":"FontNotEmbedded","message":"fuente no incrustada","page":2,"object_id":null,"clause":"6.2"}], "warnings": [{"code":"ProducerNotSet","message":"sin Producer","page":null,"object_id":null,"clause":null}]}
      """
      Cuando valido los PDF de la salida
      Entonces la validación falla diciendo "1 de 1 PDFs no certifican PDF/X-1a. ;; doc.pdf ;; MissingTrimBox ;; FontNotEmbedded ;; (2 fallos) ;; página 1 ;; página 3 ;; ProducerNotSet ;; advertencia —"

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
      Entonces la validación falla diciendo "capitulos/doc.pdf ;; MissingTrimBox"

  Regla de negocio: Un PDF que sí certifica no dice nada

    Escenario: Sin fallos, la línea de resumen confirma y stderr calla (#1960)
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la certificación PDFX activada
      Y la salida tiene un PDF llamado "doc.pdf"
      Y el binario de validación declara:
      """
      {"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}
      """
      Cuando valido los PDF de la salida
      Entonces se validan 1 PDF y fallan 0
      Y la línea de resumen dice "Validación PDF/X-1a: 1 PDF certifica PDF/X-1a"
      Y stderr está vacío