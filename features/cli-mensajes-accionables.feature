# language: es
Característica: El CLI habla en español y dice qué hacer

  Como quien escribe en la terminal a las doce de la noche
  Quiero que los errores de uso y las rutas malas se informen en español y digan
  qué corregir
  Para no tener que ir a buscar el manual a mitad de un build

  Regla de negocio: El parser informa los errores de uso en español

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
      Y la ayuda contiene "iteraciones.config.yaml"
      Y la ayuda contiene "format.html.site.theme"
      Y la ayuda contiene "list-filters"

    Escenario: El help raíz no duplica la descripción de los comandos
      Cuando parseo el argv "--help"
      Entonces la ayuda repite "Construye documentos HTML" una sola vez
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

    Escenario: Los checks de permisos reportan inexistencia
      Dado que la raíz del proyecto no existe
      Cuando reviso los permisos de lectura y escritura
      Entonces ambos checks fallan
      Y ambos detalles dicen que la ruta no existe

  Regla de negocio: init crea la raíz en lugar de fallar

    Escenario: init crea un proyecto en una raíz inexistente
      Dado que la raíz del proyecto no existe
      Cuando corro "init"
      Entonces el comando termina con el código de salida 0
      Y existe el archivo de configuración del proyecto