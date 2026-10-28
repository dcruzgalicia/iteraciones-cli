# language: es
@requires-pandoc
Característica: El markdown exportado a dist se puede re-procesar
  Como quien vuelve a procesar la salida del build como si fuera el origen
  Quiero que dist se pueda reprocesar sin perder nada
  Para que un ciclo de build no degrade el documento en cada pasada

  Escenario: Re-procesar dist produce exactamente la misma salida (#2436)
    Dado un proyecto con salida en HTML y Markdown
    Y un documento "ensayo" con título, subtítulo, autora, fecha y slug
    Y una creativa con un enlace en su frontmatter
    Cuando compilo el proyecto
    Entonces el markdown exportado lleva el frontmatter completo
    Y el markdown exportado conserva el heading sin desplazar
    Y la creativa lleva su enlace en el frontmatter y no lo repite en el cuerpo
    Cuando uso dist como proyecto origen y compilo de nuevo
    Entonces todas las salidas son idénticas a la primera pasada

  Regla de negocio: Con merge también entra la sección de colaboradoras

    Escenario: El merge trae autoras, sin interventions y con los niveles bajados
      Dado un proyecto con salida en HTML y Markdown
      Y una colección con autora, colaboradora e intervención
      Cuando compilo el proyecto
      Entonces el markdown de la colección dice "# Autoras y colaboradoras"
      Y el markdown de la colección dice "##### Ana Ruiz"
      Y el markdown de la colección dice "###### Sección"
      Y el markdown de la colección dice "##### Capítulo"
      Y el markdown de la colección no dice "No debe ir"
      Y el markdown individual conserva el nivel "# Capítulo"

  Regla de negocio: `merge` es la única palanca que pierde información

    Esquema del escenario: Merge decide si la salida conserva su estructura
      Dado un proyecto con salida en HTML y Markdown
      Y una colección con merge <merge>
      Cuando compilo el proyecto
      Entonces el markdown de la colección <efecto>

      Ejemplos:
        | merge | efecto                           |
        | false | conserva type y files            |
        | true  | ya viene fusionado               |
