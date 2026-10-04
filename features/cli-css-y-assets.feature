# language: es
Característica: el CSS y los assets que deja un build

  Como quien instala el resultado en su servidor
  Quiero un CSS que sólo tenga las clases que el HTML usa y ningún asset huérfano
  Para no subir a producción medio megabyte de estilos que no se pintan

  # Tramo 3 de la migración. 3 de los 16 casos que quedaban de `cli-layer`.

  Regla de negocio: El CSS se compila sobre los HTML finales

    # El escaneo que decide qué clases se compilan lee SÓLO los HTML finales de
    # `dist/files`. Si leyera cualquier `.md` —el de un cambio en
    # `.iteraciones/changes`, o uno suelto en `dist/`— las clases que nadie usa
    # acabarían en el CSS de producción.
    #
    # Lo que no se escanea, no se copia: sin HTML no hay fuentes ni licencias,
    # porque son assets del HTML.

    Escenario: El CSS se compila sobre los HTML finales, no sobre markdown suelto
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que escribo markdown de relleno con clases inventadas
      Dado que el documento tiene una clase que hay que compilar
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y el CSS se compila sobre los HTML finales

    Escenario: La página trae el botón de volver al principio y el CSS su animación
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y la página trae el botón de volver al principio y el CSS su animación

    Escenario: Sin HTML activo no se copian las fuentes ni sus licencias
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Dado que la raíz del proyecto desactiva el HTML y enciende LaTeX
      Cuando hago un build del proyecto
      Entonces el comando termina con el código de salida 0
      Y sin HTML activo no se copian las fuentes
