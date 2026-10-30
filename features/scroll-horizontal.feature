# language: es
Característica: el sitio se recorre en horizontal

  Como quien lee un periódico
  Quiero columnas que llenen el alto y avanzar hacia la derecha
  Para no hacer scroll vertical

  Regla de negocio: Las columnas llenan la ventana y el scroll es horizontal

    Escenario: La página ocupa la ventana y scrollea a la derecha
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/index.html" dice "class=\"h-dvh\""
      Y el archivo "dist/files/index.html" dice "h-full overflow-hidden font-sans"
      Y el archivo "dist/files/index.html" dice "h-full overflow-x-auto overflow-y-hidden"
      Y el archivo "dist/files/index.html" dice "[column-fill:auto]"
      Y el archivo "dist/files/index.html" no dice "lg:container"
      Y el archivo "dist/files/assets/css/styles.css" contiene "column-fill:auto"
      Y el archivo "dist/files/assets/css/styles.css" contiene "overflow-x:auto"

    Escenario: En un subdirectorio también scrollea
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y el proyecto produce html
      Y una colección en "convocatorias" con 1 miembros
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "dist/files/convocatorias/antologia.html" dice "overflow-x-auto"
