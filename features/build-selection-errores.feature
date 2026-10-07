# language: es
Característica: qué pasa cuando la selección está mal

  Como quien escribe `iteraciones build cap1.md`
  Quiero que un error de selección se explique y no deje nada a medias
  Para saber qué escribir y no encontrar `dist` roto

  # Tramo 34 de la migración. 8 de los 14 casos de `build-selection.test.ts`.

  # Un build parcial tiene que producir byte a byte lo mismo que un build
  # completo para esos documentos. Acá lo que importa es el otro lado: cuando la
  # selección está mal, el build dice POR QUÉ y no toca la salida.

  Regla de negocio: La selección se expande hacia abajo, no hacia arriba

    # Compilar `index.md` compila también lo que tiene en `files[]`. Al revés no:
    # compilar un miembro no compila la collection que lo contiene, porque
    # entonces cada `build <miembro>` regeneraría la portada.

    Escenario: Una collection expande sus files[] y sus creators
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "index.md"
      Cuando hago un build solo de los paths indicados
      # Ana García es creadora de la collection (collectionCreator) y del
      # capítulo (creator): de ahí los dos archivos con su nombre.
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
      # Ni `index` ni `ana-garcia`: la collection no se regenera.
      Entonces las salidas de documento son:
      """
      miembros/miembro-por-bruno-diaz.html
      miembros/miembro-por-bruno-diaz.md
      """

  Regla de negocio: Una selección imposible es un error, no una variante

    # `--full` borra la salida y un parcial no la borra: hacer las dos cosas a
    # la vez no tiene sentido, así que no se elige una de las dos en silencio.

    Escenario: --full con paths es error y explica por qué
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "cap1.md"
      Cuando hago un build completo con "full" esperando error
      # El mensaje dice las dos cosas: que son incompatibles y qué rompería.
      Entonces el código de salida del build es 1
      Y el aviso del build dice "incompatibles"
      Y el aviso del build dice "--full borra la salida"

    # Un path que no existe no se compila: se dice cuál se sought y dónde
    # estaba, que es lo que el autor puede corregir.
    Escenario: Un path inexistente dice el candidato cuando lo hay
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "mem.md"
      Cuando hago un build de los paths indicados esperando error
      # El candidato sugiere `miembros/mem.md`, que es el archivo real.
      Entonces el código de salida del build es 1
      Y el aviso del build dice "no existe el documento \"mem.md\""
      Y el aviso del build dice "miembros/mem.md"

    # Un path fuera de la raíz no se compila: sin esto, `build ../otro.md`
    # publicaría un documento de otro proyecto.
    Escenario: Un path fuera del proyecto no se sale de la raíz
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "../fuera.md"
      Cuando hago un build de los paths indicados esperando error
      Entonces el código de salida del build es 1
      Y el aviso del build dice "está fuera del proyecto"

  Regla de negocio: Un error no deja `dist` a medias

    # El peor resultado posible: `dist` con la mitad de los archivos nuevos y la
    # mitad viejos, y ningún error visible. Si el error se detecta después de
    # borrar, `dist` queda inservible.

    Escenario: La selección imposible no toca la salida anterior
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que ya hice un build completo con éxito
      Y que los paths a compilar son "no-existe.md"
      Cuando hago un build de los paths indicados esperando error
      # El dist es idéntico byte a byte al del build bueno.
      Entonces el código de salida del build es 1
      Y el dist sale byte a byte igual que la referencia

  Regla de negocio: Una collection dentro de files[] de otra no se puede construir

    # Las collections no se anidan: la segunda no sabría de qué collection es
    # miembro. El aviso dice qué quitar, porque "no se puede anidar" deja al
    # autor buscando el error en el archivo equivocado.

    Escenario: El build dice qué quitar del files[]
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection dentro de files[] de otra
      Y que los paths a compilar son ""
      Cuando hago un build completo con "ninguna" esperando error
      # `sub/coleccion.md` está en `files[]` de `index.md`.
      Entonces el código de salida del build es 1
      Y el aviso del build dice "una collection no puede formar parte de otra"
      Y el aviso del build dice "Quítalo de files[]"

  # --- Tramo 34: la superficie de `--json` (#2455) ---

  Regla de negocio: `selected` dice lo que la CLI decidió, no lo que pediste

    # Escribir `build index.md` no compila sólo `index.md`: compila el cierre
    # que la CLI resolvió. Si `selected` devolviera lo que el usuario escribió,
    # un script que lo consumiera creería que no se compiló lo demás.

  Regla de negocio: La selección resuelta viaja en el JSON

    Escenario: El JSON declara el cierre, no el argumento
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "index.md"
      Cuando hago un build de los paths indicados en JSON
      # Lo pedido fue "index.md"; lo compilado incluye files[] y la creadora.
      Entonces el JSON declara la selección "ana.md, cap1.md, index.md, miembros/mem.md"

    # La forma del JSON está congelada (D6): una clave que aparece o desaparece
    # rompe a quien lo consume. `selected` sólo existe con selección.
    Escenario: La forma del JSON sólo crece con `selected`
      Dado que la raíz del proyecto está vacía
      Y un proyecto con una collection y sus miembros
      Y que los paths a compilar son "miembros/mem.md"
      Cuando hago un build de los paths indicados en JSON
      # Un miembro pedido por su ruta se queda solo en él: seis claves + selected.
      Entonces las claves del JSON son "cached, durationMs, formats, invalidations, outputDir, processed, selected"
      Y el JSON declara la selección "miembros/mem.md"
