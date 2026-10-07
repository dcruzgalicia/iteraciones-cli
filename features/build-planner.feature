# language: es
Característica: qué se recompila y qué no

  Como quien edita un párrafo de un libro de doscientos capítulos
  Quiero que el build sólo rehaga ese capítulo
  Para no esperar diez minutos por un cambio de tres líneas

  # Tramo 43 de la migración. 11 de los 11 casos de `build-planner.test.ts`. El
  # archivo queda cerrado.

  # La pregunta del build incremental es qué documento hay que volver a compilar,
  # y la respuesta tiene que ser MÁS ESTRECHA que "todo". Rehacer los tres
  # documentos porque cambió uno es lo que hace que el build incremental no
  # sirva de nada.

  Regla de negocio: Sin cambios ni invalidaciones no hay trabajo

    Escenario: Un build que no tiene nada que rehacer
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "latex"
      Y el build está invalidated por nada
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      # El caso más común de un rebuild: todo igual, no se toca nada.
      Entonces no hay nada que hacer
      Y los documentos a recompilar son ""
      Y el conjunto de export para "print" son ""

    # Un documento cambió: se re-renderiza él y se re-exporta en los formatos
    # activos. Nada más.
    Escenario: Un documento modificado entra en el trabajo
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "latex"
      Y el build está invalidated por nada
      Y cambiaron estos documentos "a.md"
      Cuando calculo qué hay que recompilar
      # Sólo `a.md`: los otros dos siguen intactos.
      Entonces sí hay algo que hacer
      Y los documentos a recompilar son "a.md"
      Y el conjunto de export para "print" son "a.md"

  # --- Tramo 43: los tres motivos de invalidación ---

  # Tres formas de invalidar, tres alcances distintos. El segundo y el tercero
  # son INVERSES entre sí, y por eso merecen un escenario cada uno.

  Regla de negocio: Cambiar un filtro re-renderiza todo

    # El resultado de cada documento depende de los filtros, así que no hay
    # forma de saber qué cambió sin rehacerlo todo.

    Escenario: Un filtro nuevo manda a todos los documentos al render
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "latex"
      Y el build está invalidated por "filtros"
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      # Ni un documento cambió y aun así hay que rehacer los tres.
      Entonces sí hay algo que hacer
      Y el conjunto de export para "print" son "a.md, b.md, c.md"

  Regla de negocio: Cambiar la bibliografía sólo re-exporta

    # El inverso del anterior: las citas se resuelven en el EXPORT, no en el
    # render. Re-renderizar por una referencia nueva sería gastar el trabajo más
    # caro del build para cambiar dos números de página.

    Escenario: Una bibliografía nueva no toca el render
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "pdf, latex, html, epub, markdown"
      Y el build está invalidated por "bibliografia"
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      # Nadie se re-renderiza: sólo se re-exporta lo que ya estaba compilado, y
      # a CADA formato activo.
      Entonces los documentos a recompilar son ""
      Y el conjunto de export para "print" son "a.md, b.md, c.md"
      Y el conjunto de export para "html" son "a.md, b.md, c.md"
      Y el conjunto de export para "epub" son "a.md, b.md, c.md"
      Y el conjunto de export para "markdown" son "a.md, b.md, c.md"

    # Sin formatos activos no hay a qué exportar: la invalidación se pierde.
    Escenario: Una bibliografía nueva sin formatos activos no da trabajo
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son ""
      Y el build está invalidated por "bibliografia"
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      # Exportar a ningún lado es no hacer nada.
      Entonces no hay nada que hacer

    # Un formato que se acaba de pedir recibe todos los documentos en su
    # conjunto, pero no obliga a re-renderizar: el LaTeX no ha cambiado.
    Escenario: Un formato nuevo lleva todos los documentos a su conjunto
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "latex"
      Y el formato "pdf" está activo
      Y el formato "pdf" se acaba de pedir
      Y no cambió ningún documento
      Cuando calculo qué hay que recompilar
      # Sin re-render: el PDF sale del LaTeX que ya estaba.
      Entonces sí hay algo que hacer
      Y el conjunto de export para "print" son "a.md, b.md, c.md"

    # Todos los formatos activos: los documentos van a cada conjunto, una vez
    # cada uno.
    # Con todos los formatos invalidados, cada conjunto recibe los tres. Y el
    # `b.md` que además cambió se re-renderiza: son dos razones distintas.
    Escenario: Con todos los formatos, cada conjunto recibe todo
      Dado que la raíz del proyecto está vacía
      Y tres documentos
      Y los formatos activos son "pdf, latex, html, epub, markdown"
      Y todos los formatos se acaban de pedir
      Y cambiaron estos documentos "b.md"
      Cuando calculo qué hay que recompilar
      Entonces el conjunto de export para "html" son "a.md, b.md, c.md"
      Y el conjunto de export para "markdown" son "a.md, b.md, c.md"

  # --- Tramo 43: la metadata, que sale de la config y del estado anterior ---

  Regla de negocio: La config decide los formatos y sus flags

    Escenario: La config enciende LaTeX y HTML
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la configuración:
        """
        format:<br>  latex:<br>    generate: true<br>  html:<br>    generate: true<br>
        """
      Y no hay builds anteriores
      Cuando calculo la metadata del build
      # Sin build anterior no hay formatos nuevos ni que se fueron: no hay con
      # qué comparar.
      Entonces los formatos del build son "html, latex"
      Y el proyecto pide LaTeX
      Y el proyecto necesita CSS
      Y los formatos nuevos son ""
      Y los formatos que se fueron son ""

    # Sin estado previo, NADA se considera invalidado: no hay contra qué
    # comparar y un build "limpio" assumptions inventario de filtros nuevos.
    Escenario: Sin build anterior no se invalida nada
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la configuración:
        """
        sinNada=<br>
        """
      Y no hay builds anteriores
      Cuando calculo la metadata del build
      # El primer build de un proyecto no invalida nada: lo construye todo.
      Entonces nada está invalidated

    # El estado anterior es lo que convierte el build en incremental: compara
    # los formatos de entonces con los de ahora.
    Escenario: Los formatos se comparan contra el build anterior
      Dado que la raíz del proyecto está vacía
      Y un proyecto con la configuración:
        """
        format:<br>  latex:<br>    generate: true<br>  html:<br>    generate: true<br>
        """
      Y un build anterior con los formatos "latex, pdf"
      Cuando calculo la metadata del build
      # HTML se acaba de pedir y PDF dejó de pedirse.
      Entonces los formatos del build son "html, latex"
      Y los formatos nuevos son "html"
      Y los formatos que se fueron son "pdf"