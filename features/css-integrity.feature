# language: es
Característica: El CSS se compila sólo con lo que aparece en el HTML
  Como quien mantiene el diseño del sitio
  Quiero que el CSS generado contenga exactamente las clases del HTML final
  Para no arrastrar clases de documentos que ya no existen

  Escenario: El binario del CLI se resuelve por módulos y existe
    Cuando resuelvo el binario de Tailwind
    Entonces apunta a un archivo del paquete @tailwindcss que existe

  Escenario: Incluye las clases del HTML, aplica el acento y purga las ausentes
    Dado un proyecto con un HTML de clases "bg-stone-200 text-accent-500 prose grid grid-cols-2"
    Y un CSS previo con una clase que ya no usa el HTML
    Cuando compilo el CSS con acento "rose"
    Entonces el CSS incluye las clases del HTML y el acento configurado
    Y el CSS purga lo que el HTML ya no usa y no inventa lo que no menciona

  Escenario: Las tarjetas mezclan el acento en el fondo
    Dado un proyecto cuyo HTML trae "<div class=\"tarjeta\">x</div>"
    Cuando compilo el CSS con acento "lime"
    Entonces el CSS mezcla el acento en el fondo de las tarjetas

  Escenario: El fondo del sitio deriva del acento y no es gris
    Cuando leo el esqueleto y el styles.css del proyecto
    Entonces el esqueleto usa el fondo del sitio teñido del acento
    Y el CSS mezcla el acento en el fondo del sitio

  Escenario: El borde de acento se resalta al pasar el ratón en todas las tarjetas
    Dado un proyecto cuyo HTML trae "<div class=\"tarjeta ring-1\">x</div>"
    Cuando compilo el CSS con acento "lime"
    Entonces el CSS da a ".tarjeta:hover" la propiedad "--tw-ring-color"

  Escenario: styles.css no define ninguna clase de CSS tradicional (#2487)
    Cuando leo el styles.css del proyecto
    Entonces no tiene selectores de clase sueltos
    Y sus únicas utilidades son las que tienen caso atrás

  Regla de negocio: Los bloques de LaTeX que también salen en el sitio (#2649)

    Escenario: El epígrafe y el verso se estilan de verdad, no salen como un bloque pelado
      Dado un proyecto cuyo HTML trae "<blockquote class=\"dictum\"><p>Cita</p><div class=\"author\"><p>Fulano</p></div></blockquote><div class=\"verse\"><p>uno<br />dos</p></div>"
      Cuando compilo el CSS con acento "lime"
      Entonces el CSS da a ".dictum" la propiedad "max-width"
      Y el CSS da a ".dictum .author" la propiedad "font-style"
      Y el CSS da a ".verse" la propiedad "text-align"

    Escenario: Alinear a la derecha o al centro ya funciona en el sitio (#2652)
      Dado un proyecto cuyo HTML trae "<div class=\"text-end\"><p>Derecha</p></div><div class=\"text-center\"><p>Centro</p></div>"
      Cuando compilo el CSS con acento "lime"
      Entonces el CSS da a ".text-end" la propiedad "text-align:end"
      Y el CSS da a ".text-center" la propiedad "text-align:center"

    Escenario: La caja de un nombre propio ya no se parte en el sitio (#2653)
      Dado un proyecto cuyo HTML trae "<p>texto <span class=\"text-nowrap\">Ana Ruiz</span> <span class=\"text-nowrap hyphens-none\">María José</span> aqui</p>"
      Cuando compilo el CSS con acento "lime"
      Entonces el CSS da a ".text-nowrap" la propiedad "text-wrap:nowrap"
      Y el CSS da a ".hyphens-none" la propiedad "hyphens:none"

    Escenario: Los tamaños de letra ya escalan en el sitio (#2655)
      Dado un proyecto cuyo HTML trae "<p>texto <span class=\"text-sm\">chico</span> aqui</p><div class=\"text-4xl\">Grito</div>"
      Cuando compilo el CSS con acento "lime"
      Entonces el CSS da a ".text-sm" la propiedad "font-size:var(--text-sm)"
      Y el CSS da a ".text-4xl" la propiedad "font-size:var(--text-4xl)"

    Escenario: El párrafo con sangría se sangra de verdad en el sitio (#2670)
      Dado un proyecto cuyo HTML trae "<div class=\"indent-8\"><p>Sangrado</p></div>"
      Cuando compilo el CSS con acento "lime"
      Entonces el CSS da a ".indent-8" la propiedad "text-indent:calc(var(--spacing) * 8)"

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
      Entonces todas las tarjetas comparten la misma superficie

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
