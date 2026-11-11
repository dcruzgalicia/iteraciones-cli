# language: es
Característica: Las fixtures congeladas de los proyectos compilan
  Como quien cuida la regresión de los dos proyectos de ejemplo
  Quiero compilar fixtures mínimas sin tocar los proyectos originales
  Para detectar roturas de HTML, PDF, EPUB y conteo de archivos

  Regla de negocio: La fixture de sitio produce el HTML del sitio

    Escenario: El sitio de ejemplo compila sólo HTML
      Dado que copio la fixture de proyecto "sitio" a la raíz del proyecto
      Cuando corro "build"
      Entonces el comando termina con el código de salida 0
      Y la fixture generó el archivo "dist/files/index.html"
      Y la fixture generó el archivo "dist/files/inicio.html"
      Y la fixture generó el archivo "dist/files/coleccion-de-ejemplo.html"
      Y la fixture generó 7 archivos en "dist/files"

  Regla de negocio: La fixture de libro produce todos los formatos

    Escenario: El libro de ejemplo compila LaTeX, PDF, HTML, EPUB y Markdown
      Dado que copio la fixture de proyecto "libro" a la raíz del proyecto
      Cuando corro "build"
      Entonces el comando termina con el código de salida 0
      Y la fixture generó el archivo "dist/files/antologia-de-ejemplo-por-ana-ejemplo.tex"
      Y la fixture generó el archivo "dist/files/antologia-de-ejemplo-por-ana-ejemplo.pdf"
      Y la fixture generó el archivo "dist/files/antologia-de-ejemplo-por-ana-ejemplo.html"
      Y la fixture generó el archivo "dist/files/antologia-de-ejemplo-por-ana-ejemplo.epub"
      Y la fixture generó el archivo "dist/files/antologia-de-ejemplo-por-ana-ejemplo.md"
      Y la fixture generó el archivo "dist/files/ana-ejemplo.html"
      Y la fixture generó 12 archivos en "dist/files"
      Y los PDF de la fixture pesan más de 1000 bytes
