# language: es
Característica: preview construye el proyecto y lo vuelve a construir con cada cambio

  Como quien escribe un PDF largo y lo relee mientras lo corrige
  Quiero que el build se repita solo cuando toco un archivo
  Para no tener que acordarme de correr iteraciones build y recargar el visor a mano

  Regla de negocio: La lista de entradas es explícita y no incluye la salida

    Escenario: Las entradas son los documentos, la config y la bibliografía
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el proyecto tiene el documento "otro.md"
      Y que el proyecto tiene una bibliografía
      Cuando tomo la lista de entradas de preview
      Entonces la lista de entradas de preview incluye "test.md"
      Y la lista de entradas de preview incluye "otro.md"
      Y la lista de entradas de preview incluye "iteraciones.config.yaml"
      Y la lista de entradas de preview incluye "bibliography.bib"

    Escenario: Los filtros del proyecto también son entradas
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el proyecto tiene un filtro "filters/mi-filtro.lua"
      Cuando tomo la lista de entradas de preview
      Entonces la lista de entradas de preview incluye "filters/mi-filtro.lua"

    Escenario: La salida nunca es una entrada, y por eso el loop no puede existir
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el proyecto tiene el documento "dist/files/arma.html"
      Cuando tomo la lista de entradas de preview
      Entonces la lista de entradas de preview excluye "dist/files/arma.html"

  Regla de negocio: Un cambio se detecta por mtime, y un archivo que desaparece también

    Escenario: Un archivo modificado es un cambio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando tomo la lista de entradas de preview
      Y que tengo el snapshot de las entradas de preview
      Y cambio el contenido del archivo "test.md"
      Y tomo un snapshot nuevo de las entradas de preview
      Entonces los cambios detectados son "test.md"

    Escenario: Un archivo nuevo es un cambio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando tomo la lista de entradas de preview
      Y que tengo el snapshot de las entradas de preview
      Y que el proyecto tiene el documento "nuevo.md"
      Y tomo un snapshot nuevo de las entradas de preview
      Entonces los cambios detectados son "nuevo.md"

    Escenario: Un archivo que desaparece es un cambio
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el proyecto tiene el documento "se-va.md"
      Cuando tomo la lista de entradas de preview
      Y que tengo el snapshot de las entradas de preview
      Y borro el archivo "se-va.md"
      Y tomo un snapshot nuevo de las entradas de preview
      Entonces los cambios detectados son "se-va.md"

    Escenario: Sin tocar nada no hay cambios
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando tomo la lista de entradas de preview
      Y que tengo el snapshot de las entradas de preview
      Y tomo un snapshot nuevo de las entradas de preview
      Entonces los cambios detectados son ""

  Regla de negocio: preview construye una vez y nombra lo que cambió

    Escenario: El arranque construye y avisa que vigila
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando arranco preview
      Entonces preview construyó el proyecto una vez y quedó esperando

    Escenario: Un cambio dispara exactamente un build más
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando arranco preview
      Y cambio un documento mientras preview vigila
      Entonces preview nombra el archivo que cambió
      Y preview reconstruyó exactamente una vez más

    Escenario: Dos cambios antes del poll se colapsan en un solo build
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando arranco preview
      Y hago dos cambios seguidos antes de que corra el poll
      Entonces los builds se estabilizan en 2

    Escenario: Un cambio en vuelo no se pierde
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando arranco preview
      Y cambio algo mientras el build corre
      Entonces los builds se estabilizan en 3

  Regla de negocio: Un build roto no tumba el preview

    Escenario: Con la config inválida vuelve a construir cuando la arreglo
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando arranco preview
      Y rompo la configuración mientras preview vigila
      Entonces preview se recupera del error y sigue vigilando

  Regla de negocio: Un preview por proyecto

    Escenario: El lockfile lleva el pid del proceso
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando arranco preview
      Entonces preview construyó el proyecto una vez y quedó esperando
      Y el lockfile de preview lleva el pid del proceso

    Escenario: Al salir el lockfile no queda
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando arranco preview
      Y paro preview
      Entonces el lockfile de preview no queda en disco

    Escenario: Un lockfile con un pid muerto no bloquea el arranque
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el proyecto tiene el lockfile con el pid 999999
      Cuando arranco preview
      Entonces preview construyó el proyecto una vez y quedó esperando

  Regla de negocio: El comando está cableado y documentado

    Escenario: El comando aparece en la ayuda
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando parseo el comando "--help" sobre la raíz del proyecto
      Entonces la salida dice "preview"
