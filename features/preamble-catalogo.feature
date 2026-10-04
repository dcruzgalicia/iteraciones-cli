# language: es
Característica: los filtros de preámbulo que trae el paquete

  Como quien ajusta el diseño de su PDF
  Quiero saber qué filtros existen, qué hace cada uno y poder sustituir uno
  Para no reescribir el preámbulo entero y para no romper la cola de imprenta

  # Tramo 4 de la migración. El catálogo de filtros de `preamble.test.ts`.

  Regla de negocio: El catálogo de filtros del paquete

    # Los tres últimos son la cola de imprenta —fondo de la primera hoja,
    # marcas de corte, PDF/X-1a— y ocupan ese lugar a propósito. El prefijo
    # numérico ordena los filtros, así que cualquier filtro nuevo llevaría un
    # número y se colaría entre ellos (#1952).

    Escenario: El catálogo tiene 31 filtros
      Entonces los filtros del paquete son 31

    Escenario: Cada filtro dice qué hace
      # Sin descripción, quien lee el `--list` tiene que abrir el `.tex` para
      # saber si le sirve. La descripción es la única documentación que existe.
      Entonces cada filtro del paquete tiene descripción

    Escenario: La cola de imprenta es siempre la última
      Entonces la cola de imprenta es '["97-eso-pic", "98-crop", "99-pdfx"]'

    Escenario: Todos los filtros traen su .tex
      # Un filtro vacío no falla al compilar: no hace nada. El autor lo
      # desactiva, pierde el diseño y no se entera de por qué.
      Entonces todos los filtros del paquete traen su .tex

    Escenario: Un filtro desactivado no viene precargado
      Dado que los filtros desactivados son '["15-hyphenation-rules"]'
      Entonces los filtros precargados son 30
      Y el filtro "15-hyphenation-rules" no viene precargado

  Regla de negocio: El .tex del proyecto gana al del paquete

    # Es la válvula de escape. Si el autor necesita cambiar un preámbulo y no
    # hay filtro para eso, escribe el archivo con el mismo nombre en
    # `preamble/` y lo sustituye: no hace falta tocar el código ni sacar un
    # filtro nuevo al paquete.

    Escenario: Un .tex propio sustituye al del paquete
      Dado que el proyecto reemplaza el filtro "15-hyphenation-rules" con su propio .tex
      Entonces el filtro "15-hyphenation-rules" trae el contenido del proyecto