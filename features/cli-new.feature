# language: es
Característica: new crea el documento e infiere el título

  Como quien arranca un artículo a las tres de la mañana
  Quiero que `iteraciones new` infiera el título a partir del nombre de archivo
  Para no escribir el frontmatter a mano

  # 14 de los 172 casos de `cli-layer`.
  #
  # Los títulos de la tabla no están calculados a mano: salen de correr `runNew`
  # y leer lo que produjo. La inferencia capitaliza palabra por palabra y
  # respeta acentos, así que "año-nuevo" → "Año Nuevo" y no "Año-nuevo" — y esa
  # capitalized-words es exactamente lo que el original no documentaba en ningún
  # sitio. Si mañana cambia, la tabla se pone roja y dice por qué.

  Regla de negocio: El título se infiere del nombre del archivo

    Esquema del escenario: "<argumento>" produce el título "<título>"
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "<argumento>"
      Entonces el comando termina con el código de salida 0
      Y el archivo "<archivo>" existe
      Y el frontmatter de "<archivo>" declara el título "<título>"

      Ejemplos:
        | argumento                   | archivo                     | título             |
        | corazón-profundo            | corazón-profundo.md         | Corazón Profundo   |
        | posts/mi-articulo           | posts/mi-articulo.md        | Mi Articulo        |
        | posts/una-larga-historia.md | posts/una-larga-historia.md | Una Larga Historia |
        | hola                        | hola.md                     | Hola               |
        | con-ejemplos                | con-ejemplos.md             | Con Ejemplos       |
        | ensayo                     | ensayo.md                  | Ensayo             |
        | mi articulo nuevo           | mi-articulo-nuevo.md        | Mi Articulo Nuevo  |
        | d'artagnan                  | d'artagnan.md               | D'artagnan         |
        | mi-artículo                 | mi-artículo.md              | Mi Artículo        |
        | año-nuevo                   | año-nuevo.md                | Año Nuevo           |

    # `mi articulo nuevo` (con espacios) y `posts/mi-articulo` (con `/`) están
    # en la misma tabla a propósito: los espacios se vuelven guiones, las barras
    # se respetan, y los dos casos documentan eso sin un test aparte.

  Regla de negocio: El frontmatter mínimo trae fecha

    Escenario: El documento nuevo trae la clave date
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "posts/mi-articulo"
      Entonces el archivo "posts/mi-articulo.md" tiene la clave "date:"

  Regla de negocio: Los ejemplos del lenguaje van en el cuerpo

    # El usuario borra los ejemplos. Si uno se colara dentro del frontmatter, el
    # YAML de los proyectos siguientes se rompería al leerlos.

    Escenario: El documento nuevo trae ejemplos que el usuario borra
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "con-ejemplos"
      Entonces el archivo "con-ejemplos.md" contiene "::"
      Y el archivo "con-ejemplos.md" contiene "::: {.dictum}"
      Y el frontmatter de "con-ejemplos.md" no menciona "dictum"

  Regla de negocio: Un título explícito gana sobre la inferencia

    # El título se escribe en el `frontmatter`, y ahí un apóstrofo o una comilla
    # sin escapar rompen el YAML. Si se rompe, `new` no falla: falla el
    # `validate` del proyecto siguiente, que es donde el usuario lo descubre.
    #
    # Por eso el `Then` PARSEA el YAML y compara el valor, en vez de comparar la
    # línea como texto. Comparar el texto metería el estilo de comillas de la
    # librería `yaml` adentro de la regla de negocio, y un refactor inocuo de
    # esa dependencia rompería fourteen escenarios sin que cambiara el
    # comportamiento del CLI.
    #
    # Los títulos van entre comillas invertidas porque llevan comillas dentro.

    # El título va en un docstring y no dentro del texto del paso: lleva
    # comillas y apóstrofos, y en el texto del paso eso obliga a inventar
    # escapes de Gherkin que después nadie sabe leer.

    Esquema del escenario: El título "<rareza>" se escribe como YAML válido
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "mi-articulo" con el título "<título>"
      Entonces el frontmatter de "mi-articulo.md" declara el título "<título>"

      Ejemplos:
        | rareza                   | título                            |
        | apóstrofo                | D'Artagnan                        |
        | signos de interrogación  | ¿Qué falta?                       |
        | dos puntos y apóstrofo   | Los tres mosqueteros: d'Artagnan  |

    # Las comillas dobles NO van en un paso con argumento: `check-steps` sólo
    # reconoce cadenas entre `"` (es lo que Gherkin usa para los parámetros de
    # tabla), así que un título con comillas dentro de un `{string}` rompe el
    # inventario de pasos. El valor queda en el nombre del escenario, que es
    # texto libre, y el paso no lleva argumento.
    #
    # Es el caso que de verdad rompe el YAML: en estilo con comillas dobles, un
    # `"` sin escapar cierra la cadena y el `validate` del proyecto siguiente
    # revienta al parsear.

    Escenario: El título El "jardín" de las delicias se escribe como YAML válido
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "mi-articulo" con un título con comillas
      Entonces el frontmatter de "mi-articulo.md" declara ese título con comillas

  Regla de negocio: Un nombre con acentos no dispara un aviso falso

    # El aviso acá sería "el título quedó con caracteres raro", que es falso:
    # "mi-artículo" es un nombre perfectamente bueno.

    Escenario: Un nombre con acentos no dispara un aviso
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "mi-artículo"
      Entonces el comando termina con el código de salida 0
      Y la salida de error no lleva ningún aviso
      Y el frontmatter de "mi-artículo.md" declara el título "Mi Artículo"

  Regla de negocio: Crear dos veces el mismo documento no falla

    Escenario: El documento ya existente no es un error
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "doc"
      Y creo el documento "doc"
      Entonces el comando termina con el código de salida 0

  Regla de negocio: Las rutas que no son un nombre de archivo se rechazan

