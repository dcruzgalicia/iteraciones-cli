Característica: El CSS se genera sólo para la combinación activa

  Como quien mantiene el diseño del sitio
  Quiero una hoja propia con el estilo, tema y acento que se usan
  Para no servir CSS de otras combinaciones ni arrastrar utilidades muertas

  Escenario: La hoja lleva sólo el acento y el estilo elegidos
    Dado un proyecto vacío
    Cuando compilo el CSS con acento "rose", estilo "editorial" y tema "light"
    Entonces el CSS lleva el acento "rose"
    Y el CSS lleva el estilo "editorial"
    Y el CSS no lleva el estilo "clasico"
    Y el CSS no lleva reglas de tema oscuro

  Escenario: El tema oscuro añade sólo sus reglas
    Dado un proyecto vacío
    Cuando compilo el CSS con acento "lime", estilo "expresivo" y tema "dark"
    Entonces el CSS lleva el estilo "expresivo"
    Y el CSS lleva el tema oscuro
    Y el CSS no lleva el estilo "institucional"

  Escenario: La hoja es única y está minificada
    Dado un proyecto vacío
    Cuando compilo el CSS con acento "lime", estilo "clasico" y tema "light"
    Entonces el CSS no tiene comentarios ni saltos de línea
    Y el CSS pesa menos de 40000 bytes

  Escenario: Las tarjetas y el fondo usan el acento
    Dado un proyecto vacío
    Cuando compilo el CSS con acento "lime", estilo "clasico" y tema "light"
    Entonces el CSS mezcla el acento en el fondo de las tarjetas
    Y el CSS mezcla el acento en el fondo del sitio

  Escenario: Un acento desconocido produce error
    Dado un proyecto vacío
    Cuando compilo el CSS con acento "color-inventado"
    Entonces la compilación falla diciendo que el acento es desconocido

  Esquema del escenario: Cada acento llega a la hoja con sus once tonos
    Dado un proyecto vacío
    Cuando compilo el CSS con acento "<acento>", estilo "clasico" y tema "light"
    Entonces el CSS lleva el acento "<acento>"

    Ejemplos:
      | acento   |
      | slate    |
      | gray     |
      | zinc     |
      | neutral  |
      | stone    |
      | red      |
      | orange   |
      | amber    |
      | yellow   |
      | lime     |
      | green    |
      | emerald  |
      | teal     |
      | cyan     |
      | sky      |
      | blue     |
      | indigo   |
      | violet   |
      | purple   |
      | fuchsia  |
      | pink     |
      | rose     |
      | taupe    |
      | mauve    |
      | mist     |
      | olive    |

  Regla de negocio: Las clases que puede escribir una autora

    Escenario: La alineación funciona en el sitio (#2652)
      Cuando compilo el CSS con acento "lime", estilo "clasico" y tema "light"
      Entonces el CSS da a ".text-end" la propiedad "text-align:end"
      Y el CSS da a ".text-center" la propiedad "text-align:center"

    Escenario: La caja de un nombre propio ya no se parte (#2653)
      Cuando compilo el CSS con acento "lime", estilo "clasico" y tema "light"
      Entonces el CSS da a ".text-nowrap" la propiedad "text-wrap:nowrap"
      Y el CSS da a ".hyphens-none" la propiedad "hyphens:none"

    Escenario: El marco limita el ancho a 1600px
      Cuando compilo el CSS con acento "lime", estilo "clasico" y tema "light"
      Entonces el CSS da a ".marco" la propiedad "max-width:1600px"

    Escenario: Los tamaños de letra escalan (#2655)
      Cuando compilo el CSS con acento "lime", estilo "clasico" y tema "light"
      Entonces el CSS da a ".text-sm" la propiedad "font-size:.875rem"
      Y el CSS da a ".text-4xl" la propiedad "font-size:2.25rem"

    Escenario: El párrafo con sangría se sangra (#2670)
      Cuando compilo el CSS con acento "lime", estilo "clasico" y tema "light"
      Entonces el CSS da a ".indent-8" la propiedad "text-indent:2rem"

    Escenario: El epígrafe y el verso se estilan (#2649)
      Cuando compilo el CSS con acento "lime", estilo "clasico" y tema "light"
      Entonces el CSS da a ".dictum" la propiedad "max-width"
      Y el CSS da a ".dictum .author" la propiedad "font-style"
      Y el CSS da a ".verse" la propiedad "text-align"

  Regla de negocio: Las tarjetas comparten diseño (#2487, #2488)

    Escenario: Las tres copias tienen las mismas siete tarjetas y ninguna más
      Cuando reviso las copias de las tarjetas de "file", "collection" y "creator"
      Entonces las tres tienen exactamente las mismas tarjetas
      Y el esqueleto compartido trae el fondo de papel milimetrado
      Y el marcador de referencias no lleva marco propio

    Escenario: Todas las tarjetas comparten la misma superficie
      Cuando reviso la transparencia de las tarjetas de "file", "collection" y "creator"
      Entonces todas las tarjetas comparten la misma superficie

    Escenario: Todas las tarjetas redondean igual
      Cuando leo el styles.css del proyecto
      Entonces el CSS da a ".tarjeta" la propiedad "border-radius: var(--card-radius)"

    Escenario: El fondo es papel milimetrado: dos retículas y ni un punto
      Cuando leo el styles.css del proyecto
      Entonces el CSS da a ".sitio" la propiedad "background-image"
      Y el CSS da a ".sitio" la propiedad "background-size"
      Y el CSS no tiene "radial-gradient"

  Regla de negocio: La caché de CSS sólo depende del CSS y la configuración

    Esquema del escenario: La caché se comporta así ante cada cambio
      Dado un proyecto vacío
      Y calculo el hash de su CSS
      Cuando <acción>
      Entonces el hash <resultado>

      Ejemplos:
        | acción                                      | resultado |
        | lo vuelvo a calcular con la misma config    | no cambia |
        | cambio el HTML sin tocar la config          | no cambia |
        | cambio el acento a "blue"                   | cambia    |
        | cambio el estilo a "editorial"              | cambia    |
        | cambio el tema a "dark"                     | cambia    |
