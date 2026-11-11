# language: es
Característica: página 404

  Para que quien llega a una URL rota encuentre el sitio
  Quiero una 404 con la identidad y enlaces de recuperación

  Escenario: El sitio genera una 404 sin JavaScript
    Dado que la raíz del proyecto tiene un proyecto con HTML y URL base
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/404.html" contiene "Página no encontrada"
    Y el archivo "dist/files/404.html" contiene "Inicio"
    Y el archivo "dist/files/404.html" contiene 'name="robots" content="noindex"'
    Y el archivo "dist/files/404.html" no contiene "<script"
