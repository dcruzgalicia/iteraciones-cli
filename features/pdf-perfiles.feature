Característica: PDF de impresión y PDF ligero

  Para imprimir con PDFX-1a o compartir un PDF pequeño
  Quiero que las imágenes cambien de perfil según el modo

  Escenario: Con PDFX-1a la imagen respeta 5 cm a 300 dpi
    Dado un proyecto con PDF y una imagen de 5 cm
    Cuando compilo el proyecto PDF
    Entonces el PDF conserva la imagen a 300 dpi y 591 px de ancho
    Y el PDF pasa la validación PDFX-1a

  Escenario: Sin PDFX el PDF es ligero
    Dado un proyecto con PDF y una imagen de 5 cm
    Y el proyecto desactiva PDFX
    Cuando compilo el proyecto PDF
    Entonces las imágenes del PDF pesan menos de 25 KB
    Y el PDF pesa menos de 100 KB
