Característica: URL base del sitio

  Para generar canonical, sitemap y feeds
  Quiero declarar una sola vez la URL pública del sitio

  Escenario: Acepta una URL absoluta
    Cuando valido esta configuración:
      """
      format:
        html:
          site:
            url: https://ejemplo.org/revista
      """
    Entonces la configuración es válida y la URL del sitio es "https://ejemplo.org/revista"

  Escenario: Rechaza una URL relativa
    Cuando valido esta configuración:
      """
      format:
        html:
          site:
            url: /revista
      """
    Entonces la configuración es inválida

  Escenario: Sin URL el sitio sigue siendo válido
    Cuando valido esta configuración:
      """
      format:
        html:
          site:
            title: Ejemplo
      """
    Entonces la configuración es válida sin URL de sitio
