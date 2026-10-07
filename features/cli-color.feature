# language: es
Característica: El logger no colorea cuando el entorno pide no usar color
  Como quien corre el CLI en una tubería de un test
  Quiero que los códigos ANSI no aparezcan nunca en la salida de error
  Para que el output sea comparable byte a byte entre máquinas

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