# language: es
Característica: las fechas, los plurales y el documento exportado

  Como quien escribe la portada de un libro
  Quiero que la fecha del frontmatter salga tal cual la escribió el autor
  Para no publicar el 31 de diciembre un documento que es del 1 de enero

  # Tramo 36 de la migración. 10 de los 14 casos de `lib-utils.test.ts`.

  # La fecha de un libro no es un instante: es un día que alguien escribió. Eso
  # decide las tres reglas de esta página.

  Regla de negocio: Una fecha que no existe se devuelve tal cual (#2507)

    # `2026-02-29` no está en el calendario. Un formateador que normalizara
    # devolvería "1 de marzo de 2026" y el error del frontmatter quedaría
    # escondido detrás de una fecha que parece válida. Es peor no ver el error
    # que verlo raro.

    Esquema del escenario: Las fechas imposibles se devuelven sin tocar
      Dado la fecha del documento es "<fecha>"
      Cuando la formateo para el lector
      # 2026 no es bisiesto y abril tiene 30 días.
      Entonces la fecha legible es "<fecha>"

      Ejemplos:
        | fecha |
        | 2026-02-29 |
        | 2026-01-32 |
        | 2026-04-31 |
        | 2026-13-01 |

    # Y un 29 de febrero que sí existe se formatea: el formateador sabe cuándo
    # la fecha es válida, no cuándo es ISO.
    Escenario: Un 29 de febrero que sí existe se formatea
      Dado la fecha del documento es "2024-02-29"
      Cuando la formateo para el lector
      Entonces la fecha legible es "29 de febrero de 2024"

  Regla de negocio: La zona horaria no puede robar un día (#2507)

    # Con un UTC−8 el instante UTC de medianoche cae el día anterior local. Si
    # la conversión fuera por `new Date(...)`, en el PDF pondría 31 de
    # diciembre. Un día es un día, no un instante.

    Esquema del escenario: La fecha conserva su propio día
      Dado la fecha del documento es "<fecha>"
      Cuando la formateo para el lector
      # Los tres días del año: el primero, uno de mitad y el último.
      Entonces la fecha conserva su propio día

      Ejemplos:
        | fecha |
        | 2026-01-01 |
        | 2026-06-15 |
        | 2026-12-31 |

  Regla de negocio: Lo que no es ISO se deja como está

    # Una fecha en otro formato es un dato que el CLI no sabe leer, no uno que
    # deba adivinar. Y sin fecha no hay fecha legible: no se inventa una.

    Esquema delcenario: Una fecha que no es ISO no se toca
      Dado la fecha del documento es "<fecha>"
      Cuando la formateo para el lector
      # El autor escribió otra cosa y esa otra cosa sale tal cual.
      Entonces la fecha legible es "<fecha>"

      Ejemplos:
        | fecha |
        | 13/04/2026 |
        | sin fecha |

    Escenario: Sin fecha no hay fecha legible
      Dado que la raíz del proyecto está vacía
      Cuando la formateo sin fecha
      # Nada de "de fecha": el hueco es información.
      Entonces la fecha legible no existe

  Regla de negocio: El plural se cuenta, y el de los<Guid>ptoms no se adivina

    # "1 filters" se lee como un bug. Para los agujerismos la forma plural no es
    # deducible, así que se declara explícita.

    Esquema del escenario: Una palabra cuenta su plural
      Dado que la raíz del proyecto está vacía
      Cuando escribo <cantidad> "<palabra>"
      # `documento` termina en vocal y `error` en consonante.
      Entonces se lee "<esperado>"

      Ejemplos:
        | cantidad | palabra | esperado |
        | 1 | error | 1 error |
        | 2 | error | 2 errores |
        | 1 | documento | 1 documento |
        | 2 | documento | 2 documentos |

    Esquema del escenario: Un término extranjero lleva su plural declarado
      Dado que la raíz del proyecto está vacía
      Cuando escribo <cantidad> "<palabra>" en plural "<pluralPalabra>"
      # Sin el plural declarado, "filter" saldría como "filters" en singular.
      Entonces se lee "<esperado>"

      Ejemplos:
        | cantidad | palabra | pluralPalabra | esperado |
        | 1 | filter | filters | 1 filter |
        | 3 | filter | filters | 3 filters |
        | 2 | lua-filter | lua-filters | 2 lua-filters |

  # --- Tramo 36: el ensamblado del documento exportado ---

  # El `csl` del paquete NO se incrusta nunca. Un export portable que lleva la
  # ruta al APA del propio paquete no funciona en otro máquina: el export tiene
  # que salir con la bibliografía del proyecto o sin bibliografía.

  Regla de negocio: El export lleva la fecha legible y su ISO

    Escenario: Los metadatos llevan la fecha legible y su ISO
      Dado que la raíz del proyecto está vacía
      Y el documento tiene título, fecha y dos autores
      Cuando lo ensamblo para "es-MX" con "" de bibliografía y "" de CSL
      # `date` es para el lector y `dateIso` para la máquina: las dos cosas.
      Entonces los metadatos llevan la fecha legible y su ISO

    Escenario: Con CSL configurado se respeta el del proyecto
      Dado que la raíz del proyecto está vacía
      Y el documento tiene título, fecha y dos autores
      Cuando lo ensamblo para "es-MX" con "/proyecto/refs.bib" de bibliografía y "/proyecto/nature.csl" de CSL
      # El CSL del proyecto gana siempre sobre el del paquete.
      Entonces los metadatos llevan "/proyecto/nature.csl" como CSL
      Y los metadatos llevan "/proyecto/refs.bib" como bibliografía

    # Sin CSL del proyecto, el export no lleva ninguno: mejor un export sin
    # estilo que uno con una ruta que no existe en la máquina destino.
    Escenario: Con bibliografía pero sin CSL no se incrusta el del paquete
      Dado que la raíz del proyecto está vacía
      Y el documento tiene título, fecha y dos autores
      Cuando lo ensamblo para "es-MX" con "/proyecto/refs.bib" de bibliografía y "" de CSL
      # El apa-7 del paquete NO entra: el export tiene que ser portable.
      Entonces los metadatos no definen CSL
      Y los metadatos llevan "/proyecto/refs.bib" como bibliografía

    Escenario: Sin bibliografía no se define nada
      Dado que la raíz del proyecto está vacía
      Y el documento tiene título, fecha y dos autores
      Cuando lo ensamblo para "es-MX" con "" de bibliografía y "" de CSL
      Entonces los metadatos no definen CSL
      Y los metadatos no definen bibliografía