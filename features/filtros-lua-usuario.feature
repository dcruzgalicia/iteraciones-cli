# language: es
@requires-pandoc
Característica: Los filtros de usuario se aplican y se condicionan por formato
  Como quien escribe su propio filtro Lua para el proyecto
  Quiero que el build lo aplique y que pueda cambiar según el formato de salida
  Para generar marcado distinto en LaTeX y en HTML con un solo filtro

  Escenario: Un filtro de usuario se condiciona por FORMAT
    Dado un proyecto con un filtro de usuario que convierte la clase nota
    Cuando convierto el documento con el filtro a LaTeX
    Entonces el LaTeX lleva la caja de nota
    Cuando convierto el documento con el filtro a HTML
    Entonces el HTML lleva el bloque aside de nota

  Escenario: El pipeline del proyecto aplica los filtros de usuario declarados en la config
    Dado un proyecto con un filtro de usuario que convierte la clase nota
    Y el filtro declarado en la configuración del proyecto
    Cuando compilo el documento por el pipeline
    Entonces el LaTeX lleva la caja de nota

  Escenario: Un override del filtro del paquete en el proyecto no rompe la pasada (#2460)
    Dado un proyecto con una copia del filtro de mbox como override
    Cuando convierto el documento con el override y los helpers del paquete por env
    Entonces el LaTeX lleva la caja de mbox
