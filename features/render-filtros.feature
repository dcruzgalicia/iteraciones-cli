# language: es
Característica: los nombres de los filtros del paquete

  Como quien desactiva un filtro en su config
  Quiero que el nombre que escribo exista, o que me digan cuál era
  Para no desactivar nada en silencio pensando que sí

  # Tramo 16 de la migración. 8 de los 28 casos de `render.test.ts`.

  Regla de negocio: Los nombres se escanean una vez por proceso

    # `getBuiltinFilterNames` lee el filesystem. Si se llamara dos veces por
    # build, con cuarenta documentos serían ochenta escaneos. La memoización se
    # comprueba por identidad de referencia: dos llamadas seguidas tienen que
    # devolver el MISMO array, no dos iguales.

    Escenario: Los nombres de los filtros se leen una sola vez
      Entonces los nombres de los filtros del paquete se memoizan

    Escenario: Los nombres de los preámbulos se leen una sola vez
      Entonces los nombres de los preámbulos del paquete se memoizan

  Regla de negocio: Un nombre viejo se completa con su capa

    # Antes de D1 los filtros se nombraban `02-dictum`; ahora son
    # `latex/02-dictum`. El sufijo sigue funcionando, así que el aviso puede
    # decir exactamente cuál escribir en vez de "no existe".

    Esquema del escenario: El nombre viejo se completa con su capa
      Dado que pregunto por el filtro "<nombre>"
      Cuando busco su nombre completo
      Entonces el nombre completo es "<esperado>"

      Ejemplos:
        | nombre | esperado |
        | 02-dictum | latex/02-dictum |
        | 01-dictum | html/01-dictum |
        | 05-spacer | html/05-spacer |

    # Sin coincidencia no hay sugerencia que dar. Inventar una sería peor que
    # callar: el autor escribiría un nombre que tampoco existe.
    Esquema del escenario: Un nombre sin coincidencia no sugiere nada
      Dado que pregunto por el filtro "<nombre>"
      Cuando busco su nombre completo
      Entonces no hay nombre completo

      Ejemplos:
        | nombre |
        | no-existe |
        | spacer |

  Regla de negocio: Un filtro desactivado que no existe avisa, y dice cuál escribir

    # Un nombre mal escrito desactiva NADA, en silencio: el autor cree que
    # apagó una cosa y el PDF sale con ella. El aviso lleva el nombre correcto
    # cuando hay uno, y el mensaje completo cuando no.

    Escenario: Una lista vacía no avisa
      Dado que los filtros lua desactivados son "ninguno"
      Cuando valido los filtros desactivados
      # Sin lista no hay nada que validar. Un aviso aquí sería ruido en cada
      # build de un proyecto que no desactiva filtros.
      Entonces no hay ningún aviso

    Escenario: Los nombres completos válidos no avisan
      Dado que los filtros lua desactivados son '["latex/02-dictum", "semantic/string/01-double-colon"]'
      Cuando valido los filtros desactivados
      Entonces no hay ningún aviso

    # El aviso con sugerencia es el caso útil: el autor escribió un nombre
    # pre-D1 y el mensaje le dice exactamente qué escribir ahora.
    Escenario: Un nombre viejo avisa con la sugerencia
      Dado que los filtros lua desactivados son '["02-dictum"]'
      Cuando valido los filtros desactivados
      Entonces el aviso dice 'no existe; ¿quisiste decir "latex/02-dictum"?'

    # Sin coincidencia no hay nada que sugerir, y el mensaje lo dice.
    Escenario: Un nombre inexistente avisa sin sugerencia
      Dado que los filtros lua desactivados son '["foo/bar"]'
      Cuando valido los filtros desactivados
      Entonces el aviso dice "no coincide con ningún filter"
