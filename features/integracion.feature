# language: es
@requires-pandoc
Característica: init, build y validate funcionan de punta a punta
  Como quien empieza un proyecto desde cero
  Quiero que el CLI cree el proyecto y lo construya sin pasos manuales
  Para que el primer build de una persona nueva funcione

  Escenario: Genera HTML después de init y build
    Dado un directorio vacío
    Cuando inicializo el proyecto
    Entonces el proyecto tiene configuración y documento inicial
    Cuando compilo el proyecto desde cero
    Entonces dist tiene al menos un HTML

  Escenario: El build incremental reutiliza los documentos sin cambios
    Dado un proyecto con el documento inicial de prueba
    Cuando compilo el proyecto desde cero
    Y recompilo sin tocar nada
    Entonces el HTML no se reescribe

  Escenario: Un cambio de configuración invalida el build
    Dado un proyecto con el documento inicial de prueba
    Cuando compilo el proyecto desde cero
    Y cambio el tema del sitio en la configuración
    Y compilo otra vez
    Entonces el HTML sigue en dist

  Escenario: El build genera un HTML por documento
    Dado un directorio vacío
    Cuando inicializo el proyecto
    Y creo los capítulos uno y dos
    Y compilo el proyecto desde cero
    Entonces dist tiene un HTML para el índice y para cada capítulo

  Escenario: Un build fallido preserva el estado del último build completo (#2168)
    Dado un proyecto con el documento inicial de prueba
    Cuando compilo el proyecto desde cero
    Y apunto la bibliografía a un archivo que no existe
    Y compilo otra vez
    Entonces el build falla
    Y el estado guardado sigue siendo el del build completo
    Cuando corrijo la bibliografía y compilo otra vez
    Entonces dist vuelve a tener sus HTML

  Regla de negocio: validate reporta los errores de frontmatter sin lanzar
    Escenario: Validate detecta errores de frontmatter
      Dado un proyecto con un documento de frontmatter sin cerrar
      Cuando valido el proyecto
      Entonces validate sale con código de error
