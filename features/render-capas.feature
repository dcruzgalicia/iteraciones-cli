# language: es
Característica: los filtros Lua del paquete, por capa

  Como quien ajusta el resultado de una transformación
  Quiero saber qué filtros se aplican, en qué orden y cuáles son los míos
  Para saber qué está pasando y qué puedo sobrescribir

  Regla de negocio: Las capas se resuelven en el orden del filesystem

    Escenario: Cada capa trae sus filtros del paquete, en orden
      Dado que la raíz del proyecto está vacía
      Y que la disabled list de filtros es '[]'
      Cuando resuelvo los filtros del paquete por capa
      Entonces la capa "semantic" tiene 4 filtros
      Y el filtro 1 de la capa "semantic" acaba en "semantic/string/01-double-colon.lua"
      Y el filtro 2 de la capa "semantic" acaba en "semantic/ast/02-double-colon-noindent.lua"
      Y el filtro 4 de la capa "semantic" acaba en "semantic/ast/04-image-paths.lua"

    Escenario: Un filtro desactivado desaparece de la lista y de los nombres
      Dado que la raíz del proyecto está vacía
      Y que la disabled list de filtros es '["semantic/string/01-double-colon"]'
      Cuando resuelvo los filtros del paquete por capa
      Entonces la capa "semantic" tiene 3 filtros
      Y la capa "semantic" no trae "semantic/string/01-double-colon.lua"
      Y el nombre "semantic/string/01-double-colon" no quedó resuelto

  Regla de negocio: El archivo del proyecto gana sobre el del paquete

    Escenario: Un .lua del proyecto sustituye al del paquete, en su sitio
      Dado que la raíz del proyecto está vacía
      Y que el proyecto sobrescribe el filtro "filters/semantic/ast/02-double-colon-noindent.lua"
      Y que la disabled list de filtros es '[]'
      Cuando resuelvo los filtros del paquete por capa
      Entonces la capa "semantic" tiene 4 filtros
      Y el filtro 2 de la capa "semantic" es el del proyecto
      Y el filtro 1 de la capa "semantic" acaba en "semantic/string/01-double-colon.lua"

    Escenario: El grupo del build usa el mismo override
      Dado que la raíz del proyecto está vacía
      Y que el proyecto sobrescribe el filtro "filters/latex/02-dictum.lua"
      Cuando resuelvo los grupos de filtros del proyecto
      Entonces el filtro 2 del grupo "latex" es el del proyecto

  Regla de negocio: El filtro interno de flags no se expone

    Escenario: El filtro de flags está y no es desactivable
      Dado que la raíz del proyecto está vacía
      Cuando resuelvo los grupos de filtros del proyecto
      Entonces el grupo "flags" tiene 1 filtros
      Y el filtro 1 del grupo "flags" acaba en "internal/flags.lua"

  Regla de negocio: Un filtro de usuario se resuelve a ruta absoluta

    Escenario: Un filtro de usuario relativo se vuelve absoluto
      Dado que la raíz del proyecto está vacía
      Y que el proyecto declara el filtro de usuario "filters/mi-filtro.lua"
      Cuando resuelvo los filtros de usuario del proyecto
      Entonces los filtros de usuario son 1
      Y el filtro de usuario 1 es una ruta absoluta
      Y el filtro de usuario 1 acaba en "filters/mi-filtro.lua"

    Escenario: Un filtro de usuario inexistente se omite en silencio
      Dado que la raíz del proyecto está vacía
      Y que el proyecto declara un filtro de usuario que no existe
      Cuando resuelvo los filtros de usuario del proyecto
      Entonces los filtros de usuario son 0
      Y no hay ningún aviso

    Escenario: Sin filtros de usuario no hay nada que resolver
      Dado que la raíz del proyecto está vacía
      Y que la raíz del proyecto tiene un archivo de configuración vacío
      Cuando resuelvo los filtros de usuario del proyecto
      Entonces los filtros de usuario son 0
