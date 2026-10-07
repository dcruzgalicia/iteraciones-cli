# language: es
Característica: qué se recompila y qué no

  Como quien edita un párrafo de un libro de doscientos capítulos
  Quiero que el build sólo rehaga ese capítulo
  Para no esperar diez minutos por un cambio de tres líneas

  Regla de negocio: Sin cambios ni invalidaciones no hay trabajo

    Escenario: Un build que no tiene nada que rehacer
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "latex"
      Y el build está invalidated por nada
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      Entonces no hay nada que hacer
      Y los documentos a recompilar son ""
      Y el conjunto de export para "print" son ""

    Escenario: Un documento modificado entra en el trabajo
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "latex"
      Y el build está invalidated por nada
      Y cambiaron estos documentos "a.md"
      Cuando calculo qué hay que recompilar
      Entonces sí hay algo que hacer
      Y los documentos a recompilar son "a.md"
      Y el conjunto de export para "print" son "a.md"

  Regla de negocio: Cambiar un filtro re-renderiza todo

    Escenario: Un filtro nuevo manda a todos los documentos al render
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "latex"
      Y el build está invalidated por "filtros"
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      Entonces sí hay algo que hacer
      Y el conjunto de export para "print" son "a.md, b.md, c.md"

  Regla de negocio: Cambiar la bibliografía sólo re-exporta

    Escenario: Una bibliografía nueva no toca el render
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "pdf, latex, html, epub, markdown"
      Y el build está invalidated por "bibliografia"
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      Entonces los documentos a recompilar son ""
      Y el conjunto de export para "print" son "a.md, b.md, c.md"
      Y el conjunto de export para "html" son "a.md, b.md, c.md"
      Y el conjunto de export para "epub" son "a.md, b.md, c.md"
      Y el conjunto de export para "markdown" son "a.md, b.md, c.md"

    Escenario: Una bibliografía nueva sin formatos activos no da trabajo
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son ""
      Y el build está invalidated por "bibliografia"
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      Entonces no hay nada que hacer

    Escenario: Un formato nuevo lleva todos los documentos a su conjunto
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "latex"
      Y el formato "pdf" está activo
      Y el formato "pdf" se acaba de pedir
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      Entonces sí hay algo que hacer
      Y el conjunto de export para "print" son "a.md, b.md, c.md"

    Escenario: Con todos los formatos, cada conjunto recibe todo
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "pdf, latex, html, epub, markdown"
      Y todos los formatos se acaban de pedir
      Y cambiaron estos documentos "b.md"
      Cuando calculo qué hay que recompilar
      Entonces el conjunto de export para "html" son "a.md, b.md, c.md"
      Y el conjunto de export para "markdown" son "a.md, b.md, c.md"

  Regla de negocio: La config decide los formatos y sus flags

    Escenario: La config enciende LaTeX y HTML
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la configuración:
        """
        format:<br>  latex:<br>    generate: true<br>  html:<br>    generate: true<br>
        """
      Y no hay builds anteriores
      Cuando calculo la metadata del build
      Entonces los formatos del build son "html, latex"
      Y el proyecto pide LaTeX
      Y el proyecto necesita CSS
      Y los formatos nuevos son ""
      Y los formatos que se fueron son ""

    Escenario: Sin build anterior no se invalida nada
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la configuración:
        """
        sinNada=<br>
        """
      Y no hay builds anteriores
      Cuando calculo la metadata del build
      Entonces nada está invalidated

    Escenario: Los formatos se comparan contra el build anterior
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la configuración:
        """
        format:<br>  latex:<br>    generate: true<br>  html:<br>    generate: true<br>
        """
      Y un build anterior con los formatos "latex, pdf"
      Cuando calculo la metadata del build
      Entonces los formatos del build son "html, latex"
      Y los formatos nuevos son "html"
      Y los formatos que se fueron son "pdf"