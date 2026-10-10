# language: es
Característica: los snapshots de la regresión visual

  Como quien revisa un PDF antes de mandarlo a imprenta
  Quiero guardar la línea base y que cada build me diga si cambió
  Para ver la diferencia, no un "algo no cuadra"

  Regla de negocio: Guardar renderiza las páginas del PDF

    Escenario: Guardar deja las páginas del PDF en snapshots/
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz con el texto "hola"
      Cuando guardo los snapshots de "mi-doc.pdf"
      Entonces el snapshots termina con código 0
      Y el snapshots dice por stdout "mi-doc.pdf → snapshots/mi-doc"
      Y el snapshots dice por stdout "1 página en la línea base"
      Y el archivo "snapshots/mi-doc--page-001.png" existe en el proyecto

    Escenario: El lote guarda un prefijo por PDF de la salida
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      anexos/index.pdf
      """
      Cuando guardo los snapshots de ""
      Entonces el snapshots termina con código 0
      Y el archivo "snapshots/index--page-001.png" existe en el proyecto
      Y el archivo "snapshots/anexos--index--page-001.png" existe en el proyecto
      Y el archivo "snapshots/index--page-002.png" NO existe en el proyecto

    Escenario: Guardar de nuevo cambia el número de páginas del prefijo
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y el directorio de snapshots tiene "index--page-001.png ;; index--page-002.png ;; index--page-003.png"
      Cuando guardo los snapshots de ""
      Entonces el snapshots termina con código 0
      Y el archivo "snapshots/index--page-001.png" existe en el proyecto
      Y el archivo "snapshots/index--page-002.png" NO existe en el proyecto
      Y el archivo "snapshots/index--page-003.png" NO existe en el proyecto

    Escenario: Guardar retira los prefijos sin PDF en la salida
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y el directorio de snapshots tiene "viejo--page-001.png ;; viejo--page-002.png"
      Cuando guardo los snapshots de ""
      Entonces el snapshots termina con código 0
      Y el snapshots dice por stdout "1 snapshot retirado sin PDF en dist/files: viejo"
      Y el archivo "snapshots/viejo--page-001.png" NO existe en el proyecto
      Y el archivo "snapshots/index--page-001.png" existe en el proyecto

    Escenario: Guardar un solo documento no retira el resto
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      libro.pdf
      """
      Cuando guardo los snapshots de ""
      Y un PDF llamado "dist/files/index.pdf" en la raíz con el texto "cambiado"
      Y guardo los snapshots de "dist/files/index.pdf"
      Entonces el snapshots termina con código 0
      Y el snapshots no dice por stdout "snapshot retirado"
      Y el archivo "snapshots/libro--page-001.png" existe en el proyecto
      Y el snapshots dice por stdout "1 página en la línea base"

    Escenario: Guardar limpia los diffs de la corrida anterior
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y el directorio de diffs tiene "index--page-001--diff.png ;; viejo--page-001--diff.png"
      Cuando guardo los snapshots de ""
      Entonces el snapshots termina con código 0
      Y el archivo "diff/index--page-001--diff.png" NO existe en el proyecto
      Y el archivo "diff/viejo--page-001--diff.png" NO existe en el proyecto

  Regla de negocio: Comparar no toca la línea base

    Escenario: Una línea base limpia da cero diferencias
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Cuando guardo los snapshots de ""
      Y comparo ""
      Entonces el snapshots termina con código 0
      Y el snapshots dice por stdout "sin diferencias visuales en 1 páginas"
      Y el archivo "snapshots/index--page-001.png" existe en el proyecto

    Escenario: Un cambio deja el diff en diff/ y sale con código 1
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Cuando guardo los snapshots de ""
      Y un PDF llamado "dist/files/index.pdf" en la raíz con el texto "cambiado"
      Y comparo ""
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stdout "páginas 1 · sin cambios 0 · modificadas 1"
      Y el archivo "diff/index--page-001--diff.png" existe en el proyecto
      Y el archivo "snapshots/index--page-001.png" existe en el proyecto

  Regla de negocio: Lo que no encaja se avisa, no se corta

    Escenario: Una sola ruta es error: no dice contra qué comparar
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz con el texto "hola"
      Cuando comparo "mi-doc.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "check necesita dos rutas"
      Y el snapshots dice por stderr "iteraciones snapshots check"
      Y el snapshots dice por stderr "iteraciones snapshots check <pdf> <referencia>"

    Escenario: Sin ninguna línea base todo es agregado y recomienda crearla
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Cuando comparo ""
      Entonces el snapshots termina con código 0
      Y el snapshots dice por stdout "1 PDF agregado sin snapshot"
      Y el snapshots dice por stdout "iteraciones snapshots save"

    Escenario: Un PDF sin línea base no detiene el lote
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Cuando guardo los snapshots de ""
      Y la salida tiene estos archivos:
      """
      libro.pdf
      """
      Y comparo ""
      Entonces el snapshots termina con código 0
      Y el snapshots dice por stdout "1 PDF agregado sin snapshot"
      Y el snapshots dice por stdout "dist/files/libro.pdf"
      Y el snapshots dice por stdout "sin diferencias visuales en 1 páginas"

    Escenario: Una línea base sin PDF avisa que se eliminó del build
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      borrado.pdf
      """
      Cuando guardo los snapshots de ""
      Y quito el PDF "borrado.pdf" de la salida
      Y comparo ""
      Entonces el snapshots termina con código 0
      Y el snapshots dice por stderr "1 snapshot eliminado del build"
      Y el snapshots dice por stderr "borrado"

    Escenario: Agregados y borrados juntos en el mismo lote
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      viejo.pdf
      """
      Cuando guardo los snapshots de ""
      Y quito el PDF "viejo.pdf" de la salida
      Y la salida tiene estos archivos:
      """
      nuevo.pdf
      """
      Y comparo ""
      Entonces el snapshots termina con código 0
      Y el snapshots dice por stdout "1 PDF agregado sin snapshot"
      Y el snapshots dice por stdout "dist/files/nuevo.pdf"
      Y el snapshots dice por stderr "1 snapshot eliminado del build"
      Y el snapshots dice por stderr "viejo"

    Escenario: Sin PDF en la salida el lote lo dice
      Dado que la raíz del proyecto está vacía
      Cuando comparo ""
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "no hay PDFs en dist/files"

  Regla de negocio: El diff dice qué se fue y qué llegó, sobre el fantasma gris

    Escenario: Lo que se borra va en verde y lo que llega en rosa pálido
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Cuando guardo los snapshots de ""
      Y un PDF llamado "dist/files/index.pdf" en la raíz con el texto "hola"
      Y comparo ""
      Entonces el snapshots termina con código 1
      Y el diff marca lo borrado en rojo y lo agregado en verde pálido
      Y el diff deja el resto en el fantasma gris

  Regla de negocio: Cada check arranca con diff/ limpio

    Escenario: Un diff de otra corrida no sobrevive al check
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y el directorio de diffs tiene "ajeno--page-001--diff.png ;; index--page-004--diff.png"
      Cuando comparo ""
      Entonces el snapshots termina con código 0
      Y el archivo "diff/ajeno--page-001--diff.png" NO existe en el proyecto
      Y el archivo "diff/index--page-004--diff.png" NO existe en el proyecto

    Escenario: El diff del par se llama como el archivo de a, no por su ruta
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "dir1/dir2/file1.pdf" en la raíz con el texto "nuevo"
      Y un PDF llamado "dir1/dir3/file2.pdf" en la raíz con el texto "viejo"
      Cuando comparo "dir1/dir2/file1.pdf,dir1/dir3/file2.pdf"
      Entonces el snapshots termina con código 1
      Y el archivo "diff/file1--page-001--diff.png" existe en el proyecto

  Regla de negocio: El par explícito compara y no toca los snapshots

    Escenario: Dos rutas iguales no dejan diff
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      index.pdf
      """
      Y un PDF llamado "viejo.pdf" en la raíz con el texto "index.pdf"
      Cuando comparo "dist/files/index.pdf,viejo.pdf"
      Entonces el snapshots termina con código 0
      Y el snapshots dice por stdout "dist/files/index.pdf vs viejo.pdf"
      Y el archivo "diff/index--page-001--diff.png" NO existe en el proyecto

    Escenario: Dos rutas distintas dejan el diff y salen con código 1
      Dado que la raíz del proyecto está vacía
      Y la salida tiene estos archivos:
      """
      anexos/index.pdf
      """
      Y un PDF llamado "otro.pdf" en la raíz con el texto "distinto"
      Cuando comparo "dist/files/anexos/index.pdf,otro.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stdout "páginas 1 · sin cambios 0 · modificadas 1"
      Y el archivo "diff/anexos--index--page-001--diff.png" existe en el proyecto
      Y el archivo "snapshots" NO existe en el proyecto

  Regla de negocio: Las rutas se validan antes de hacer nada

    Escenario: Save admite como mucho un PDF
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "mi-doc.pdf" en la raíz con el texto "hola"
      Y un PDF llamado "otro.pdf" en la raíz con el texto "hola"
      Cuando guardo los snapshots de "mi-doc.pdf,otro.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "save admite como mucho una ruta"
      Y el archivo "snapshots/mi-doc--page-001.png" NO existe en el proyecto

    Escenario: Check admite como mucho dos rutas
      Dado que la raíz del proyecto está vacía
      Cuando comparo "a.pdf,b.pdf,c.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "check admite como mucho dos rutas"
      Y el snapshots dice por stderr "iteraciones snapshots check"

    Escenario: Un PDF inexistente se dice por su nombre
      Dado que la raíz del proyecto está vacía
      Cuando guardo los snapshots de "nadie.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "no existe el PDF"

  Regla de negocio: Lo que no es PDF se dice, y se dice por qué

    Escenario: Un a que no es PDF se dice que no lo es
      Dado que la raíz del proyecto está vacía
      Y un archivo que no es PDF llamado "mi-doc.pdf"
      Y un PDF llamado "viejo.pdf" en la raíz con el texto "viejo"
      Cuando comparo "mi-doc.pdf,viejo.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "no es un PDF"
      Y el snapshots dice por stderr "mi-doc.pdf"
      Y el snapshots dice por stderr "%PDF-"
      Y el archivo "diff" NO existe en el proyecto

    Escenario: Un b que no es PDF se dice que no lo es
      Dado que la raíz del proyecto está vacía
      Y un PDF llamado "nuevo.pdf" en la raíz con el texto "nuevo"
      Y un archivo que no es PDF llamado "viejo.pdf"
      Cuando comparo "nuevo.pdf,viejo.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "no es un PDF"
      Y el snapshots dice por stderr "viejo.pdf"
      Y el archivo "diff" NO existe en el proyecto

    Escenario: Un PDF que parece PDF pero no se puede leer se dice de otra forma
      Dado que la raíz del proyecto está vacía
      Y un PDF que no se puede renderizar llamado "roto.pdf"
      Y un PDF llamado "viejo.pdf" en la raíz con el texto "viejo"
      Cuando comparo "roto.pdf,viejo.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "parece un PDF pero pdftoppm no pudo renderizarlo"
      Y el snapshots dice por stderr "roto.pdf"

    Escenario: Save también avisa de un archivo que no es PDF
      Dado que la raíz del proyecto está vacía
      Y un archivo que no es PDF llamado "mi-doc.pdf"
      Cuando guardo los snapshots de "mi-doc.pdf"
      Entonces el snapshots termina con código 1
      Y el snapshots dice por stderr "no es un PDF"
      Y el archivo "snapshots" NO existe en el proyecto
