# language: es
Característica: las fechas, los plurales y el documento exportado

  Como quien escribe la portada de un libro
  Quiero que la fecha del frontmatter salga tal cual la escribió el autor
  Para no publicar el 31 de diciembre un documento que es del 1 de enero

  Regla de negocio: Una fecha que no existe se devuelve tal cual (#2507)

    Esquema del escenario: Las fechas imposibles se devuelven sin tocar
      Dado la fecha del documento es "<fecha>"
      Cuando la formateo para el lector
      Entonces la fecha legible es "<fecha>"

      Ejemplos:
        | fecha |
        | 2026-02-29 |
        | 2026-01-32 |
        | 2026-04-31 |
        | 2026-13-01 |

    Escenario: Un 29 de febrero que sí existe se formatea
      Dado la fecha del documento es "2024-02-29"
      Cuando la formateo para el lector
      Entonces la fecha legible es "29 de febrero de 2024"

  Regla de negocio: La zona horaria no puede robar un día (#2507)

    Esquema del escenario: La fecha conserva su propio día
      Dado la fecha del documento es "<fecha>"
      Cuando la formateo para el lector
      Entonces la fecha conserva su propio día

      Ejemplos:
        | fecha |
        | 2026-01-01 |
        | 2026-06-15 |
        | 2026-12-31 |

  Regla de negocio: Lo que no es ISO se deja como está

    Esquema delcenario: Una fecha que no es ISO no se toca
      Dado la fecha del documento es "<fecha>"
      Cuando la formateo para el lector
      Entonces la fecha legible es "<fecha>"

      Ejemplos:
        | fecha |
        | 13/04/2026 |
        | sin fecha |

    Escenario: Sin fecha no hay fecha legible
      Dado que la raíz del proyecto está vacía
      Cuando la formateo sin fecha
      Entonces la fecha legible no existe

  Regla de negocio: El plural se cuenta, y el de los<Guid>ptoms no se adivina

    Esquema del escenario: Una palabra cuenta su plural
      Dado que la raíz del proyecto está vacía
      Cuando escribo <cantidad> "<palabra>"
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
      Entonces se lee "<esperado>"

      Ejemplos:
        | cantidad | palabra | pluralPalabra | esperado |
        | 1 | filter | filters | 1 filter |
        | 3 | filter | filters | 3 filters |
        | 2 | lua-filter | lua-filters | 2 lua-filters |

  Regla de negocio: El export lleva la fecha legible y su ISO

    Escenario: Los metadatos llevan la fecha legible y su ISO
      Dado que la raíz del proyecto está vacía
      Y el documento tiene título, fecha y dos autores
      Cuando lo ensamblo para "es-MX" con "" de bibliografía y "" de CSL
      Entonces los metadatos llevan la fecha legible y su ISO

    Escenario: Con CSL configurado se respeta el del proyecto
      Dado que la raíz del proyecto está vacía
      Y el documento tiene título, fecha y dos autores
      Cuando lo ensamblo para "es-MX" con "/proyecto/refs.bib" de bibliografía y "/proyecto/nature.csl" de CSL
      Entonces los metadatos llevan "/proyecto/nature.csl" como CSL
      Y los metadatos llevan "/proyecto/refs.bib" como bibliografía

    Escenario: Con bibliografía pero sin CSL no se incrusta el del paquete
      Dado que la raíz del proyecto está vacía
      Y el documento tiene título, fecha y dos autores
      Cuando lo ensamblo para "es-MX" con "/proyecto/refs.bib" de bibliografía y "" de CSL
      Entonces los metadatos no definen CSL
      Y los metadatos llevan "/proyecto/refs.bib" como bibliografía

    Escenario: Sin bibliografía no se define nada
      Dado que la raíz del proyecto está vacía
      Y el documento tiene título, fecha y dos autores
      Cuando lo ensamblo para "es-MX" con "" de bibliografía y "" de CSL
      Entonces los metadatos no definen CSL
      Y los metadatos no definen bibliografía