# Dos motivos distintos y el usuario los ve distintos. "relativa" es un
    # error de dirección — apuntaste fuera del proyecto. "incluya un nombre" es
    # un error de forma — te falta la parte final de la ruta, y el mensaje dice
    # con qué se ve bien.

    Esquema del escenario: "<argumento>" se rechaza por "<motivo>"
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "<argumento>"
      Entonces el comando termina con el código de salida 1
      Y el error dice "<motivo>"

      Ejemplos:
        | argumento  | motivo                                                            |
        | /etc/passwd | la ruta debe ser relativa al directorio del proyecto               |
        | .          | la ruta debe ser relativa al directorio del proyecto               |
        | posts/     | la ruta debe incluir un nombre de archivo                          |
        | .oculto.md | la ruta debe incluir un nombre de archivo                          |

    Escenario: El rechazo por nombre faltante dice con qué se ve bien
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "posts/"
      Entonces el error dice "posts/mi-articulo.md"
      Y el archivo "posts/.md" no existe

    Esquema del escenario: Un nombre rechazado no deja ningún archivo
      Dado que la raíz del proyecto está vacía
      Cuando creo el documento "<argumento>"
      Entonces el archivo "<archivo>" no existe

      Ejemplos:
        | argumento  | archivo      |
        | .oculto.md | .oculto.md   |
        | posts/     | posts/.md    |
        | .          | .md          |

  Regla de negocio: El documento sobrevive a validate y a build

    # El round-trip completo: un título con apóstrofo Y con dos puntos tiene que
    # pasar el `validate` (que parsea el YAML) y llegar al `build`. Si el escape
    # del frontmatter se rompe, esto se cae acá y no en el test del escape.

    @requires-pandoc
    Escenario: Un título difícil sobrevive a validate y a build
      Dado que la raíz del proyecto tiene una configuración mínima
      Cuando creo el documento "articulo" con el título "Los tres mosqueteros: d'Artagnan"
      Y valido el proyecto que acabo de crear
      Y construyo el proyecto
      Entonces el comando termina con el código de salida 0