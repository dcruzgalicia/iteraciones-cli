Característica: preview sirve el sitio y el admin en local

  Como quien revisa el HTML y el admin mientras escribe
  Quiero que preview levante un servidor local
  Para no montar otro servidor a mano

  Regla de negocio: El servidor sirve la salida y el admin, y se cierra con Ctrl+C

    Escenario: preview anuncia la URL y sirve el sitio y /admin/
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Y que el proyecto tiene un admin
      Cuando arranco preview con servidor
      Entonces preview construyó el proyecto una vez y quedó esperando
      Y preview anuncia una URL local
      Y el preview responde "/" con el código 200
      Y el preview responde "/admin/" con el código 200
      Y el preview sirve "/admin/" con "admin de prueba"

    Escenario: El servidor no queda vivo al parar preview
      Dado que la raíz del proyecto tiene un proyecto de prueba
      Cuando arranco preview con servidor
      Y preview anuncia una URL local
      Y paro preview
      Entonces el servidor de preview ya no responde
