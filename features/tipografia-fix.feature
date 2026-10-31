# language: es
Característica: la corrección tipográfica del markdown

  Como quien revisa un PDF antes de mandarlo a imprenta
  Quiero que --fix pegue los espacios que el PDF pide y me diga qué no pudo
  Para llegar a imprenta con el markdown corregido

  Los primeros escenarios bajan al nivel de los helpers de --fix, igual que
  tipografia.feature baja al nivel de analyzeText. Al final van los de punta a
  punta: las excepciones y el --fix corriendo el CLI contra un mundo con git.

  Regla de negocio: La búsqueda normaliza el markdown antes de comparar

    Escenario: Quita los divs en línea conservando el texto visible
      Cuando normalizo para buscar "lo vivimos [en carne propia]{.text-nowrap}."
      Entonces el texto normalizado es "lo vivimos en carne propia."

    Escenario: Quita el énfasis, el código y los enlaces conservando el texto
      Cuando normalizo para buscar "**negrita** *cursiva* `código` [texto](url)"
      Entonces el texto normalizado es "negrita cursiva código texto"

  Regla de negocio: Dentro de un fenced div el runt se anida

    Escenario: Un párrafo dentro de un shrink lleva el runt adentro
      Cuando envuelvo el párrafo contenedor de la incidencia "proyecto.":
        """
        ::: {shrink=20}
        Gracias, Miranda, por el prólogo con el que acuerpas este libro. A
        todas las que hicieron comunidad alrededor de este proyecto.
        :::
        """
      Entonces el markdown queda:
        """
        ::: {shrink=20}
        ::: {runt=2}
        Gracias, Miranda, por el prólogo con el que acuerpas este libro. A
        todas las que hicieron comunidad alrededor de este proyecto.
        :::
        :::
        """
      Cuando vuelvo a envolver el párrafo contenedor de la incidencia "proyecto."
      Entonces no hay párrafo que envolver

    Escenario: Un párrafo dentro de un stretch también se anida
      Cuando envuelvo el párrafo contenedor de la incidencia "texto.":
        """
        ::: {stretch=1.5}
        Un párrafo suelto que termina con esta palabra del texto.
        :::
        """
      Entonces el markdown queda:
        """
        ::: {stretch=1.5}
        ::: {runt=2}
        Un párrafo suelto que termina con esta palabra del texto.
        :::
        :::
        """

  Regla de negocio: Una palabra suelta se envuelve con runt=2 dentro de su contenedor

    Escenario: Envuelve el párrafo dentro de un atributo de bloque del frontmatter
      Cuando envuelvo el párrafo contenedor de la incidencia "Antologadora":
        """
        ---
        titleback: |
          *Antologadora*

          otra línea
        ---
        cuerpo
        """
      Entonces el markdown queda:
        """
        ---
        titleback: |
          ::: {runt=2}
          *Antologadora*
          :::

          otra línea
        ---
        cuerpo
        """
      Cuando vuelvo a envolver el párrafo contenedor de la incidencia "Antologadora"
      Entonces no hay párrafo que envolver

    Escenario: Convierte el title escalar en bloque con runt
      Cuando envuelvo el párrafo contenedor de la incidencia "PROMISSUS":
        """
        ---
        title: Promissus
        ---
        cuerpo
        """
      Entonces el markdown queda:
        """
        ---
        title: |
          ::: {runt=2}
          Promissus
          :::
        ---
        cuerpo
        """
      Cuando vuelvo a envolver el párrafo contenedor de la incidencia "PROMISSUS"
      Entonces no hay párrafo que envolver

    Escenario: Desambigua con la línea siguiente entre dos coincidencias
      Cuando envuelvo el párrafo contenedor de la incidencia "Antologadora" seguida de "Ángeles Sanlopez":
        """
        ---
        titleback: |
          *Antologadora*

          otra cosa

          *Antologadora*

          [Ángeles Sanlopez]{.smallcaps}
        ---
        cuerpo
        """
      Entonces el markdown queda:
        """
        ---
        titleback: |
          *Antologadora*

          otra cosa

          ::: {runt=2}
          *Antologadora*
          :::

          [Ángeles Sanlopez]{.smallcaps}
        ---
        cuerpo
        """

    Escenario: Envuelve el párrafo del cuerpo y no el frontmatter
      Cuando envuelvo el párrafo contenedor de la incidencia "palabra.":
        """
        ---
        title: Otra cosa
        ---
        Un párrafo que termina en
        palabra.
        """
      Entonces el markdown queda:
        """
        ---
        title: Otra cosa
        ---
        ::: {runt=2}
        Un párrafo que termina en
        palabra.
        :::
        """

  Regla de negocio: Una palabra suelta que vive en un encabezado no se envuelve

    Escenario: Reconoce los encabezados como palabra suelta y no las menciones en prosa
      Cuando busco la palabra suelta "nota" en:
        """
        ---
        title: Otra cosa
        ---

        # Nota
        """
      Entonces encuentra la palabra suelta
      Cuando busco la palabra suelta "nota" en:
        """
        ---
        title: Otra cosa
        ---

        una nota final.
        """
      Entonces no encuentra la palabra suelta

    Escenario: Detecta el encabezado que coincide con la incidencia
      Cuando reviso si es título de sección la incidencia "Nota" en:
        """
        ---
        title: Otra cosa
        ---

        # Nota
        """
      Entonces es título de sección
      Cuando reviso si es título de sección la incidencia "nota." en:
        """
        ---
        title: Otra cosa
        ---

        # Nota
        """
      Entonces no es título de sección
      Cuando reviso si es título de sección la incidencia "nota" en:
        """
        ---
        title: Otra cosa
        ---

        una nota final.
        """
      Entonces no es título de sección

  Regla de negocio: El &nbsp; se pega sin cruzar párrafos, bloques ni YAML ajeno

    Escenario: Aplica dentro de un bloque runt
      Cuando pego el espacio posterior de "necesita; escritora" en:
        """
        ::: {runt=2}
        se necesita; escritora desde niña
        :::
        """
      Entonces el markdown queda:
        """
        ::: {runt=2}
        se necesita; escritora&nbsp;desde niña
        :::
        """
      Cuando pego el espacio anterior de "este;" en:
        """
        ::: {runt=2}
        llega este;
        :::
        """
      Entonces el markdown queda:
        """
        ::: {runt=2}
        llega&nbsp;este;
        :::
        """

    Escenario: Iguala las comillas tipográficas del PDF con las rectas del markdown
      Cuando pego el espacio posterior de "“hola mundo”" en:
        """
        te dije "hola mundo" alto
        """
      Entonces el markdown queda:
        """
        te dije "hola mundo"&nbsp;alto
        """

    Escenario: Aplica dentro de un escalar de bloque del frontmatter y no en el resto del YAML
      Cuando pego el espacio posterior de "texto brindar" en:
        """
        ---
        colophon: |
          texto brindar un enlace
        ---
        """
      Entonces el markdown queda:
        """
        ---
        colophon: |
          texto brindar&nbsp;un enlace
        ---
        """
      Cuando pego el espacio posterior de "necesita; escritora" en:
        """
        ---
        title: se necesita; escritora
        ---
        """
      Entonces no hay dónde pegarlo

    Escenario: No toca el contenido de un bloque qr
      Cuando pego el espacio posterior de "https://x.com/a" en:
        """
        ::: {qr=15mm}
        https://x.com/a b
        :::
        """
      Entonces no hay dónde pegarlo

    Escenario: No cruza un corte de párrafo
      Cuando pego el espacio posterior de "fin de párrafo" en:
        """
        fin de párrafo

        siguiente párrafo
        """
      Entonces no hay dónde pegarlo

    Escenario: No se repite en una segunda pasada
      Cuando reviso si la aguja "necesita; escritora" ya está aplicada por detrás en:
        """
        ::: {runt=2}
        se necesita; escritora&nbsp;desde niña
        :::
        """
      Entonces ya está aplicada
      Cuando reviso si la aguja "necesita; escritora" ya está aplicada por detrás en:
        """
        ::: {runt=2}
        se necesita; escritora desde niña
        :::
        """
      Entonces no está aplicada
      Cuando reviso si la aguja "este;" ya está aplicada por delante en:
        """
        ::: {runt=2}
        llega&nbsp;este;
        :::
        """
      Entonces ya está aplicada

    Escenario: La aguja cruza un corte de línea del markdown, nunca una línea en blanco
      Cuando pego el espacio posterior de "no he terminado el" en:
        """
        a veces regreso a la compu. Como hoy, pues no he
        terminado el último capítulo de la tesis.
        """
      Entonces el markdown queda:
        """
        a veces regreso a la compu. Como hoy, pues no he
        terminado el&nbsp;último capítulo de la tesis.
        """
      Cuando reviso si la aguja "no he terminado el" ya está aplicada por detrás en:
        """
        pues no he
        terminado el&nbsp;último capítulo
        """
      Entonces ya está aplicada
      Cuando pego el espacio posterior de "fin el" en:
        """
        fin

        el resto
        """
      Entonces no hay dónde pegarlo
      Cuando pego el espacio anterior de "el resto" en:
        """
        fin

        el resto
        """
      Entonces no hay dónde pegarlo

    Escenario: La aguja también cruza un espacio ya pegado en la fuente
      Cuando pego el espacio posterior de "no he terminado el" en:
        """
        pues no he terminado el último capítulo
        """
      Entonces el markdown queda:
        """
        pues no he terminado el&nbsp;último capítulo
        """
      Cuando pego el espacio posterior de "no he terminado el" en:
        """
        pues no he terminado&nbsp;el último capítulo
        """
      Entonces el markdown queda:
        """
        pues no he terminado&nbsp;el&nbsp;último capítulo
        """
      Cuando reviso si la aguja "no he terminado el" ya está aplicada por detrás en:
        """
        pues no he terminado el&nbsp;último capítulo
        """
      Entonces ya está aplicada

    Escenario: No pega contra una línea que abre o cierra bloque
      Cuando pego el espacio anterior de "Mi trabajo parte de la observación" en:
        """
        ::: {runt=2}
        Mi trabajo parte de la observación de lo cotidiano.
        :::
        """
      Entonces no hay dónde pegarlo
      Cuando pego el espacio anterior de "Texto de la contraportada" en:
        """
        titleback: |
          Texto de la contraportada que sigue.
        """
      Entonces no hay dónde pegarlo
      Cuando pego el espacio anterior de "Cuidarme como" en:
        """
        Antes venía esto.
        - Cuidarme como prioridad
        """
      Entonces no hay dónde pegarlo
      Cuando pego el espacio posterior de "Termina el cuerpo" en:
        """
        Termina el cuerpo.
        :::
        """
      Entonces no hay dónde pegarlo
      Cuando pego el espacio posterior de "Fin del bloque" en:
        """
        Fin del bloque
        ---
        """
      Entonces no hay dónde pegarlo
      Cuando pego el espacio posterior de "Contraportada" en:
        """
          Contraportada
        uppertitleback: |
        """
      Entonces no hay dónde pegarlo
      Cuando pego el espacio anterior de "Línea dos" en:
        """
        titleback: |
          Línea uno
          Línea dos
        """
      Entonces el markdown queda:
        """
        titleback: |
          Línea uno&nbsp;Línea dos
        """

  Regla de negocio: El &nbsp; iguala los caracteres que el PDF dibuja distinto

    Escenario: Iguala la ligadura «hĳa» del PDF con «hija» del markdown
      Cuando pego el espacio posterior de "contener los llantos de mi hĳa," en:
        """
        Yo llevaba semanas en la locura: contener los llantos de mi hija, trabajar, limpiar, cuidar.
        """
      Entonces el markdown queda:
        """
        Yo llevaba semanas en la locura: contener los llantos de mi hija,&nbsp;trabajar, limpiar, cuidar.
        """

    Escenario: Iguala los puntos suspensivos espaciados del PDF con los del markdown
      Cuando pego el espacio posterior de "El feminismo me jodió la vida. . ." en:
        """
        Mis textos aparecen en las antologías *El feminismo me jodió la vida... y luego me salvó* (2022),
        """
      Entonces el markdown queda:
        """
        Mis textos aparecen en las antologías *El feminismo me jodió la vida...&nbsp;y luego me salvó* (2022),
        """

  Regla de negocio: Los objetivos deciden dónde pega el &nbsp; y cuándo no aplica

    Escenario: El primer objetivo pega el &nbsp; en la unión de las líneas, no a media línea
      Dado una incidencia "repeated-last-letter" de la página 19 y la línea 14 con la letra "a" y estas líneas:
        | línea | texto                                                          |
        | 14    |   Mi mamá no fue una mujer muy cariñosa, no se permitía        |
        | 15    | las caricias, las palabras tiernas o melosas. Al contrario, era |
      Y el primer objetivo es "Mi mamá no fue una mujer muy cariñosa, no se permitía"
      Cuando aplico el primer objetivo al markdown:
        """
        Mi mamá no fue una mujer muy cariñosa, no se permitía las caricias, las palabras tiernas o melosas.
        """
      Entonces el markdown queda:
        """
        Mi mamá no fue una mujer muy cariñosa, no se permitía&nbsp;las caricias, las palabras tiernas o melosas.
        """

    Escenario: Alarga la aguja de la unión cuando las cortas son ambiguas
      Dado una incidencia "repeated-last-letter" de la página 44 y la línea 2 con la letra "o" y estas líneas:
        | línea | texto                                                   |
        | 2     | en el cuerpo. Como una historia mal contada que ya no   |
        | 3     | encajaba. Como una sensación persistente de que algo no |
      Y el primer objetivo termina en "mal contada que ya no"
      Cuando pego el espacio posterior de "ya no" en:
        """
        Como una historia mal contada que ya no encajaba. Y otra que ya no sigue.
        """
      Entonces no hay dónde pegarlo
      Cuando pego el espacio posterior de "mal contada que ya no" en:
        """
        Como una historia mal contada que ya no encajaba. Y otra que ya no sigue.
        """
      Entonces el markdown queda:
        """
        Como una historia mal contada que ya no&nbsp;encajaba. Y otra que ya no sigue.
        """

    Escenario: repeated-first-letter pega antes de la primera palabra de la línea siguiente
      Dado una incidencia "repeated-first-letter" de la página 22 y la línea 27 con la letra "c" y estas líneas:
        | línea | texto                                                    |
        | 27    | cicio más joven, por no haberme hecho chequeos médicos   |
        | 28    | cada año, por no haberme terminado los tratamientos para |
      Y el primer objetivo es "cada año, por no haberme terminado los tratamientos para"
      Cuando aplico el primer objetivo al markdown:
        """
        por no haberme hecho chequeos médicos cada año, por no haberme terminado los tratamientos para la artritis.
        """
      Entonces el markdown queda:
        """
        por no haberme hecho chequeos médicos&nbsp;cada año, por no haberme terminado los tratamientos para la artritis.
        """

    Escenario: repeated-first-letter hace lo mismo que last-letter: pega al final de la primera línea
      Dado una incidencia "repeated-first-letter" de la página 20 y la línea 7 con la letra "s" y estas líneas:
        | línea | texto                                                          |
        | 7     | sentado que eso hacían las madres, principalmente, y les        |
        | 8     | salía tan natural como respirar. Descubrí que no, cuando a      |
      Y el primer objetivo es "salía tan natural como respirar. Descubrí que no, cuando a"
      Cuando aplico el primer objetivo al markdown:
        """
        di por sentado que eso hacían las madres, principalmente, y les salía tan natural como respirar. Descubrí que no, cuando a mi papá y a mí nos tocó cuidarnos entre nosotros.
        """
      Entonces el markdown queda:
        """
        di por sentado que eso hacían las madres, principalmente, y les&nbsp;salía tan natural como respirar. Descubrí que no, cuando a mi papá y a mí nos tocó cuidarnos entre nosotros.
        """

    Escenario: Si la unión no se puede pegar, el &nbsp; va al final de la segunda línea
      Dado una incidencia "repeated-first-letter" de la página 40 y la línea 15 con la letra "l" y estas líneas:
        | línea | texto                                                       |
        | 15    | las noches en los primeros meses), mientras manejaba, so-   |
        | 16    | la en mi casa, en la casa de mi pareja, con mi mamá; hasta  |
      Cuando aplico el primer objetivo al markdown:
        """
        casi todas las noches en los primeros&nbsp;meses), mientras manejaba, sola&nbsp;en mi casa, en la casa de mi pareja, con mi mamá; hasta lloré&nbsp;con una consultante.
        """
      Entonces no hay dónde pegarlo
      Y el objetivo que termina en "sola" es "las noches en los primeros meses), mientras manejaba, sola"
      Y el objetivo que termina en "sola" es posterior
      Y el objetivo que termina en "sola" ya está aplicado por detrás en:
        """
        casi todas las noches en los primeros&nbsp;meses), mientras manejaba, sola&nbsp;en mi casa, en la casa de mi pareja, con mi mamá; hasta lloré&nbsp;con una consultante.
        """
      Y el objetivo posterior que termina en "hasta" es "la en mi casa, en la casa de mi pareja, con mi mamá; hasta"
      Cuando aplico el objetivo posterior que termina en "hasta" al markdown:
        """
        casi todas las noches en los primeros&nbsp;meses), mientras manejaba, sola&nbsp;en mi casa, en la casa de mi pareja, con mi mamá; hasta lloré&nbsp;con una consultante.
        """
      Entonces el markdown queda:
        """
        casi todas las noches en los primeros&nbsp;meses), mientras manejaba, sola&nbsp;en mi casa, en la casa de mi pareja, con mi mamá; hasta&nbsp;lloré&nbsp;con una consultante.
        """

    Escenario: Con la palabra cortada aún sin nbsp, el &nbsp; va tras la palabra completa
      Dado una incidencia "repeated-first-letter" de la página 48 y la línea 10 con la letra "p" y estas líneas:
        | línea | texto                                                    |
        | 10    | Porque también se derrumbó mi otra casa, donde se su-     |
        | 11    | pone que iba a respirar. Y aunque llevaba mucho tiempo en |
      Y el objetivo que termina en "supone" es "Porque también se derrumbó mi otra casa, donde se supone"
      Y el objetivo que termina en "supone" es posterior
      Y el objetivo que termina en "supone" no está aplicado por detrás en:
        """
        Porque también se derrumbó mi otra casa, donde se supone que iba a respirar. Y aunque llevaba mucho tiempo en él.
        """
      Cuando aplico el objetivo que termina en "supone" al markdown:
        """
        Porque también se derrumbó mi otra casa, donde se supone que iba a respirar. Y aunque llevaba mucho tiempo en él.
        """
      Entonces el markdown queda:
        """
        Porque también se derrumbó mi otra casa, donde se supone&nbsp;que iba a respirar. Y aunque llevaba mucho tiempo en él.
        """

    Escenario: consecutive-punctuation pone los objetivos donde last-letter
      Dado una incidencia "consecutive-punctuation" de la página 19 y la línea 13 con estas líneas:
        | línea | texto                                                 |
        | 13    | convertí en una adulta y me hice cargo de mí misma.   |
        | 14    |   Mi mamá no fue una mujer muy cariñosa, no se permi- |
      Y una segunda incidencia "repeated-last-letter" de la página 19 y la línea 13 con la letra "a" y estas líneas:
        | línea | texto                                                 |
        | 13    | convertí en una adulta y me hice cargo de mí misma.   |
        | 14    |   Mi mamá no fue una mujer muy cariñosa, no se permi- |
      Entonces los objetivos de las dos incidencias coinciden
      Y el primer objetivo es "convertí en una adulta y me hice cargo de mí misma."
      Y el primer objetivo es posterior
      Y el objetivo "Mi mamá no fue una mujer muy cariñosa, no se permi-" no es el primero
      Y ningún objetivo es "cariñosa, no"
      Y ningún objetivo es "misma. Mi"
      Y la incidencia tiene la continuación "tía las caricias, las palabras tiernas o melosas."
      Entonces el objetivo que termina en "no se permitía" es posterior

  Regla de negocio: El informe ordena las incidencias igual que las correcciones

    Escenario: Ordena last-letter, first-letter y puntuación
      Dado que pdftotext devuelve:
        """
        Ana teje bufandas
        Beto come pan,
        Beto corta cedros,
        Carla canta coplas
        Carlos corta cebras
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 2-3 ;; b ;; 2: Beto come pan, || 3: Beto corta cedros,
        consecutive-punctuation ;; pág 1 ;; líneas 2-3 ;; 2: Beto come pan, || 3: Beto corta cedros,
        repeated-last-letter ;; pág 1 ;; líneas 3-4 ;; s ;; 3: Beto corta cedros, || 4: Carla canta coplas
        repeated-last-letter ;; pág 1 ;; líneas 4-5 ;; s ;; 4: Carla canta coplas || 5: Carlos corta cebras
        repeated-first-letter ;; pág 1 ;; líneas 4-5 ;; c ;; 4: Carla canta coplas || 5: Carlos corta cebras
        """

  Regla de negocio: --ignore guarda incidencias del informe como excepciones

    Escenario: Guarda la incidencia elegida en un archivo nuevo
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        \f
        """
      Cuando parseo el comando "typography --ignore 1 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "1 excepción en .typography-exceptions"
      Y el archivo ".typography-exceptions" contiene "dist/files/libro.pdf"
      Y el archivo ".typography-exceptions" contiene "pág 1  líneas 1-2  consecutive-punctuation"

    Escenario: Al volver a correrlo la incidencia guardada ya no sale y se numera desde uno
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        \f
        """
      Cuando parseo el comando "typography --ignore 1 dist/files/libro.pdf" sobre la raíz del proyecto
      Y parseo el comando "typography dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "#1  pág 1  líneas 2-3  consecutive-punctuation"
      Y el error dice "1 incidencia en 1 PDF"

    Escenario: Sin números guarda todo
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        \f
        """
      Cuando parseo el comando "typography --ignore dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "2 excepciones en .typography-exceptions"

    Escenario: Sin números guarda todo y el informe queda limpio
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        \f
        """
      Cuando parseo el comando "typography --ignore dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "2 excepciones en .typography-exceptions"
      Y parseo el comando "typography dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: Lo agrega al final del grupo del PDF y respeta los otros grupos
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        \f
        """
      Y que el archivo "excepciones.txt" tiene este contenido
        """
        dist/files/otro.pdf
          pág 2  línea 1  single-word-line  Hola.

        """
      Cuando parseo el comando "typography --ignore 1 --exceptions excepciones.txt dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "excepciones.txt" contiene "dist/files/otro.pdf"
      Y el archivo "excepciones.txt" contiene "dist/files/libro.pdf"
      Y el archivo "excepciones.txt" contiene "pág 1  líneas 1-2  consecutive-punctuation"

    Escenario: Un número que no existe lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography --ignore 9 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no existe la incidencia 9"

  Regla de negocio: --exceptions ignora lo que ya está aceptado

    Escenario: Filtra la incidencia con la cabecera tal como la imprime el informe
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        Hola
        \f
        """
      Y que el archivo "excepciones.txt" tiene este contenido
        """
        dist/files/libro.pdf · 1 incidencia
          pág 1  línea 2  single-word-line  Hola
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --exceptions excepciones.txt --rules single-word-line" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: Acepta varios bloques y el resumen del informe
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Volvi a la casa de mis padres un martes
        de enero. Y me quede pensando en las tardes
        \f
        """
      Y que el archivo "excepciones.txt" tiene este contenido
        """
        dist/files/libro.pdf
          pág 1  líneas 1-2  repeated-last-letter
                 1  Volvi a la casa de mis padres un martes
                 2  de enero. Y me quede pensando en las tardes
                 las 2 terminan por 's'

        dist/files/otro.pdf
          pág 3  línea 1  single-word-line  Otro
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --exceptions excepciones.txt --rules repeated-last-letter" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: Sólo filtra cuando el contenido coincide
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        Hola
        \f
        """
      Y que el archivo "excepciones.txt" tiene este contenido
        """
        dist/files/libro.pdf
          pág 1  línea 2  single-word-line  Hola.
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --exceptions excepciones.txt --rules single-word-line" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "single-word-line  Hola"
      Y el error dice "1 incidencia en 1 PDF"

    Escenario: Ignorar la primera ventana de una tirada larga enseña la siguiente
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        siete ocho.
        \f
        """
      Y que el archivo "excepciones.txt" tiene este contenido
        """
        dist/files/libro.pdf
          pág 1  líneas 1-2  consecutive-punctuation
                 1  uno dos.
                 2  tres cuatro.
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --exceptions excepciones.txt --rules consecutive-punctuation" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "2 incidencias"
      Y la salida dice "pág 1  líneas 2-3  consecutive-punctuation"

    Escenario: Encadenar excepciones va enseñando las siguientes ventanas
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Volvi a la casa de mis padres un martes
        de enero. Y me quede pensando en las tardes
        con las cosas que pasan en las casas
        y las que se quedan en las palabras
        \f
        """
      Y que el archivo "excepciones.txt" tiene este contenido
        """
        dist/files/libro.pdf
          pág 1  líneas 1-2  repeated-last-letter
                 1  Volvi a la casa de mis padres un martes
                 2  de enero. Y me quede pensando en las tardes
                 las 2 terminan por 's'

          pág 1  líneas 2-3  repeated-last-letter
                 2  de enero. Y me quede pensando en las tardes
                 3  con las cosas que pasan en las casas
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --exceptions excepciones.txt --rules repeated-last-letter" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "1 incidencia"
      Y la salida dice "pág 1  líneas 3-4  repeated-last-letter"

  Regla de negocio: Con números, --fix corrige nada más las incidencias elegidas

    Escenario: Corrige la incidencia elegida y deja las demás
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Volvi a la casa de mis padres un martes
        de enero. Y me quede pensando en las tardes
        con las cosas que pasan en las casas
        y las que se quedan en las palabras
        \f
        """
      Y que el archivo "libro.md" tiene este contenido
        """
        ---
        title: Libro
        ---
        Volvi a la casa de mis padres un martes de enero. Y me quede pensando en las tardes con las cosas que pasan en las casas y las que se quedan en las palabras.
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --rules repeated-last-letter --fix 2" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "1 corregidas de 1"
      Y el archivo "libro.md" contiene 1 veces "&nbsp;"

    Escenario: --fix con un número que no existe lo dice
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --fix 9" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no existe la incidencia 9"

  Regla de negocio: --fix manda los nombres cortados a la hiphenación

    Escenario: Crea el preamble del proyecto con la palabra completa
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Georgina Paola Grande-
        Arriola escribió este texto.
        \f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --rules hyphenated-proper-noun --fix" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "hyphenated-proper-noun  Grande-Arriola  corregido"
      Y la salida dice "1 corregidas de 1"
      Y el archivo "preamble/15-hyphenation-rules.tex" contiene "GrandeArriola"
      Y el archivo "preamble/15-hyphenation-rules.tex" contiene "Cronos"

    Escenario: Si el proyecto ya tiene el archivo, agrega ahí sin repetir
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Georgina Paola Grande-
        Arriola escribió este texto.
        \f
        """
      Y que el archivo "preamble/15-hyphenation-rules.tex" tiene el contenido "\hyphenation{\n  García\n}\n"
      Cuando parseo el comando "typography dist/files/libro.pdf --rules hyphenated-proper-noun --fix" sobre la raíz del proyecto
      Y parseo el comando "typography dist/files/libro.pdf --rules hyphenated-proper-noun --fix" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el archivo "preamble/15-hyphenation-rules.tex" contiene "García"
      Y el archivo "preamble/15-hyphenation-rules.tex" contiene 1 veces "GrandeArriola"

  Regla de negocio: --fix corrige los markdown de origen

    Escenario: Corrige la unión de dos líneas y lo reporta
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Volvi a la casa de mis padres un martes
        de enero. Y me quede pensando en las tardes
        \f
        """
      Y que el archivo "libro.md" tiene este contenido
        """
        ---
        title: Libro
        ---
        Volvi a la casa de mis padres un martes de enero. Y me quede pensando en las tardes.
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --rules repeated-last-letter --fix" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "repeated-last-letter  corregido"
      Y la salida dice "1 corregidas de 1"
      Y el archivo "libro.md" contiene "un martes&nbsp;de enero"

    Escenario: Sin repositorio git lo dice
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "typography dist/files/libro.pdf --fix" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "typography --fix requiere un repositorio git"

    Escenario: Encuentra el markdown por el slug de la creadora
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto es un repositorio git
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Volvi a la casa de mis padres un martes
        de enero. Y me quede pensando en las tardes
        con las cosas que pasan en las casas
        y las que se quedan en las palabras
        \f
        """
      Y que el archivo "libro.md" tiene este contenido
        """
        ---
        title: Libro
        creator: Pérez & Soto
        ---
        Un texto que no es el que hay que corregir.
        """
      Y que el archivo "perez-y-soto.md" tiene este contenido
        """
        ---
        title: Ensayo
        creator: Pérez & Soto
        ---
        Volvi a la casa de mis padres un martes de enero. Y me quede pensando en las tardes con las cosas que pasan en las casas y las que se quedan en las palabras.
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --rules repeated-last-letter --fix" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "repeated-last-letter  corregido"
      Y el archivo "perez-y-soto.md" contiene "un martes&nbsp;de enero"
