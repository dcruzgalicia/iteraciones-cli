Característica: la ayuda separa el flujo principal de los comandos internos

  Como quien empieza un proyecto
  Quiero ver primero create, new, build y preview
  Para no tropezar con los comandos internos

  Regla de negocio: El flujo principal va primero y los comandos internos no se listan

    Escenario: La ayuda principal agrupa el flujo principal
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "--help" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la ayuda contiene "Crear:"
      Y la ayuda contiene "Construir:"
      Y la ayuda contiene "Mantenimiento:"
      Y la ayuda pone "Crear:" antes de "Construir:"
      Y la ayuda contiene "create"
      Y la ayuda contiene "new"
      Y la ayuda contiene "preview"
      Y la ayuda no muestra "merge [options]"
      Y la ayuda no muestra "snapshots [options]"

    Escenario: Un comando interno sigue teniendo su ayuda
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "help merge" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "merge"
