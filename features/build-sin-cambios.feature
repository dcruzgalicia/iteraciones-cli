# language: es
@requires-pandoc
Característica: El build atajo corta cuando nada cambió
  Como quien recompila sin haber tocado nada
  Quiero que el build pare antes de reprocesar
  Para no gastar dos minutos de pandoc en un proyecto intacto

  Escenario: El segundo build sin cambios corta antes de procesar y no limpia dist
    Dado un proyecto de prueba con un documento inicial
    Cuando compilo el proyecto completo
    Y compilo otra vez sin tocar nada
    Entonces el build avisa que no hubo cambios
    Y no procesa ningún documento
    Y no limpia archivos residuales

  Escenario: Un proyecto sin documentos sale antes de los guards
    Dado un proyecto sin documentos
    Cuando compilo el proyecto vacío
    Entonces el build no dispara el atajo de sin cambios
    Y no procesa ningún documento

  Regla de negocio: Un espía no restaurado no puede contaminar el escenario siguiente
    Escenario: Un espía deliberadamente sucio deja marca en su propio escenario
      Dado un espía sin restaurar sobre el registro de documentos modificados
      Entonces el espía sigue puesto y este escenario lo ve

    Escenario: El siguiente escenario ya no lo ve
      Entonces el espía ya no está puesto
