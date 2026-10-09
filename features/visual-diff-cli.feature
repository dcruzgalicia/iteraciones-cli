# language: es
Característica: la regresión visual de los PDF

  Como quien revisa un PDF antes de mandarlo a imprenta
  Quiero guardar una referencia y que cada build me diga si cambió
  Para ver la diferencia, no un "algo no cuadra"

  Regla de negocio: El snapshot va donde el PDF

    Escenario: Guardar la referencia la deja junto a su diff
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz
      Cuando creo el snapshot de "mi-doc.pdf" con "update=true"
      Entonces el visual termina con código 0
      Y el visual dice por stdout "mi-doc.pdf → visual/mi-doc.pdf"
      Y el archivo "visual/mi-doc.pdf" existe en el proyecto

  Regla de negocio: Lo que no encaja se avisa, no se corta

    Escenario: Una sola ruta es error: no dice contra qué comparar
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz
      Cuando comparo "mi-doc.pdf" con ""
      Entonces el visual termina con código 1
      Y el visual dice por stderr "check necesita dos rutas"
      Y el visual dice por stderr "iteraciones visual check"
      Y el visual dice por stderr "iteraciones visual check <pdf> <referencia>"

  Regla de negocio: Las rutas se validan antes de hacer nada

    Escenario: Snapshot admite como mucho un PDF
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz
      Y un PDF llamado "otro.pdf" en la raíz
      Cuando creo el snapshot de "mi-doc.pdf,otro.pdf" con "update=true"
      Entonces el visual termina con código 1
      Y el visual dice por stderr "snapshot admite como mucho una ruta"
      Y el archivo "visual/mi-doc.pdf" NO existe en el proyecto

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

    Escenario: Sin ningún snapshot todo es agregado y recomienda la línea base
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Cuando comparo "" con ""
      Entonces el visual termina con código 0
      Y el visual dice por stdout "1 PDF agregado sin snapshot"
      Y el visual dice por stdout "iteraciones visual snapshot"

    Escenario: Un PDF sin snapshot no detiene el lote
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      libro.pdf
      """
      Y el directorio de snapshots tiene "index.pdf"
      Cuando comparo "" con ""
      Entonces el visual termina con código 0
      Y el visual dice por stdout "1 PDF agregado sin snapshot"
      Y el visual dice por stdout "dist/files/libro.pdf"
      Y el visual no dice por stdout "sin diferencias visuales"

    Escenario: Un snapshot sin PDF avisa que se eliminó del build
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y el directorio de snapshots tiene "index.pdf ;; borrado.pdf"
      Cuando comparo "" con ""
      Entonces el visual termina con código 0
      Y el visual dice por stderr "1 snapshot eliminado del build"
      Y el visual dice por stderr "visual/borrado.pdf"

    Escenario: Agregados y borrados juntos en el mismo lote
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      nuevo.pdf
      """
      Y el directorio de snapshots tiene "index.pdf ;; viejo.pdf"
      Cuando comparo "" con ""
      Entonces el visual termina con código 0
      Y el visual dice por stdout "1 PDF agregado sin snapshot"
      Y el visual dice por stdout "dist/files/nuevo.pdf"
      Y el visual dice por stderr "1 snapshot eliminado del build"
      Y el visual dice por stderr "visual/viejo.pdf"

  Regla de negocio: El diff vive en `diff/`, con el camino aplanado

    Escenario: Una salida anidada produce un diff aplanado en diff/
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      anexos/index.pdf
      """
      Y que el proyecto tiene el PDF "viejo.pdf" con el texto "distinto"
      Cuando comparo "dist/files/anexos/index.pdf,viejo.pdf" con ""
      Entonces el visual termina con código 1
      Y el archivo "diff/anexos--index--page-001--diff.png" existe en el proyecto
      Y el archivo "visual/anexos--index--page-001--diff.png" NO existe en el proyecto

    Escenario: El snapshot retira los diffs de diff/ y no toca visual/
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y el directorio de diffs tiene "index--page-001--diff.png ;; viejo--page-001--diff.png"
      Cuando creo el snapshot de "" con "update=true"
      Entonces el visual termina con código 0
      Y el archivo "diff/index--page-001--diff.png" NO existe en el proyecto
      Y el archivo "diff/viejo--page-001--diff.png" NO existe en el proyecto
      Y el archivo "visual/index.pdf" existe en el proyecto

  Regla de negocio: El par explícito compara y no toca los snapshots

    Escenario: Dos rutas iguales no dejan diff
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y que el proyecto tiene el PDF "viejo.pdf" con el texto "index.pdf"
      Cuando comparo "dist/files/index.pdf,viejo.pdf" con ""
      Entonces el visual termina con código 0
      Y el visual dice por stdout "dist/files/index.pdf vs viejo.pdf"
      Y el archivo "diff/index--page-001--diff.png" NO existe en el proyecto

    Escenario: Dos rutas distintas dejan el diff y salen con código 1
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y que el proyecto tiene el PDF "otro.pdf" con el texto "distinto"
      Cuando comparo "dist/files/index.pdf,otro.pdf" con ""
      Entonces el visual termina con código 1
      Y el visual dice por stdout "páginas 1 · sin cambios 0 · modificadas 1"
      Y el archivo "diff/index--page-001--diff.png" existe en el proyecto

  Regla de negocio: El snapshot retira lo que ya no existe

    Escenario: Se van las referencias de PDF que ya no está
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y el directorio de snapshots tiene "borrado.pdf ;; borrado--page-003--diff.png"
      Y el directorio de diffs tiene "index--page-001--diff.png"
      Cuando creo el snapshot de "" con "update=true"
      Entonces el visual termina con código 0
      Y el visual dice por stdout "snapshots sin PDF en dist/files: visual/borrado.pdf"
      Y el archivo "visual/borrado.pdf" NO existe en el proyecto
      Y el archivo "diff/borrado--page-003--diff.png" NO existe en el proyecto
      Y el archivo "diff/index--page-001--diff.png" NO existe en el proyecto
      Y el archivo "visual/index.pdf" existe en el proyecto

    Escenario: Sin PDF en la salida el lote lo dice
      Dado que la raíz del proyecto está vacía
      Cuando comparo "" con ""
      Entonces el visual termina con código 1
      Y el visual dice por stderr "no hay PDFs en dist/files"