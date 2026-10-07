# language: es
Característica: la regresión visual de los PDF

  Como quien revisa un PDF antes de mandarlo a imprenta
  Quiero guardar una referencia y que cada build me diga si cambió
  Para ver la diferencia, no un "algo no cuadra"

  # Tramo 40 de la migración. 9 de los 21 casos de `visual-diff.test.ts`.

  # La referencia vive en `visual/`, espejando la estructura de `dist/files`.
  # Todo sale por el exit code, no lanzando: es lo que ve el script que envuelve
  # al comando, y lo único que puede comprobar sin leer el mensaje.

  Regla de negocio: El snapshot va donde el PDF

    Escenario: Guardar la referencia la deja junto a su diff
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz
      Cuando creo el snapshot de "mi-doc.pdf" con "update=true"
      # El mensaje dice origen → destino: el autor sabe dónde mirar.
      Entonces el visual termina con código 0
      Y el visual dice por stdout "mi-doc.pdf → visual/mi-doc.pdf"
      Y el archivo "visual/mi-doc.pdf" existe en el proyecto

  Regla de negocio: Sin referencia no hay comparación, y se dice cómo crearla

    Escenario: Un PDF sin snapshot explica cómo hacerlo
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz
      Cuando comparo "mi-doc.pdf" con ""
      # El mensaje trae el comando, no sólo el problema.
      Entonces el visual termina con código 1
      Y el visual dice por stderr "no hay snapshot en visual/mi-doc.pdf"
      Y el visual dice por stderr "iteraciones visual snapshot"

  Regla de negocio: Las rutas se validan antes de hacer nada

    # Un error de entrada con el directorio ya a medias deja snapshots a medias y
    # el siguiente build los toma por buenos.

    Escenario: Snapshot admite como mucho un PDF
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz
      Y un PDF llamado "otro.pdf" en la raíz
      Cuando creo el snapshot de "mi-doc.pdf,otro.pdf" con "update=true"
      Entonces el visual termina con código 1
      Y el visual dice por stderr "snapshot admite como mucho una ruta"
      Y el archivo "visual/mi-doc.pdf" NO existe en el proyecto

    # `check <pdf> [referencia]`: tres rutas no tienen sentido.
    Escenario: Check admite como mucho dos rutas
      Dado que la raíz del proyecto está vacía
      Cuando comparo "a.pdf,b.pdf,c.pdf" con ""
      Entonces el visual termina con código 1
      Y el visual dice por stderr "check admite como mucho dos rutas"
      Y el visual dice por stderr "iteraciones visual check"

    Escenario: Un PDF inexistente se dice por su nombre
      Dado que la raíz del proyecto está vacía
      Cuando creo el snapshot de "nadie.pdf" con "update=true"
      Entonces el visual termina con código 1
      Y el visual dice por stderr "no existe el PDF"

    Escenario: Un flag inválido se dice antes de renderizar
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz
      Cuando creo el snapshot de "mi-doc.pdf" con "update=true ;; dpi=0"
      Entonces el visual termina con código 1
      Y el visual dice por stderr "--dpi inválido"

  Regla de negocio: El modo lote barre `dist/files` y espeja carpetas

    # El snapshot tiene la misma forma que la salida: así un PDF de un anexo
    # tiene su referencia al lado y no en una lista plana.

    Escenario: El lote guarda una referencia por PDF de la salida
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      anexos/index.pdf
      leeme.txt
      """
      Cuando creo el snapshot de "" con "update=true"
      Entonces el visual termina con código 0
      Y el visual dice por stdout "dist/files/index.pdf → visual/index.pdf"
      Y el visual dice por stdout "dist/files/anexos/index.pdf → visual/anexos/index.pdf"
      Y el archivo "visual/index.pdf" existe en el proyecto
      Y el archivo "visual/anexos/index.pdf" existe en el proyecto
      Y el archivo "visual/leeme.pdf" NO existe en el proyecto

    Escenario: El lote sin referencias pide crearlas
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Cuando comparo "" con ""
      Entonces el visual termina con código 1
      Y el visual dice por stderr "no hay snapshots en visual"
      Y el visual dice por stderr "iteraciones visual snapshot"

    # Comparar con referencias incompletas daría un informe que parece limpio
    # cuando en realidad faltan PDFs: mejor cortar y dizer cuáles.
    Escenario: Con referencias incompletas corta antes de comparar
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      libro.pdf
      """
      Y el directorio de snapshots tiene "index.pdf"
      Cuando comparo "" con ""
      Entonces el visual termina con código 1
      Y el visual dice por stderr "snapshots incompletas"
      Y el visual dice por stderr "visual/libro.pdf"
      Y en las referencias quedan "index.pdf"

  # --- Tramo 40: `visual snapshot` también limpia ---

  # Una referencia sin PDF es basura que ocupa sitio y confunde: el siguiente
  # "todo verde" es en realidad un "no miré nada".

  Regla de negocio: El snapshot retira lo que ya no existe

    Escenario: Se van las referencias de PDF que ya no está
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y el directorio de snapshots tiene "borrado.pdf ;; borrado-page-003-diff.png ;; index-page-001-diff.png"
      Cuando creo el snapshot de "" con "update=true"
      Entonces el visual termina con código 0
      Y el visual dice por stdout "snapshots sin PDF en dist/files: visual/borrado.pdf"
      Y el archivo "visual/borrado.pdf" NO existe en el proyecto
      Y el archivo "visual/index-page-001-diff.png" NO existe en el proyecto
      Y el archivo "visual/index.pdf" existe en el proyecto

    Escenario: Sin PDF en la salida el lote lo dice
      Dado que la raíz del proyecto está vacía
      Cuando comparo "" con ""
      Entonces el visual termina con código 1
      Y el visual dice por stderr "no hay PDFs en dist/files"