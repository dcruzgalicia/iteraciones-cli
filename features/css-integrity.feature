# language: es
Característica: El CSS se compila sólo con lo que aparece en el HTML
  Como quien mantiene el diseño del sitio
  Quiero que el CSS generado contenga exactamente las clases del HTML final
  Para no arrastrar clases de documentos que ya no existen

  # El CSS se compila escaneando SOLO los HTML de `dist/files`: el fixture
  # controla qué clases deben aparecer (presentes en el HTML) y cuáles no
  # (ausentes, incluidas las de un CSS previo que no debe auto-referenciarse).

  Escenario: El binario del CLI se resuelve por módulos y existe
    Cuando resuelvo el binario de Tailwind
    Entonces apunta a un archivo del paquete @tailwindcss que existe

  Escenario: Incluye las clases del HTML, aplica el acento y purga las ausentes
    Dado un proyecto con un HTML de clases "bg-stone-200 text-accent-500 prose grid grid-cols-2"
    Y un CSS previo con una clase que ya no usa el HTML
    Cuando compilo el CSS con acento "rose"
    Entonces el CSS incluye las clases del HTML y el acento configurado
    Y el CSS purga lo que el HTML ya no usa y no inventa lo que no menciona

  Escenario: styles.css no define ninguna clase de CSS tradicional (#2487)
    Cuando leo el styles.css del proyecto
    Entonces no tiene selectores de clase sueltos
    Y sus únicas utilidades son las cuatro de los casos extremos

  Escenario: Sólo entran las clases que el HTML usa
    Dado un proyecto con un HTML de clases "text-stone-500"
    Cuando compilo el CSS con acento "lime"
    Entonces el CSS incluye la clase del HTML
    Y el CSS no incluye ninguna clase que no esté en el HTML

  Escenario: Un acento desconocido produce error de build
    Dado un proyecto vacío
    Cuando compilo el CSS con acento "color-inventado"
    Entonces la compilación falla diciendo que el acento es desconocido

  Regla de negocio: Cada acento llega al CSS con sus once tonos

    # El acento es la única palanca que la config mete en el `@theme`, y son
    # veintiséis valores. En prosa serían veintiséis pasos nuevos; en tabla, una
    # fila por paleta y el mismo step definition.

    # La lista no es decorativa: `KNOWN_ACCENT_COLORS` sale de las claves de
    # `ACCENT_PALETTES`, así que una paleta nueva sin fila aquí es un valor de
    # config que nadie sabe si llega al CSS. `build-assets.ts` además hashea la
    # paleta elegida, así que un valor que no llega también cambia el hash y con
    # él la caché de todos los builds.

    Esquema del escenario: La paleta elegida es la que se compila
      Dado un proyecto con un HTML de clases "text-accent-500"
      Cuando compilo el CSS con acento "<acento>"
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

  Regla de negocio: Las tarjetas comparten diseño (#2487, #2488)
    Las tres copias —file, collection y creator— arrancan del mismo diseño, así
    que las invariantes se comprueban en todas. #2488: viven en `html/<type>/`,
    una copia por tipo.

    Escenario: Las tres copias tienen las mismas siete tarjetas y ninguna más
      Cuando reviso las copias de las tarjetas de "file", "collection" y "creator"
      Entonces las tres tienen exactamente las mismas tarjetas
      Y el esqueleto compartido trae el fondo de papel milimetrado
      Y el marcador de referencias no lleva marco propio

    Escenario: Todas las tarjetas comparten la misma transparencia
      Cuando reviso la transparencia de las tarjetas de "file", "collection" y "creator"
      Entonces todas las tarjetas comparten la misma transparencia

    Escenario: La punta dibujada queda en las esquinas rectas
      Cuando reviso la punta de las tarjetas de "file", "collection" y "creator"
      Entonces la punta de cada tarjeta queda en las esquinas rectas

    Escenario: El fondo es papel milimetrado: dos retículas y ni un punto
      Cuando leo el esqueleto y el styles.css del proyecto
      Entonces el esqueleto usa el fondo de papel milimetrado y sin degradados
      Y el styles.css define ese fondo con las dos retículas y sin utilidad muerta

  Regla de negocio: La caché de CSS se invalida sólo cuando el contenido cambia
    El hash se calcula con `mtime + size`. El caso ambiguo —mtime distinto con
    contenido idéntico— lo resuelve releyendo el contenido.

    Esquema del escenario: La caché se comporta así ante cada cambio
      Dado un proyecto con un HTML de clase "x"
      Y calculo el hash de su CSS
      Cuando <acción>
      Entonces el hash <resultado>

      Ejemplos:
        | acción                                       | resultado  |
        | lo vuelvo a calcular con la caché intacta     | no cambia  |
        | toco el archivo sin cambiar su contenido      | no cambia  |
        | cambio el contenido y mantengo el mismo tamaño | cambia    |
        | agrando el contenido                           | cambia     |
        | borro el archivo                              | cambia     |
