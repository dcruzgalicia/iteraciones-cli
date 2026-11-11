# language: es
Característica: Open Graph y Twitter Card

  Para que una página compartida muestre título, descripción e imagen
  Quiero metadatos sociales absolutos cuando hay URL base

  Escenario: Una página declara sus metadatos sociales
    Dado que la raíz del proyecto tiene un proyecto con HTML, URL base y descripción propia
    Cuando hago un build del proyecto
    Entonces el comando termina con el código de salida 0
    Y el archivo "dist/files/test-document.html" contiene '<meta property="og:title" content="Test Document">'
    Y el archivo "dist/files/test-document.html" contiene '<meta property="og:description" content="Descripción de prueba">'
    Y el archivo "dist/files/test-document.html" contiene '<meta property="og:type" content="article">'
    Y el archivo "dist/files/test-document.html" contiene '<meta property="og:url" content="https://ejemplo.org/revista/test-document.html">'
    Y el archivo "dist/files/test-document.html" contiene '<meta property="og:image" content="https://ejemplo.org/revista/assets/images/logo.webp">'
    Y el archivo "dist/files/test-document.html" contiene '<meta name="twitter:card" content="summary_large_image">'
