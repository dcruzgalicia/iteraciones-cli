# language: es
Característica: el analizador tipográfico de los PDF

  Como quien revisa un PDF antes de mandarlo a imprenta
  Quiero que me digan dónde hay una línea de una sola palabra
  Y dónde hay dos líneas seguidas que terminan en puntuación
  Para no buscarlas a ojo

  Los textos de abajo son la salida de pdftotext tal cual: cada línea con \f es un salto de
  página y el último \f cierra el documento.

  Regla de negocio: Una palabra es una secuencia de caracteres no blancos

    Escenario: Una línea con una sola palabra es una incidencia
      Dado que pdftotext devuelve:
        """
        Una línea con varias palabras
        Hola
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 2 ;; Hola
        """

  Regla de negocio: El folio del PDF no es un problema del texto

    Escenario: El folio en el footer no se reporta en ninguna página
      Dado que pdftotext devuelve:
        """
        texto de la pagina uno con palabras
        \f
        texto de la pagina dos con palabras
        2
        \f
        texto de la pagina tres con palabras
        3
        \f
        texto de la pagina cuatro con palabras
        4
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: El folio en el header tampoco se reporta
      Dado que pdftotext devuelve:
        """
        2
        texto de la pagina dos con palabras
        \f
        3
        texto de la pagina tres con palabras
        \f
        4
        texto de la pagina cuatro con palabras
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: Una página sin foliar no impide descartar los folios de las otras
      Dado que pdftotext devuelve:
        """
        Portada
        \f
        texto de la pagina dos con palabras
        2
        \f
        texto de la pagina tres con palabras
        3
        \f
        texto de la pagina cuatro con palabras
        4
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; Portada
        """

    Escenario: Un número suelto en una sola página no se da por folio
      Dado que pdftotext devuelve:
        """
        1984
        texto de la pagina con palabras
        \f
        texto de la otra pagina con palabras
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; 1984
        """

    Escenario: Un folio solo que coincide con su página tampoco se reporta
      Dado que pdftotext devuelve:
        """
        texto de la pagina uno con palabras
        \f
        texto de la pagina dos con palabras
        2
        \f
        texto de la pagina tres con palabras
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: Con numeración que reinicia no se reporta ningún folio
      Dado que pdftotext devuelve:
        """
        texto de la pagina uno con palabras
        1
        \f
        texto de la pagina dos con palabras
        2
        \f
        texto de la pagina tres con palabras
        1
        \f
        texto de la pagina cuatro con palabras
        2
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: Números que no suben de uno en uno no son un folio
      Dado que pdftotext devuelve:
        """
        texto de la pagina uno con palabras
        7
        \f
        texto de la pagina dos con palabras
        19
        \f
        texto de la pagina tres con palabras
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 2 ;; 7
        single-word-line ;; pág 2 ;; línea 2 ;; 19
        """

    Escenario: Una página en blanco no tumbaba el resto de los folios
      Dado que pdftotext devuelve:
        """
        texto de la pagina uno con palabras
        1
        \f
        texto de la pagina dos con palabras
        2
        \f
        texto de la pagina tres con palabras
        3
        \f
        texto de la pagina cuatro con palabras
        4
        \f
        \f
        texto de la pagina seis con palabras
        6
        \f
        texto de la pagina siete con palabras
        7
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces no hay incidencias

    Escenario: Una línea de una palabra en el medio de la página sigue siendo incidencia
      Dado que pdftotext devuelve:
        """
        2
        texto de la pagina con palabras
        Adios
        texto que sigue con palabras
        y una ultima linea cualquiera
        \f
        3
        texto de la otra pagina con palabras
        \f
        4
        texto de la tercera pagina con palabras
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 3 ;; Adios
        """

    Escenario: Una línea con texto y número no es un folio
      Dado que pdftotext devuelve:
        """
        texto de la pagina uno con palabras
        Capitulo 1
        \f
        texto de la pagina dos con palabras
        Capitulo 2
        \f
        texto de la pagina tres con palabras
        Capitulo 3
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces no hay incidencias

    Escenario: Una línea con varias palabras no lo es
      Dado que pdftotext devuelve:
        """
        Una línea con dos palabras
        Otra que también tiene tres
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces no hay incidencias

    Escenario: Los espacios no cuentan como palabras
      Dado que pdftotext devuelve:
        """
             Hola
        Hola    mundo   otra vez
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; Hola
        """

    Escenario: Una línea vacía no es una incidencia
      Dado que pdftotext devuelve:
        """
        Una linea con dos palabras

        Otra linea con dos palabras
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces no hay incidencias

    Escenario: La palabra más larga del documento también cuenta
      Dado que pdftotext devuelve:
        """
        Antidisestablishmentarianism
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; Antidisestablishmentarianism
        """

  Regla de negocio: Dos líneas seguidas que terminan en puntuación son un par

    Esquema del escenario: Dos líneas seguidas que terminan en <signo>
      Dado que pdftotext devuelve:
        """
        uno dos<signo>
        tres cuatro<signo>
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation" sin el filtro de línea corta
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos<signo> || 2: tres cuatro<signo>
        """

      Ejemplos:
        | signo |
        | .     |
        | ,     |
        | -     |
        | –     |
        | —     |
        | ;     |
        | :     |
        | ?     |
        | !     |
        | …     |
        | )     |
        | ]     |
        | }     |
        | "     |
        | '     |
        | »     |
        | ”     |
        | ’     |

    Escenario: Lo que cuenta es el último carácter, no la última palabra
      Dado que pdftotext devuelve:
        """
        termina en punto.
        termina en coma,
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation" sin el filtro de línea corta
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: termina en punto. || 2: termina en coma,
        """

    Escenario: Los puntos sueltos de \ldots cuentan como un punto
      Dado que pdftotext devuelve:
        """
        uno dos,
        tres . . .
        cuatro . . .
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation" sin el filtro de línea corta
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 de 3 ;; 1: uno dos, || 2: tres . . .
        """

    Escenario: Los puntos sueltos no arman par con una línea que no termina en signo
      Dado que pdftotext devuelve:
        """
        uno dos
        tres . . .
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation" sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: Una línea que no termina en puntuación rompe el par
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro
        cinco seis.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation" sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: Una línea vacía rompe el par
      Dado que pdftotext devuelve:
        """
        uno dos.

        tres cuatro.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation" sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: Tres líneas seguidas son un solo hallazgo, no dos pares
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation" sin el filtro de línea corta
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 de 3 ;; 1: uno dos. || 2: tres cuatro.
        """

  Regla de negocio: Una línea de una sola palabra también juega en el par

    Escenario: Una línea de una palabra cierra un par
      Dado que pdftotext devuelve:
        """
        uno dos.
        Tres.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line,consecutive-punctuation" sin el filtro de línea corta
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 2 ;; Tres.
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos. || 2: Tres.
        """

  Regla de negocio: El final de página corta la consecutividad

    Escenario: La última línea de una página no se junta con la primera de la otra
      Dado que pdftotext devuelve:
        """
        uno dos.
        \f
        tres cuatro.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: El número de línea reinicia en cada página
      Dado que pdftotext devuelve:
        """
        Hola
        segunda pagina.
        \f
        Adios
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line,consecutive-punctuation" sin el filtro de línea corta
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; Hola
        single-word-line ;; pág 2 ;; línea 1 ;; Adios
        """

    Escenario: Un par dentro de la segunda página lleva su número de página
      Dado que pdftotext devuelve:
        """
        Hola
        \f
        una linea
        uno dos.
        tres cuatro.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line,consecutive-punctuation" sin el filtro de línea corta
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; Hola
        consecutive-punctuation ;; pág 2 ;; líneas 2-3 ;; 2: uno dos. || 3: tres cuatro.
        """

    Escenario: Una página en blanco no borra la numeración de la siguiente
      Dado que pdftotext devuelve:
        """
        Hola
        \f
        \f
        Adios
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; Hola
        single-word-line ;; pág 3 ;; línea 1 ;; Adios
        """

    Escenario: Una salida sin el salto final no pierde la última página
      Dado que pdftotext devuelve una salida sin el salto final:
        """
        Primera pagina con dos palabras.
        \f
        Adios
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line"
      Entonces las incidencias son:
        """
        single-word-line ;; pág 2 ;; línea 1 ;; Adios
        """

  Regla de negocio: Las reglas corren sobre el PDF de verdad

    Escenario: Un PDF sin incidencias sale limpio
      Dado que la raíz del proyecto está vacía
      Y el PDF "limpio.pdf" con estas páginas:
        """
        Una linea con muchas palabras
        Otra linea con bastante texto
        \f
        """
      Cuando escaneo el PDF "limpio.pdf"
      Entonces no hay incidencias

    Escenario: Un PDF real reporta la página y la línea
      Dado que la raíz del proyecto está vacía
      Y el PDF "libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        Hola
        \f
        una linea
        uno dos.
        tres cuatro.
        \f
        """
      Cuando escaneo el PDF "libro.pdf" buscando "single-word-line,consecutive-punctuation"
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 2 ;; Hola
        consecutive-punctuation ;; pág 2 ;; líneas 2-3 ;; 2: uno dos. || 3: tres cuatro.
        """

    Escenario: Un archivo que no existe falla con lo que dijo Poppler
      Dado que la raíz del proyecto está vacía
      Cuando escaneo el PDF "no-existe.pdf"
      Entonces el escaneo falla con "BuildError" diciendo "no-existe.pdf"

    Escenario: Un archivo que no es PDF falla con lo que dijo Poppler
      Dado que la raíz del proyecto está vacía
      Y un archivo que no es PDF llamado "no-un-pdf.txt"
      Cuando escaneo el PDF "no-un-pdf.txt"
      Entonces el escaneo falla con "BuildError" diciendo "pdftotext no pudo leer"

    Escenario: Sin poppler el error dice qué le falta
      Dado que la raíz del proyecto está vacía
      Y el PDF "limpio.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        """
      Cuando corro el binario sin pdftotext en el PATH para "typography limpio.pdf"
      Entonces el comando termina con el código de salida 1
      Y el error dice "Instala poppler"

  Regla de negocio: El comando usa la ventana de tres por defecto

    Escenario: Dos renglones puntuados no bastan para el comando
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia larga del documento para la medida
        una linea con muchas palabras aqui.
        a si mismas.
        \\f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation --min-line-width 0 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias"

    Escenario: Con tres sí, y bajando la ventana vuelven los dos
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia larga del documento para la medida
        una linea con muchas palabras aqui.
        a si mismas.
        y estas dos tambien.
        \\f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation --min-line-width 0 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-4  consecutive-punctuation"

    Escenario: Con ventana de dos los dos renglones vuelven a salir
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia larga del documento para la medida
        una linea con muchas palabras aqui.
        a si mismas.
        \\f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation --min-line-width 0 --min-lines 2 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-3  consecutive-punctuation"

  Regla de negocio: El informe dice la regla, la página, la línea y el texto

    Escenario: El comando encuentra un par y sale con código 1
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Texto normal de la pagina
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation --min-lines 2 --min-letters 1 --min-line-width 0" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "dist/files/libro.pdf · 1 incidencia"
      Y la salida dice "pág 1  líneas 2-3  consecutive-punctuation"
      Y la salida dice "2  uno dos."
      Y la salida dice "3  tres cuatro."

    Escenario: Un PDF limpio sale con código 0
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras
        Otra linea con bastante texto
        \f
        """
      Cuando parseo el comando "typography" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: Sin PDFs en la salida lo dice
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "typography" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no hay PDFs en dist/files"

  Regla de negocio: Dos líneas seguidas con la misma letra

    Escenario: Dos líneas que empiezan con la misma letra
      Dado que pdftotext devuelve:
        """
        sobrevivido en este sistema
        sobrevivido en este mundo
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 1-2 ;; s ;; 1: sobrevivido en este sistema || 2: sobrevivido en este mundo
        """

    Escenario: Dos líneas que terminan con la misma letra
      Dado que pdftotext devuelve:
        """
        una linea que acaba en esa
        otra linea que acaba en esta
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces las incidencias son:
        """
        repeated-last-letter ;; pág 1 ;; líneas 1-2 ;; a ;; 1: una linea que acaba en esa || 2: otra linea que acaba en esta
        """

    Escenario: Las mayúsculas y los acentos no hacen diferencia
      Dado que pdftotext devuelve:
        """
        Jardín pequeña
        jardín grande
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 1-2 ;; j ;; 1: Jardín pequeña || 2: jardín grande
        """

    Escenario: La primera letra se compara aunque la última línea sea corta
      Dado que pdftotext devuelve:
        """
        Una línea larga de referencia que ocupa todo el ancho de la página
        sobrevivido en este sistema que violenta tanto
        sobrevivido en este mundo
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "repeated-first-letter"
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 2-3 ;; s ;; 2: sobrevivido en este sistema que violenta tanto || 3: sobrevivido en este mundo
        """

    Escenario: La ñ no es la n: una línea que empieza con ñ no repite una n
      Dado que pdftotext devuelve:
        """
        No fue mi culpa que alguien haya elegido hacerme da-
        ño. No fue mi culpa que alguien decidiera tratarme mal. No fue
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "repeated-first-letter"
      Entonces no hay incidencias

    Escenario: Dos líneas que empiezan con ñ sí se repiten
      Dado que pdftotext devuelve:
        """
        ñandú grande y hermoso
        ñoño parece el texto
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "repeated-first-letter"
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 1-2 ;; ñ ;; 1: ñandú grande y hermoso || 2: ñoño parece el texto
        """

    Escenario: Letras distintas no son hallazgo
      Dado que pdftotext devuelve:
        """
        una linea que empieza por aqui
        otra que empieza por alla
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: Lo que no es letra se salta
      Dado que pdftotext devuelve:
        """
        © De la edición, María de los Ángeles
        Diseño y formación editorial
        \f
        """
      Cuando escaneo el texto de pdftotext sin el filtro de línea corta
      Entonces no hay incidencias

    Escenario: Una línea de puros números no tiene letra
      Dado que pdftotext devuelve:
        """
        una linea normal que empieza por aqui
        1984
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "repeated-first-letter,repeated-last-letter"
      Entonces no hay incidencias

    Escenario: La última línea de una página no se junta con la primera de la otra
      Dado que pdftotext devuelve:
        """
        zeta del uno
        beta del uno
        \f
        beta del dos
        alfa del dos
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "repeated-first-letter"
      Entonces no hay incidencias

  Regla de negocio: Una línea muy corta no cuenta como par

    Escenario: Un final de parrafo corto pegado al principio del siguiente no es hallazgo
      Dado que pdftotext devuelve:
        """
        Esta linea es larga y no termina en puntuacion para(setear) la referencia
        Esta linea es larga y no termina en puntuacion para(setear) la referencia
        Esta linea es larga y no termina en puntuacion para(setear) la referencia
        a si mismas.
        Esta linea es larga y termina en puntuacion.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: Da igual cual de las dos sea la corta
      Dado que pdftotext devuelve:
        """
        Esta linea es larga y no termina en puntuacion para(setear) la referencia
        Esta linea es larga y no termina en puntuacion para(setear) la referencia
        Esta linea es larga y no termina en puntuacion para(setear) la referencia
        Esta linea es larga y termina en puntuacion.
        a si mismas.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: Dos lineas largas seguidas que terminan en puntuacion si son hallazgo
      Dado que pdftotext devuelve:
        """
        Esta es una linea de referencia del documento para(setear) la medida
        Esta es una linea de referencia del documento para(setear) la medida
        Esta es una linea de referencia del documento para(setear) la medida
        Esta es una linea de referencia del documento para(setear) la medid.
        Esta es una linea de referencia del documento para(setear) la medid.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 4-5 ;; 4: Esta es una linea de referencia del documento para(setear) la medid. || 5: Esta es una linea de referencia del documento para(setear) la medid.
        """

    Escenario: El maximo de media y mediana deja fuera lo que la media dejaria dentro
      Dado que pdftotext devuelve:
        """
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        corto corto c
        corto corto c
        corto corto c
        corto corto c
        corto corto c
        Una linea de longitud intermedia Una lin.
        Esta es una linea de referencia bastante larga para el documento Est.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: La moda manda cuando la mediana se queda corta
      Dado que pdftotext devuelve:
        """
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        Esta es una linea de referencia bastante larga para el documento Est
        corto corto c
        corto corto c
        corto corto c
        corto corto c
        corto corto c
        corto corto c
        Una linea de longitud algo mayor Una linea de.
        Esta es una linea de referencia bastante larga para el documento Est.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: Una linea desmedida no manda si ningun ancho se repite
      Dado que pdftotext devuelve:
        """
        palabra pa
        palabra palabra pala
        palabra palabra palabra palabr
        palabra palabra palabra palabra palabra palabra palabra palabra palab.
        palabra palabra palabra palabra palabra palabra palabra palabra palabra pa.
        palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 4-5 ;; 4: palabra palabra palabra palabra palabra palabra palabra palabra palab. || 5: palabra palabra palabra palabra palabra palabra palabra palabra palabra pa.
        """

  Regla de negocio: El umbral de línea corta se puede mover

    Escenario: Por defecto sólo cuenta una línea que llega al ancho
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Esta es una linea de referencia del documento para(setear) la medida
        Esta es una linea de referencia del documento para(setear) la medida
        Esta es una linea de referencia del documento para(setear) la medida
        Esta es una linea de referencia del documento para(setear) la medid.
        Esta es una linea de referencia del documento para(setear) la medid.
        \f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation --min-lines 2 --min-letters 1 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 4-5  consecutive-punctuation"

    Escenario: Con el umbral por defecto (75) esa línea algo corta también sale
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Esta es una linea de referencia del documento para(setear) la medida
        Zeta es una linea de referencia del documento para(setear) el borde
        Media es una linea de referencia del documento para(setear) un texto
        Nueva es una linea de referencia del documento para(setear) el lugar
        Esta linea es mas corta que la de arriba y se queda al.
        Zybra linea es mas corta que la de arriba y se queda a.
        \f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation --min-lines 2 --min-letters 1 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 5-6  consecutive-punctuation"

    Escenario: Con el umbral al 100 esa misma línea se considera corta
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Esta es una linea de referencia del documento para(setear) la medida
        Zeta es una linea de referencia del documento para(setear) el borde
        Media es una linea de referencia del documento para(setear) un texto
        Nueva es una linea de referencia del documento para(setear) el lugar
        Esta linea es mas corta que la de arriba y se queda al.
        Zybra linea es mas corta que la de arriba y se queda a.
        \f
        """
      Cuando parseo el comando "typography --min-lines 2 --min-letters 1 dist/files/libro.pdf --min-line-width 100" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: Con el umbral al 90 la misma línea se considera corta
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Esta es una linea de referencia del documento para(setear) su medida
        Zeta es una linea de referencia del documento para(setear) el borde
        Media es una linea de referencia del documento para(setear) el texto
        Nueva es una linea de referencia del documento para(setear) su lugar
        Alfa tiene una longitud media y si termina en puntuacion.
        Beta tiene una longitud media y tambien cierra con puntuacion.
        \f
        """
      Cuando parseo el comando "typography --min-lines 2 --min-letters 1 dist/files/libro.pdf --min-line-width 90" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: Con el umbral a 0 la regla se apaga
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras aqui.
        a si mismas.
        Otra linea con muchas palabras tambien.
        \f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation --min-lines 2 --min-letters 1 --min-line-width 0" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 1-2 de 3  consecutive-punctuation"

    Escenario: Un porcentaje que no es un porcentaje lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras aqui
        \f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --min-line-width 120" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no es un porcentaje entero entre 0 y 100"

    Escenario: Por defecto se comparan dos letras del borde, no una
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia del documento para medir el ancho
        zeta del uno
        zorro del dos
        zufre del tres
        \\f
        """
      Cuando parseo el comando "typography --rules repeated-first-letter --min-line-width 0 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias"

    Escenario: Con una sola letra esas tres sí salen
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia del documento para medir el ancho
        zeta del uno
        zorro del dos
        zufre del tres
        \\f
        """
      Cuando parseo el comando "typography --rules repeated-first-letter --min-line-width 0 --min-letters 1 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-4  repeated-first-letter"

    Escenario: El ancho mínimo no aparta la primera letra
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia del documento para medir el ancho
        zeta
        zeta
        zeta
        \f
        """
      Cuando parseo el comando "typography --rules repeated-first-letter --min-lines 3 --min-letters 2 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-4  repeated-first-letter"

    Escenario: El ancho mínimo sí aparta la última letra
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia del documento para medir el ancho
        zeta
        zeta
        zeta
        \f
        """
      Cuando parseo el comando "typography --rules repeated-last-letter --min-lines 3 --min-letters 2 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias"

    Escenario: Bajando el ancho mínimo la última letra sí sale
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia del documento para medir el ancho
        zeta
        zeta
        zeta
        \f
        """
      Cuando parseo el comando "typography --rules repeated-last-letter --min-lines 3 --min-letters 2 --min-line-width 0 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-4  repeated-last-letter"

    Escenario: El informe de letras dice cuántas líneas son
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Es una linea de referencia del documento para medir el ancho
        Esa es la segunda
        Ese es el tercero
        \\f
        """
      Cuando parseo el comando "typography --rules repeated-first-letter --min-line-width 0 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 1-3  repeated-first-letter"
      Y la salida dice "las 3 empiezan por 'es'"

    Escenario: Una ventana de menos de dos líneas lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras aqui
        \\f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --min-lines 1" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "--min-lines \"1\" no es un entero de 2 en adelante"

    Escenario: Una ventana que no es un número lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras aqui
        \\f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --min-lines dos" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "--min-lines \"dos\" no es un entero de 2 en adelante"

    Escenario: Cero letras lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras aqui
        \\f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --min-letters 0" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "--min-letters \"0\" no es un entero de 1 en adelante"

  Regla de negocio: La ventana por defecto son tres líneas

    Escenario: Dos líneas seguidas ya no son hallazgo por defecto
      Dado que pdftotext devuelve:
        """
        una linea larga con muchas palabras de verdad y punto.
        otra linea larga con muchas palabras tambien. y coma,
        una tercera linea larga con palabras de verdad y nada
        \f
        """
      Cuando escaneo el texto de pdftotext con 3 lineas y 1 letras
      Entonces no hay incidencias

    Escenario: Tres líneas seguidas sí son hallazgo
      Dado que pdftotext devuelve:
        """
        una linea larga con muchas palabras de verdad y punto.
        otra linea larga con muchas palabras tambien. y coma,
        una tercera linea larga con palabras de verdad y punto.
        \f
        """
      Cuando escaneo el texto de pdftotext con 3 lineas y 1 letras
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-3 ;; 1: una linea larga con muchas palabras de verdad y punto. || 2: otra linea larga con muchas palabras tambien. y coma, || 3: una tercera linea larga con palabras de verdad y punto.
        """

    Escenario: Una tirada más larga que la ventana cuenta una vez
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        siete ocho.
        \f
        """
      Cuando escaneo el texto de pdftotext con 2 lineas y 1 letras
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 de 4 ;; 1: uno dos. || 2: tres cuatro.
        """

    Escenario: La ventana no salta de página
      Dado que pdftotext devuelve:
        """
        primera linea larga con palabras y punto
        \f
        \f
        segunda linea larga con palabras y punto
        tercera linea larga con palabras y punto
        \f
        """
      Cuando escaneo el texto de pdftotext con 3 lineas y 1 letras
      Entonces no hay incidencias

    Escenario: Con dos letras hacen falta tres que empiecen igual
      Dado que pdftotext devuelve:
        """
        zeta del uno
        zeta del dos
        zeta del tres
        \f
        """
      Cuando escaneo el texto de pdftotext con 3 lineas y 2 letras
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 1-3 ;; ze ;; 1: zeta del uno || 2: zeta del dos || 3: zeta del tres
        """

    Escenario: Con dos letras dos palabras que sólo comparten la inicial ya no salen
      Dado que pdftotext devuelve:
        """
        zeta del uno
        zorro del dos
        zufre del tres
        \f
        """
      Cuando escaneo el texto de pdftotext con 3 lineas y 2 letras
      Entonces no hay incidencias

  Regla de negocio: Se puede pedir sólo algunas reglas

    Escenario: Una sola regla deja el informe con esa regla y nada más
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea normal con varias palabras
        Hola
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography --rules single-word-line dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "1 incidencia"
      Y la salida dice "single-word-line"

    Escenario: Varias reglas separadas por coma
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea normal con varias palabras
        Hola
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography --min-lines 2 --min-letters 1 --rules single-word-line,consecutive-punctuation --min-line-width 0 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "2 incidencias"
      Y la salida dice "consecutive-punctuation"

    Escenario: Una regla que no existe dice cuáles hay
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea normal con varias palabras
        \f
        """
      Cuando parseo el comando "typography --rules mbox dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no existe la regla \"mbox\""
      Y el error dice "single-word-line, repeated-last-letter, repeated-first-letter, consecutive-punctuation"

    Escenario: Una lista sin reglas lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea normal con varias palabras
        \f
        """
      Cuando parseo el comando "typography --rules , dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no trae ninguna regla"

    Escenario: Pedir una sola regla de letras deja fuera las otras
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Zeta es una linea normal con palabras
        Zorro tiene otra linea con palabras
        otra linea normal con palabras
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography --min-lines 2 --min-letters 1 --rules repeated-first-letter --min-line-width 0 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "1 incidencia"
      Y la salida dice "repeated-first-letter"

  Regla de negocio: Un rango de páginas limita el informe y no renumera

    Escenario: Una página sola, el informe sigue dando la página del PDF
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        Otra linea con varias palabras
        \f
        Adios
        \f
        Ultima linea con palabras
        \f
        """
      Cuando parseo el comando "typography --pages 3 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 3  línea 1  single-word-line"

    Escenario: El rango incluye las dos puntas
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        Adios
        \f
        Bien
        \f
        Otra linea con palabras
        \f
        Final
        \f
        """
      Cuando parseo el comando "typography --pages 2-3 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "2 incidencias"
      Y la salida dice "pág 2  línea 1  single-word-line  Adios"
      Y la salida dice "pág 3  línea 1  single-word-line  Bien"

    Escenario: Una lista de páginas revisa sólo esas
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno
        \f
        dos
        \f
        tres
        \f
        cuatro
        \f
        """
      Cuando parseo el comando "typography --pages 2,4" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 2  línea 1  single-word-line"
      Y la salida dice "pág 4  línea 1  single-word-line"
      Y la salida no dice "pág 1  línea 1"
      Y la salida no dice "pág 3  línea 1"

    Escenario: La lista mezcla páginas sueltas y rangos
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        uno
        \f
        dos
        \f
        tres
        \f
        cuatro
        \f
        """
      Cuando parseo el comando "typography --pages 1-2,4" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  línea 1  single-word-line"
      Y la salida dice "pág 2  línea 1  single-word-line"
      Y la salida dice "pág 4  línea 1  single-word-line"
      Y la salida no dice "pág 3  línea 1"

    Escenario: Una lista con un hueco lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        una linea con palabras de sobra
        \f
        """
      Cuando parseo el comando "typography --pages 3,,4 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "tiene un hueco"

    Escenario: Un rango al revés lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        """
      Cuando parseo el comando "typography --pages 4-2 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "el rango 4-2 va al revés"

    Escenario: Una página sola sólo revisa esa página
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        Adios
        \f
        """
      Cuando parseo el comando "typography --pages 1 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: Un rango de una sola página no es un rango
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        """
      Cuando parseo el comando "typography --pages 11-11 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "el rango 11-11 no es un rango"

    Escenario: Un rango sin la página final lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        """
      Cuando parseo el comando "typography --pages 11- dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no tiene página final"

    Escenario: Tres números no son un rango
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        """
      Cuando parseo el comando "typography --pages 1-2-3 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no se entiende"

    Escenario: Un rango que se sale del PDF lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        """
      Cuando parseo el comando "typography --pages 40-60 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "el rango 40-60 se sale del PDF"
      Y el error dice "el documento tiene 1 página"

    Escenario: Una página que se sale del PDF lo dice
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        """
      Cuando parseo el comando "typography --pages 40 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "la página 40 se sale del PDF"

    Escenario: Un rango sin ruta revisa todos los PDF de la salida
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        \f
        Otra linea con palabras
        \f
        Adios
        \f
        """
      Cuando parseo el comando "typography --pages 3" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 3  línea 1  single-word-line"

    Escenario: Una página sola tampoco reporta su folio
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        texto de la pagina uno con palabras
        \f
        texto de la pagina dos con palabras
        2
        \f
        texto de la pagina tres con palabras
        \f
        """
      Cuando parseo el comando "typography --pages 2 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: El ancho de referencia es el del documento, no el del rango
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Los libros se componen con lineas de texto largo
        Los libros se componen con lineas de texto largo
        \f
        otra linea corta que cierra.
        otra linea corta que cierra.
        \f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation --min-lines 2 --pages 2 dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y la salida dice "sin incidencias en 1 PDF"

    Escenario: Un PDF que no existe lo dice
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "typography no-existe.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no-existe.pdf"

    Escenario: --json declara la tirada con todas sus líneas
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Texto normal de la pagina
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography --min-lines 2 --min-letters 1 --json --min-line-width 0" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el JSON del typography es:
        """
        {"ok":false,"files":[{"pdf":"dist/files/libro.pdf","incidences":[{"type":"consecutive-punctuation","page":1,"line":2,"text":"uno dos.","lineas":[{"line":2,"text":"uno dos."},{"line":3,"text":"tres cuatro."}],"total":2}]}]}
        """

    Escenario: --json declara el PDF limpio
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras
        Otra linea con bastante texto
        \f
        """
      Cuando parseo el comando "typography --min-lines 2 --min-letters 1 --json --min-line-width 0" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el JSON del typography declara que todo está bien