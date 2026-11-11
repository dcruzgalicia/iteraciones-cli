# language: es
Característica: la ayuda separa el flujo editorial de los comandos avanzados

  Como quien empieza un proyecto
  Quiero ver primero init, new, build y preview
  Para encontrar los comandos avanzados sin que estorben

  Regla de negocio: El flujo editorial va primero y lo avanzado sigue accesible

    Escenario: La ayuda principal muestra el flujo editorial antes que lo avanzado
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "--help" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la ayuda contiene "Flujo editorial:"
      Y la ayuda contiene "Comandos avanzados:"
      Y la ayuda pone "Flujo editorial:" antes de "Comandos avanzados:"
      Y la ayuda contiene "init"
      Y la ayuda contiene "new"
      Y la ayuda contiene "preview"

    Escenario: Un comando avanzado sigue teniendo su ayuda
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "help merge" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "merge"
