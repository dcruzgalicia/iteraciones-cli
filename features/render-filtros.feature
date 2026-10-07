# language: es
Característica: los nombres de los filtros del paquete

  Como quien desactiva un filtro en su config
  Quiero que el nombre que escribo exista, o que me digan cuál era
  Para no desactivar nada en silencio pensando que sí

  Regla de negocio: Los nombres se escanean una vez por proceso

    Escenario: Los nombres de los filtros se leen una sola vez
      Entonces los nombres de los filtros del paquete se memoizan

    Escenario: Los nombres de los preámbulos se leen una sola vez
      Entonces los nombres de los preámbulos del paquete se memoizan

  Regla de negocio: Un nombre viejo se completa con su capa

    Esquema del escenario: El nombre viejo se completa con su capa
      Dado que pregunto por el filtro "<nombre>"
      Cuando busco su nombre completo
      Entonces el nombre completo es "<esperado>"

      Ejemplos:
        | nombre | esperado |
        | 02-dictum | latex/02-dictum |
        | 01-dictum | html/01-dictum |
        | 05-spacer | html/05-spacer |

    Esquema del escenario: Un nombre sin coincidencia no sugiere nada
      Dado que pregunto por el filtro "<nombre>"
      Cuando busco su nombre completo
      Entonces no hay nombre completo

      Ejemplos:
        | nombre |
        | no-existe |
        | spacer |

  Regla de negocio: Un filtro desactivado que no existe avisa, y dice cuál escribir

    Escenario: Una lista vacía no avisa
      Dado que los filtros lua desactivados son "ninguno"
      Cuando valido los filtros desactivados
      Entonces no hay ningún aviso

    Escenario: Los nombres completos válidos no avisan
      Dado que los filtros lua desactivados son '["latex/02-dictum", "semantic/string/01-double-colon"]'
      Cuando valido los filtros desactivados
      Entonces no hay ningún aviso

    Escenario: Un nombre viejo avisa con la sugerencia
      Dado que los filtros lua desactivados son '["02-dictum"]'
      Cuando valido los filtros desactivados
      Entonces el aviso dice 'no existe; ¿quisiste decir "latex/02-dictum"?'

    Escenario: Un nombre inexistente avisa sin sugerencia
      Dado que los filtros lua desactivados son '["foo/bar"]'
      Cuando valido los filtros desactivados
      Entonces el aviso dice "no coincide con ningún filter"
