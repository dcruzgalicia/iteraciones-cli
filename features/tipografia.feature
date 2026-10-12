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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
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
        """
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; 1984
        """

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
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 2 ;; 7
        single-word-line ;; pág 2 ;; línea 2 ;; 19
        """

    Escenario: Una línea de una palabra en el medio de la página sigue siendo incidencia
      Dado que pdftotext devuelve:
        """
        2
        texto de la pagina con palabras
        Adios
        texto que sigue con palabras
        \f
        3
        texto de la otra pagina con palabras
        \f
        """
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: Una línea con varias palabras no lo es
      Dado que pdftotext devuelve:
        """
        Una línea con dos palabras
        Otra que también tiene dos
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: Los espacios no cuentan como palabras
      Dado que pdftotext devuelve:
        """
             Hola
        Hola    mundo   otra vez
        \f
        """
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: La palabra más larga del documento también cuenta
      Dado que pdftotext devuelve:
        """
        Antidisestablishmentarianism
        \f
        """
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos<signo> ;; 2: tres cuatro<signo>
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
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: termina en punto. ;; 2: termina en coma,
        """

    Escenario: Los puntos sueltos de \ldots cuentan como un punto
      Dado que pdftotext devuelve:
        """
        uno dos,
        tres . . .
        cuatro . . .
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos, ;; 2: tres . . .
        consecutive-punctuation ;; pág 1 ;; líneas 2-3 ;; 2: tres . . . ;; 3: cuatro . . .
        """

    Escenario: Los puntos sueltos no arman par con una línea que no termina en signo
      Dado que pdftotext devuelve:
        """
        uno dos
        tres . . .
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: Una línea que no termina en puntuación rompe el par
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro
        cinco seis.
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: Una línea vacía rompe el par
      Dado que pdftotext devuelve:
        """
        uno dos.

        tres cuatro.
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: Tres líneas seguidas dan dos pares
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos. ;; 2: tres cuatro.
        consecutive-punctuation ;; pág 1 ;; líneas 2-3 ;; 2: tres cuatro. ;; 3: cinco seis.
        """

  Regla de negocio: Una línea de una sola palabra también juega en el par

    Escenario: Una línea de una palabra cierra un par
      Dado que pdftotext devuelve:
        """
        uno dos.
        Tres.
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 2 ;; Tres.
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos. ;; 2: Tres.
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 1 ;; Hola
        consecutive-punctuation ;; pág 2 ;; líneas 2-3 ;; 2: uno dos. ;; 3: tres cuatro.
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        single-word-line ;; pág 2 ;; línea 1 ;; Adios
        """

  Regla de negocio: Las reglas corren sobre el PDF de verdad

    Escenario: Un PDF sin incidencias sale limpio
      Dado que la raíz del proyecto está vacía
      Y el PDF "limpio.pdf" con estas páginas:
        """
        Una linea con varias palabras
        Otra linea con varias palabras
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
      Cuando escaneo el PDF "libro.pdf"
      Entonces las incidencias son:
        """
        single-word-line ;; pág 1 ;; línea 2 ;; Hola
        consecutive-punctuation ;; pág 2 ;; líneas 2-3 ;; 2: uno dos. ;; 3: tres cuatro.
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

  Regla de negocio: El informe dice la regla, la página, la línea y el texto

    Escenario: El comando encuentra un par y sale con código 1
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "dist/files/libro.pdf · 1 incidencia"
      Y la salida dice "pág 1  líneas 2-3  consecutive-punctuation"
      Y la salida dice "2  uno dos."
      Y la salida dice "3  tres cuatro."

    Escenario: Un PDF limpio sale con código 0
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        Otra linea con varias palabras
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

    Escenario: Un PDF que no existe lo dice
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "typography no-existe.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "no-existe.pdf"

    Escenario: --json declara el par con su línea anterior
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        uno dos.
        tres cuatro.
        \f
        """
      Cuando parseo el comando "typography --json" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el JSON del typography es:
        """
        {"ok":false,"files":[{"pdf":"dist/files/libro.pdf","incidences":[{"type":"consecutive-punctuation","page":1,"line":3,"text":"tres cuatro.","previousLine":2,"previousText":"uno dos."}]}]}
        """

    Escenario: --json declara el PDF limpio
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con varias palabras
        Otra linea con varias palabras
        \f
        """
      Cuando parseo el comando "typography --json" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el JSON del typography declara que todo está bien