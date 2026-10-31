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
        texto de la pagina cuatro con palabras
        4
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
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

    Escenario: Signos distintos no arman par
      Dado que pdftotext devuelve:
        """
        termina en punto.
        termina en coma,
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: Los puntos sueltos de \ldots cuentan como un punto
      Dado que pdftotext devuelve:
        """
        uno dos,
        tres . . .
        cuatro . . .
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 2-3 ;; 2: tres . . . || 3: cuatro . . .
        """

    Escenario: Los puntos sueltos no arman par con una línea que no termina en signo
      Dado que pdftotext devuelve:
        """
        uno dos
        tres . . .
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: Una línea que no termina en puntuación rompe el par
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro
        cinco seis.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: Una línea vacía rompe el par
      Dado que pdftotext devuelve:
        """
        uno dos.

        tres cuatro.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

    Escenario: Tres líneas seguidas son dos pares
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos. || 2: tres cuatro.
        consecutive-punctuation ;; pág 1 ;; líneas 2-3 ;; 2: tres cuatro. || 3: cinco seis.
        """

  Regla de negocio: Una línea de una sola palabra también juega en el par

    Escenario: Una línea de una palabra cierra un par
      Dado que pdftotext devuelve:
        """
        uno dos.
        Tres.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "single-word-line,consecutive-punctuation"
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos. || 2: Tres.
        single-word-line ;; pág 1 ;; línea 2 ;; Tres.
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
      Cuando escaneo el texto de pdftotext buscando "single-word-line,consecutive-punctuation"
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
      Cuando escaneo el texto de pdftotext buscando "single-word-line,consecutive-punctuation"
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

  Regla de negocio: El comando usa siempre la ventana de dos

    Escenario: Dos renglones con el mismo signo ya son hallazgo
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia larga del documento para la medida
        una linea con muchas palabras aqui.
        a si mismas.
        \f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-3  consecutive-punctuation"

    Escenario: Una tirada larga muestra todos los pares
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia larga del documento para la medida
        una linea con muchas palabras aqui.
        a si mismas.
        y estas dos tambien.
        \f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-3  consecutive-punctuation"
      Y la salida dice "pág 1  líneas 3-4  consecutive-punctuation"

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
      Cuando parseo el comando "typography --rules consecutive-punctuation" sobre la raíz del proyecto
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

  Regla de negocio: Los nombres propios cortados por el guion se reportan

    Escenario: Un nombre propio partido al final de la línea
      Dado que pdftotext devuelve:
        """
        Georgina Paola Grande-
        Arriola escribió este texto.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "hyphenated-proper-noun"
      Entonces las incidencias son:
        """
        hyphenated-proper-noun ;; pág 1 ;; línea 1 ;; Grande-Arriola
        """

    Escenario: Una palabra en minúscula cortada no es un nombre propio
      Dado que pdftotext devuelve:
        """
        y esto termina en-
        algo que sigue.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "hyphenated-proper-noun"
      Entonces no hay incidencias

    Escenario: Una mayúscula que no termina en guion no es un corte
      Dado que pdftotext devuelve:
        """
        Georgina Paola Grande
        Arriola escribió este texto.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "hyphenated-proper-noun"
      Entonces no hay incidencias

    Escenario: Un nombre cortado al final de la página no tiene continuación
      Dado que pdftotext devuelve:
        """
        Georgina Paola Grande-
        \f
        Arriola escribió este texto.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "hyphenated-proper-noun"
      Entonces las incidencias son:
        """
        hyphenated-proper-noun ;; pág 1 ;; línea 1 ;; Grande-
        """

  Regla de negocio: Dos líneas seguidas con la misma letra

    Escenario: Dos líneas que empiezan con la misma letra
      Dado que pdftotext devuelve:
        """
        sobrevivido en este sistema
        sobrevivido en este mundo
        \f
        """
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
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
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: Los signos de apertura no cuentan para la letra
      Dado que pdftotext devuelve:
        """
        © De la edición, María de los Ángeles
        Diseño y formación editorial
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 1-2 ;; d ;; 1: © De la edición, María de los Ángeles || 2: Diseño y formación editorial
        """

    Escenario: Una línea que empieza con un número no tiene letra
      Dado que pdftotext devuelve:
        """
        a consolarme. Con el tiempo dejó de pasar, pero a la edad de
        8 años mi mente colapsó de otra manera. Empecé a creer que el
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "repeated-first-letter"
      Entonces no hay incidencias

    Escenario: Un número entre paréntesis tampoco es una letra inicial
      Dado que pdftotext devuelve:
        """
        a consolarme. Con el tiempo dejó de pasar, pero a la edad de
        (8 años) mi mente colapsó de otra manera.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "repeated-first-letter"
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

  Regla de negocio: Las líneas cortas también cuentan

    Escenario: Un final de párrafo corto arma par con la línea anterior
      Dado que pdftotext devuelve:
        """
        Esta linea es larga y no termina en puntuacion para(setear) la referencia
        Esta linea es larga y termina en puntuacion.
        a si mismas.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 2-3 ;; 2: Esta linea es larga y termina en puntuacion. || 3: a si mismas.
        """

    Escenario: Da igual cuál de las dos sea la corta
      Dado que pdftotext devuelve:
        """
        Esta linea es larga y no termina en puntuacion para(setear) la referencia
        a si mismas.
        Esta linea es larga y termina en puntuacion.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 2-3 ;; 2: a si mismas. || 3: Esta linea es larga y termina en puntuacion.
        """

    Escenario: Una línea que no termina en puntuación sigue cortando el par
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro
        cinco seis.
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "consecutive-punctuation"
      Entonces no hay incidencias

  Regla de negocio: Todas las líneas cuentan, sin importar su longitud

    Escenario: Una línea corta también arma par
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Esta es una linea de referencia del documento para(setear) la medida
        Esta linea es mas corta que la de arriba y se queda al.
        Zybra linea es mas corta que la de arriba y se queda a.
        \f
        """
      Cuando parseo el comando "typography --rules consecutive-punctuation dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-3  consecutive-punctuation"

    Escenario: La última letra de una línea de una palabra también cuenta
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia del documento para medir el ancho
        zeta
        zeta
        zeta
        \f
        """
      Cuando parseo el comando "typography --rules repeated-last-letter dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-3  repeated-last-letter"
      Y la salida dice "pág 1  líneas 3-4  repeated-last-letter"

    Escenario: Las letras se comparan de una en una
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea de referencia del documento para medir el ancho
        zeta del uno
        zorro del dos
        zufre del tres
        \f
        """
      Cuando parseo el comando "typography --rules repeated-first-letter dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 2-3  repeated-first-letter"
      Y la salida dice "pág 1  líneas 3-4  repeated-first-letter"
      Y la salida dice "las 2 empiezan por 'z'"

    Escenario: El informe de letras dice cuántas líneas son
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Es una linea de referencia del documento para medir el ancho
        Esa es la segunda
        Ese es el tercero
        \f
        """
      Cuando parseo el comando "typography --rules repeated-first-letter dist/files/libro.pdf" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y la salida dice "pág 1  líneas 1-2  repeated-first-letter"
      Y la salida dice "pág 1  líneas 2-3  repeated-first-letter"
      Y la salida dice "las 2 empiezan por 'e'"

  Regla de negocio: Los umbrales ya no se pueden mover

    Escenario: El ancho mínimo ya no existe
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras aqui
        \f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --min-line-width 90" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "opción desconocida '--min-line-width'"

    Escenario: Las letras ya no se pueden cambiar
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras aqui
        \f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --min-letters 2" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "opción desconocida '--min-letters'"

    Escenario: La ventana ya no se puede cambiar
      Dado que la raíz del proyecto está vacía
      Y el PDF "dist/files/libro.pdf" con estas páginas:
        """
        Una linea con muchas palabras aqui
        \f
        """
      Cuando parseo el comando "typography dist/files/libro.pdf --min-lines 3" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "opción desconocida '--min-lines'"

  Regla de negocio: La ventana son siempre dos líneas

    Escenario: Dos líneas seguidas con el mismo signo son hallazgo
      Dado que pdftotext devuelve:
        """
        una linea larga con muchas palabras de verdad y punto.
        otra linea larga con muchas palabras tambien y punto.
        una tercera linea larga con palabras de verdad y nada
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        repeated-last-letter ;; pág 1 ;; líneas 1-2 ;; o ;; 1: una linea larga con muchas palabras de verdad y punto. || 2: otra linea larga con muchas palabras tambien y punto.
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: una linea larga con muchas palabras de verdad y punto. || 2: otra linea larga con muchas palabras tambien y punto.
        """

    Escenario: Signos distintos no son repetición
      Dado que pdftotext devuelve:
        """
        una linea larga con muchas palabras de verdad y punto.
        otra linea larga con muchas palabras tambien y coma,
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: Una tirada larga muestra todos los pares
      Dado que pdftotext devuelve:
        """
        uno dos.
        tres cuatro.
        cinco seis.
        siete ocho.
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: uno dos. || 2: tres cuatro.
        consecutive-punctuation ;; pág 1 ;; líneas 2-3 ;; 2: tres cuatro. || 3: cinco seis.
        consecutive-punctuation ;; pág 1 ;; líneas 3-4 ;; 3: cinco seis. || 4: siete ocho.
        """

    Escenario: La ventana no salta de página
      Dado que pdftotext devuelve:
        """
        primera linea larga con palabras y punto.
        \f
        \f
        segunda linea larga con palabras y punto.
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces no hay incidencias

    Escenario: Tres líneas que empiezan igual dan dos pares
      Dado que pdftotext devuelve:
        """
        zeta del uno
        zeta del dos
        zeta del tres
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 1-2 ;; z ;; 1: zeta del uno || 2: zeta del dos
        repeated-last-letter ;; pág 1 ;; líneas 2-3 ;; s ;; 2: zeta del dos || 3: zeta del tres
        repeated-first-letter ;; pág 1 ;; líneas 2-3 ;; z ;; 2: zeta del dos || 3: zeta del tres
        """

    Escenario: Con una letra basta para que dos palabras compartan el arranque
      Dado que pdftotext devuelve:
        """
        zeta del uno
        zorro del dos
        zufre del tres
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        repeated-first-letter ;; pág 1 ;; líneas 1-2 ;; z ;; 1: zeta del uno || 2: zorro del dos
        repeated-last-letter ;; pág 1 ;; líneas 2-3 ;; s ;; 2: zorro del dos || 3: zufre del tres
        repeated-first-letter ;; pág 1 ;; líneas 2-3 ;; z ;; 2: zorro del dos || 3: zufre del tres
        """

    Escenario: Una línea que termina con un número no tiene letra final
      Dado que pdftotext devuelve:
        """
        Ficción (2023).
        Mi tesis de maestría sobre las mujeres en
        \f
        """
      Cuando escaneo el texto de pdftotext buscando "repeated-last-letter"
      Entonces no hay incidencias

    Escenario: Un signo pegado a una letra cuenta como la misma letra
      Dado que pdftotext devuelve:
        """
        algo termina a-
        otra cosa a-
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        repeated-last-letter ;; pág 1 ;; líneas 1-2 ;; a ;; 1: algo termina a- || 2: otra cosa a-
        consecutive-punctuation ;; pág 1 ;; líneas 1-2 ;; 1: algo termina a- || 2: otra cosa a-
        """

    Escenario: Los acentos no cambian la letra
      Dado que pdftotext devuelve:
        """
        algo termina á
        otra cosa a
        \f
        """
      Cuando escaneo el texto de pdftotext
      Entonces las incidencias son:
        """
        repeated-last-letter ;; pág 1 ;; líneas 1-2 ;; a ;; 1: algo termina á || 2: otra cosa a
        """

    Escenario: La ñ no es la n
      Dado que pdftotext devuelve:
        """
        algo termina ñ
        otra cosa n
        \f
        """
      Cuando escaneo el texto de pdftotext
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
      Cuando parseo el comando "typography --rules single-word-line,consecutive-punctuation dist/files/libro.pdf" sobre la raíz del proyecto
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
      Cuando parseo el comando "typography --rules repeated-first-letter dist/files/libro.pdf" sobre la raíz del proyecto
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
      Cuando parseo el comando "typography --json" sobre la raíz del proyecto
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
      Cuando parseo el comando "typography --json" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 0
      Y el JSON del typography declara que todo está bien