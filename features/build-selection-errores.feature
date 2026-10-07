# language: es
Característica: qué pasa cuando la selección está mal

  Como quien escribe `iteraciones build cap1.md`
  Quiero que un error de selección se explique y no deje nada a medias
  Para saber qué escribir y no encontrar `dist` roto

  Regla de negocio: La selección se expande hacia abajo, no hacia arriba

    Escenario: Una collection expande sus files[] y sus creators
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "index.md"
      Cuando hago un build solo de los paths indicados
      Entonces las salidas de documento son:
      """
      ana-garcia.html
      ana-garcia.md
      capitulo-uno-por-ana-garcia.html
      capitulo-uno-por-ana-garcia.md
      index.html
      index.md
      miembros/miembro-por-bruno-diaz.html
      miembros/miembro-por-bruno-diaz.md
      """

    Escenario: Un miembro de files[] se queda solo en él
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "miembros/mem.md"
      Cuando hago un build solo de los paths indicados
      Entonces las salidas de documento son:
      """
      miembros/miembro-por-bruno-diaz.html
      miembros/miembro-por-bruno-diaz.md
      """

  Regla de negocio: Una selección imposible es un error, no una variante

    Escenario: --full con paths es error y explica por qué
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "cap1.md"
      Cuando hago un build completo con "full" esperando error
      Entonces el código de salida del build es 1
      Y el aviso del build dice "incompatibles"
      Y el aviso del build dice "--full borra la salida"

    Escenario: Un path inexistente dice el candidato cuando lo hay
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "mem.md"
      Cuando hago un build de los paths indicados esperando error
      Entonces el código de salida del build es 1
      Y el aviso del build dice "no existe el documento \"mem.md\""
      Y el aviso del build dice "miembros/mem.md"

    Escenario: Un path fuera del proyecto no se sale de la raíz
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "../fuera.md"
      Cuando hago un build de los paths indicados esperando error
      Entonces el código de salida del build es 1
      Y el aviso del build dice "está fuera del proyecto"

  Regla de negocio: Un error no deja `dist` a medias

    Escenario: La selección imposible no toca la salida anterior
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que ya hice un build completo con éxito
      Y que los paths a compilar son "no-existe.md"
      Cuando hago un build de los paths indicados esperando error
      Entonces el código de salida del build es 1
      Y el dist sale byte a byte igual que la referencia

  Regla de negocio: Una collection dentro de files[] de otra no se puede construir

    Escenario: El build dice qué quitar del files[]
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection dentro de files[] de otra
      Y que los paths a compilar son ""
      Cuando hago un build completo con "ninguna" esperando error
      Entonces el código de salida del build es 1
      Y el aviso del build dice "una collection no puede formar parte de otra"
      Y el aviso del build dice "Quítalo de files[]"

  Regla de negocio: `selected` dice lo que la CLI decidió, no lo que pediste

  Regla de negocio: La selección resuelta viaja en el JSON

    Escenario: El JSON declara el cierre, no el argumento
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "index.md"
      Cuando hago un build de los paths indicados en JSON
      Entonces el JSON declara la selección "ana.md, cap1.md, index.md, miembros/mem.md"

    Escenario: La forma del JSON sólo crece con `selected`
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "miembros/mem.md"
      Cuando hago un build de los paths indicados en JSON
      Entonces las claves del JSON son "cached, durationMs, formats, invalidations, outputDir, processed, selected"
      Y el JSON declara la selección "miembros/mem.md"
