# language: es
Característica: El CLI habla en español y dice qué hacer

  Como quien escribe en la terminal a las doce de la noche
  Quiero que los errores de uso y las rutas malas se informen en español y digan
  qué corregir
  Para no tener que ir a buscar el manual a mitad de un build

  # 22 de los 172 casos de `cli-layer`. El bloque `runBuild` (72 casos, 1.644
  # líneas) queda aparte: cada caso monta un proyecto distinto y comprueba algo
  # distinto, no es una tabla.

  Regla de negocio: El parser informa los errores de uso en español

    # El parser de commander traducía medio dozenaje de errores al español a
    # mano, uno por uno. El conjunto se documenta aquí como tabla: si mañana
    # alguien mete un mensaje nuevo en inglés, esta tabla no lo detecta, pero sí
    # deja por escrito qué es lo que tiene que traducir.

    Esquema del escenario: Un error de uso se informa con su mensaje
      Cuando parseo el argv "<argv>"
      Entonces el error dice "<mensaje>"
      Y el comando termina con el código de salida 1

      Ejemplos:
        | argv                    | mensaje                                                   |
        | comando-inexistente     | error: comando desconocido 'comando-inexistente'          |
        | validate --project-root | error: falta el argumento de la opción '--project-root <path>' |
        | new                     | error: falta el argumento requerido 'path'                  |
        | doctor --fix            | error: opción desconocida '--fix'                           |

  Regla de negocio: Un comando mal escrito sugiere el correcto

    # Sin esta regla, el mensaje "comando desconocido" deja al usuario
    # buscando. Commander calcula la cercanía y el CLI la muestra.

    Escenario: Sugiere el comando más cercano
      Cuando parseo el argv "bui"
      Entonces el error dice "error: comando desconocido 'bui'"
      Y el error sugiere el comando "build"

  Regla de negocio: La ayuda está traducida y es completa

    Esquema del escenario: La ayuda de <scope> documenta "<texto>"
      Cuando parseo el argv "<argv>"
      Entonces la ayuda contiene "<texto>"

      Ejemplos:
        | scope        | argv         | texto                          |
        | raíz         | --help       | muestra la ayuda               |
        | raíz         | --help       | muestra la versión             |
        | raíz         | --help       | help [comando]                 |
        | raíz         | --help       | muestra la ayuda de un comando |
        | raíz         | --help       | NO_COLOR                       |
        | subcomando   | build --help | --project-root                 |
        | subcomando   | build --help | directorio raíz del proyecto   |

    Escenario: La ayuda no filtra los textos originales de commander
      Cuando parseo el argv "--help"
      Entonces la ayuda no muestra "display help for command"
      Y la ayuda no muestra "output the version number"

  Regla de negocio: El help raíz da los primeros pasos

    Escenario: El help raíz ofrece el slogan, el ejemplo rápido y los enlaces
      Cuando parseo el argv "--help"
      Entonces la ayuda contiene "escribir, compartir, re-existir"
      Y la ayuda contiene "iteraciones init"
      Y la ayuda contiene "iteraciones new posts/doc.md"
      Y la ayuda contiene "iteraciones build"
      Y la ayuda contiene "docs/configuration.md"
      Y la ayuda contiene "docs/ejemplos.md"
      Y la ayuda contiene "list-filters"

    # El help raíz va precedido de un bloque escrito a mano ANTES de que
    # commander imprima su tabla. Dos fallos que ya dieron: la descripción de
    # `build` aparecía dos veces (bloque propio + `.description()` de commander),
    # y el bloque empezaba con una línea en blanco.

    Escenario: El help raíz no duplica la descripción de los comandos
      Cuando parseo el argv "--help"
      Y la ayuda repite "Construye documentos HTML" una sola vez
      Y la ayuda empieza con el slogan

  Regla de negocio: El comando help muestra la ayuda de un comando

    Esquema del escenario: help de "<comando>" muestra "<texto>"
      Cuando parseo el argv "help <argv>"
      Entonces la ayuda contiene "<texto>"
      Y el código de salida es 0

      Ejemplos:
        | alcance   | argv   | texto          |
        | help build | build | --full        |
        | raíz       |       | Primeros pasos |

  Regla de negocio: Un --output fuera del proyecto se informa sin stack trace

    Escenario: --output que escapa del proyecto
      Cuando parseo el argv "build --output ../fuera"
      Entonces el error dice "--output no puede apuntar fuera del proyecto"
      Y el error no muestra un stack trace
      Y el comando termina con el código de salida 1

  Regla de negocio: Una raíz inexistente da un mensaje accionable

    # Esto no es un `ENOENT` pelado. El usuario escribió mal el `--project-root`
    # y necesita saber eso, no leer el error interno de Node. La regla dice
    # "no existe" — accionable — y además tapa el detalle crudo.

    Esquema del escenario: "<comando>" falla cuando la raíz no existe
      Dado que la raíz del proyecto no existe
      Cuando corro "<comando>"
      Entonces el error dice que la ruta no existe
      Y el comando termina con el código de salida 1

      Ejemplos:
        | comando      |
        | build        |
        | validate     |
        | doctor       |
        | new          |
        | clean        |
        | list-filters |

    Esquema del escenario: El error no filtra el detalle crudo del sistema
      Dado que la raíz del proyecto no existe
      Cuando corro "<comando>"
      Entonces el error no dice "<ruido>"

      Ejemplos:
        | comando | ruido         |
        | build  | ENOENT       |
        | doctor | sin permisos |

  Regla de negocio: Los checks de doctor distinguen inexistencia de EACCES

    # EACCES e inexistencia son fallos distintos: un `checkReadPermissions` que
    # devuelve `sin permisos` sobre una ruta inexistente empuja al usuario a
    # `chmod` una carpeta que no existe.

    Escenario: Los checks de permisos reportan inexistencia
      Dado que la raíz del proyecto no existe
      Cuando reviso los permisos de lectura y escritura
      Entonces ambos checks fallan
      Y ambos detalles dicen que la ruta no existe

  Regla de negocio: init crea la raíz en lugar de fallar

    # El único comando que NO falla: `init` sobre una ruta que no existe es
    # exactamente su caso de uso.

    Escenario: init crea un proyecto en una raíz inexistente
      Dado que la raíz del proyecto no existe
      Cuando corro "init"
      Entonces el comando termina con el código de salida 0
      Y existe el archivo de configuración del proyecto