# language: es
Característica: init con plantillas de proyecto

  Como quien arranca un proyecto editorial desde cero
  Quiero que init cree configuración, carpetas, menú y archivos mínimos
  Para compilar sin escribir el esqueleto a mano ni borrar contenido de ejemplo

  Regla de negocio: Las plantillas comparten el mismo motor y no generan contenido editorial

    Escenario: Una plantilla desconocida no crea nada
      Dado que la raíz del proyecto está vacía
      Cuando parseo el comando "init recetario" sobre la raíz del proyecto
      Entonces el comando termina con el código de salida 1
      Y el error dice "tipo de init desconocido"
      Y el archivo "iteraciones.config.yaml" no existe
