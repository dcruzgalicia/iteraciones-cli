# language: es
Característica: el trabajo en paralelo y los procesos que no terminan

  Como quien compila cuarenta documentos
  Quiero que el trabajo en paralelo respete su tope y aborte a la primera falla
  Para no saturar la máquina ni esperar por resultados que nobody va a usar

  Regla de negocio: El resultado viene en el orden de la entrada

    Escenario: Todos los items se procesan
      Dado los items "1, 2, 3"
      Y nadie falla
      Cuando los proceso con concurrencia 2
      Entonces el resultado es "[2, 4, 6]"

    Escenario: El orden de la salida es el de la entrada
      Dado los items "1, 2, 3, 4"
      Y nadie falla
      Cuando los proceso con concurrencia 3
      Entonces el resultado es "[2, 4, 6, 8]"

    Escenario: Una lista vacía no da trabajo
      Dado los items ""
      Y nadie falla
      Cuando los proceso con concurrencia 2
      Entonces el resultado es "[]"

    Escenario: Con concurrencia 1 el trabajo es en serie
      Dado los items "1, 2, 3"
      Y nadie falla
      Cuando los proceso con concurrencia 1
      Entonces el resultado es "[2, 4, 6]"
      Y nunca hubo más de 1 a la vez

  Regla de negocio: El tope de concurrencia es un tope, no un promedio

    Escenario: Nunca se pasa del límite
      Dado los items "1, 2, 3, 4, 5"
      Y nadie falla
      Cuando los proceso con concurrencia 2
      Entonces nunca hubo más de 2 a la vez
      Y se procesaron los items "1, 2, 3, 4, 5"

    Esquema del escenario: Un límite inválido se rechaza
      Dado los items "1"
      Y nadie falla
      Cuando los proceso con el límite <limite>
      Entonces el fallo del trabajo dice "debe ser un entero >= 1"

      Ejemplos:
        | limite |
        | 0 |
        | -1 |
        | 1.5 |

  Regla de negocio: Un fallo aborta y abortar se avisa una vez (#2172)

    Escenario: Al fallar un item no se procesa lo pendiente
      Dado los items "1, 2, 3, 4, 5, 6, 7, 8"
      Y el item 1 falla al procesarse
      Cuando los proceso con concurrencia 2
      Entonces el error es "fallo deliberado"
      Y se excluyó el item que falla
      Y no se procesaron todos los items

    Escenario: onCancel se invoca una sola vez aunque fallen varios items
      Dado los items "1, 2, 3, 4"
      Y los items "2, 3, 4" fallan al procesarse
      Cuando los proceso con concurrencia 2
      Entonces el error es "fallo 2"
      Y se invocó onCancel 1 veces

    Escenario: En el camino feliz no se invoca onCancel
      Dado los items "1, 2, 3"
      Y nadie falla
      Cuando los proceso con concurrencia 2
      Entonces se invocó onCancel 0 veces

  Regla de negocio: El timeout se lleva el árbol entero (#2014)

    Escenario: Sin timeout se espera a que el proceso termine
      Dado que la raíz del proyecto está vacía
      Cuando corro "echo" sin timeout
      Entonces el proceso termina bien

    Escenario: Un proceso que no termina se corta con un error accionable
      Dado que la raíz del proyecto está vacía
      Cuando corro "sleep" que no termina, con timeout de 100 ms
      Entonces el proceso se termina por timeout
      Y el error dice que se llevaron también a sus hijos

  Regla de negocio: El Ctrl-C del build mata lo que está en vuelo

    Escenario: El apagado mata el proceso que está corriendo
      Dado que la raíz del proyecto está vacía
      Cuando arranco un proceso largo y lo mato en vuelo
      Entonces el proceso en vuelo terminó por el apagado
