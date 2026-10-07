# language: es
Característica: el trabajo en paralelo y los procesos que no terminan

  Como quien compila cuarenta documentos
  Quiero que el trabajo en paralelo respete su tope y aborte a la primera falla
  Para no saturar la máquina ni esperar por resultados que nobody va a usar

  # Tramo 35 de la migración. 13 de los 14 casos de `run.test.ts`.

  # `mapWithConcurrency` es la base de todo lo que corre en paralelo: el pool de
  # PDF, la validación, las imágenes. Un fallo de contrato aquí no se ve en un
  # documento mal hecho, se ve en un build que se cuelga o que procesa de más.

  Regla de negocio: El resultado viene en el orden de la entrada

    # El consumidor indexa por posición, así que un resultado desordenado mete el
    # documento A donde va el B — y nada falla, que es peor que fallar.

    Escenario: Todos los items se procesan
      Dado los items "1, 2, 3"
      Y nadie falla
      Cuando los proceso con concurrencia 2
      Entonces el resultado es "[2, 4, 6]"

    Escenario: El orden de la salida es el de la entrada
      Dado los items "1, 2, 3, 4"
      Y nadie falla
      Cuando los proceso con concurrencia 3
      # Con concurrencia 3 los items terminan desordenados y aun así salen en
      # orden: el resultado no es el orden de finalización.
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
      # límite 1: nunca hay dos a la vez, así que tampoco hay nada que ordenar.
      Entonces el resultado es "[2, 4, 6]"
      Y nunca hubo más de 1 a la vez

  Regla de negocio: El tope de concurrencia es un tope, no un promedio

    # Con cinco items y límite 2 nunca hay tres a la vez. Si el tope se
    # respetara "en promedio", la máquina se pelearía por la CPU justo cuando
    # más falta hace no pelear.

    Escenario: Nunca se pasa del límite
      Dado los items "1, 2, 3, 4, 5"
      Y nadie falla
      Cuando los proceso con concurrencia 2
      Entonces nunca hubo más de 2 a la vez
      Y se procesaron los items "1, 2, 3, 4, 5"

    # Un límite que no es un entero >= 1 se rechaza en vez de redondearse: un
    # límite 0 colgaría el build esperando workers que no existen.
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

    # Cuando un item falla no tiene sentido seguir: el build va a salir con
    # error igual. Lo que no se puede es *encolar* más trabajo — lo que no se
    # puede es ir gastando CPU en documentos que se van a descartar.

    Escenario: Al fallar un item no se procesa lo pendiente
      Dado los items "1, 2, 3, 4, 5, 6, 7, 8"
      Y el item 1 falla al procesarse
      Cuando los proceso con concurrencia 2
      # El error del item, no un "abortado" genérico: el autor tiene que ver
      # qué falló.
      Entonces el error es "fallo deliberado"
      Y se excluyó el item que falla
      Y no se procesaron todos los items

    # `onCancel` es el gancho que suelta un semáforo. Si se llamara una vez por
    # item fallido, el semáforo quedaría en N−1 y lo que venga después cuelga.
    Escenario: onCancel se invoca una sola vez aunque fallen varios items
      Dado los items "1, 2, 3, 4"
      Y los items "2, 3, 4" fallan al procesarse
      Cuando los proceso con concurrencia 2
      # Tres items fallan y se avisa UNA vez: el semáforo queda donde debe.
      Entonces el error es "fallo 2"
      Y se invocó onCancel 1 veces

    Escenario: En el camino feliz no se invoca onCancel
      Dado los items "1, 2, 3"
      Y nadie falla
      Cuando los proceso con concurrencia 2
      # Cancelar sin motivo suelta un semáforo que nadie vuelve a tomar.
      Entonces se invocó onCancel 0 veces

  Regla de negocio: El timeout se lleva el árbol entero (#2014)

    # Matar sólo el proceso directo deja a los hijos escribiendo sobre los
    # mismos ficheros del temporal. El mensaje lo dice, porque el autor tiene
    # que saber que puede limpiar sin miedo a encontrar procesos zombis.

    Escenario: Sin timeout se espera a que el proceso termine
      Dado que la raíz del proyecto está vacía
      Cuando corro "echo" sin timeout
      Entonces el proceso termina bien

    Escenario: Un proceso que no termina se corta con un error accionable
      Dado que la raíz del proyecto está vacía
      Cuando corro "sleep" que no termina, con timeout de 100 ms
      # El mensaje dice qué pasó y qué se llevó consigo.
      Entonces el proceso se termina por timeout
      Y el error dice que se llevaron también a sus hijos
  # --- Tramo 35: el apagado ordenado del CLI (#2172) ---

  Regla de negocio: El Ctrl-C del build mata lo que está en vuelo

    # Sin esto, un Ctrl-C deja procesos `sleep` de 30 segundos vivos esperando:
    # el CLI parece haber parado pero el trabajo sigue corriendo y el usuario
    # ve el fallo de la compilación de un proceso que ya no controla.

    Escenario: El apagado mata el proceso que está corriendo
      Dado que la raíz del proyecto está vacía
      Cuando arranco un proceso largo y lo mato en vuelo
      # El kill del árbol lo termina: sale con código distinto de 0 y no
      # espera los 30 segundos.
      Entonces el proceso en vuelo terminó por el apagado
