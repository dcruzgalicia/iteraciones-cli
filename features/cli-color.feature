# language: es
Característica: El logger no colorea cuando el entorno pide no usar color
  Como quien corre el CLI en una tubería de un test
  Quiero que los códigos ANSI no aparezcan nunca en la salida de error
  Para que el output sea comparable byte a byte entre máquinas

  # `NO_COLOR` es el mecanismo estándar y el logger lo lee directo. Gana sobre
  # `isTTY`: aunque stderr sea una terminal, con `NO_COLOR` presente no se
  # colorea.
  #
  # ## Lo que este escenario destapa
  #
  # El test original ponía `NO_COLOR=1` a NIVEL DE MÓDULO en
  # `cli-layer.test.ts`, y el bloque "logger (color hermético en tests)" pasaba
  # por eso — no por `isTTY`. Al migrar, ese archivo se borra y la precondición
  # se iba con él: el escenario empezó a fallar porque el logger sí coloreaba.
  #
  # La precondición queda aquí, explícita. Un test que depende de un efecto
  # lateral de otro archivo es un test que se rompe cuando ese archivo cambia.
  #
  # Los dos escenarios son un par: el primero demuestra que `NO_COLOR` gana, el
  # segundo que sin él sí hay color. Sin el segundo, el primero pasaría también
  # si el logger no coloreara nunca — y no comprobaría nada.

  Escenario: Con NO_COLOR presente no colorea ni en una terminal
    Dado que stderr se presenta como una terminal
    Y el entorno pide no usar color
    Cuando el logger escribe una advertencia
    Entonces la salida lleva el mensaje con su prefijo
    Y la salida no lleva ningún código de control ANSI

  Escenario: Sin NO_COLOR una terminal sí recibe color
    Dado que stderr se presenta como una terminal
    Y el entorno no pide color
    Cuando el logger escribe una advertencia
    Entonces la salida lleva el mensaje con su prefijo
    Y la salida lleva códigos de control ANSI