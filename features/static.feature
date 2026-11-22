Característica: archivos estáticos

  Como quien publica un PDF o un _redirects junto al sitio
  Quiero que static/ se copie a dist/files tal cual
  Para no mantener un script extra después del build

  Regla de negocio: static/ se copia a la salida conservando la estructura

    Escenario: Copia la raíz y las subcarpetas, y fusiona con la salida
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una carpeta static
      Cuando construyo el proyecto
      Entonces el archivo "dist/files/_redirects" existe en el proyecto
      Y el archivo "dist/files/assets/files/libro.pdf" existe en el proyecto
      Y el archivo "dist/files/assets/css/styles.css" existe en el proyecto
      Y el archivo "dist/files/assets/files/libro.pdf" contiene "PDF"

    Escenario: Un archivo estático sobrescribe una salida generada
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una carpeta static
      Cuando construyo el proyecto
      Entonces el archivo "dist/files/index.html" contiene "estático"

    Escenario: Un markdown dentro de static no se descubre como documento
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una carpeta static
      Cuando construyo el proyecto
      Entonces el archivo "dist/files/nota.html" NO existe en el proyecto
