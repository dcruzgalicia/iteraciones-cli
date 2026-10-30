import Masonry from 'masonry-layout';

/**
 * El masonry del sitio: las tarjetas se colocan de izquierda a derecha
 * (horizontalOrder) y las columnas se reparten según el ancho del contenedor.
 * Sin JS, las tarjetas quedan apiladas a todo lo ancho.
 */
function iniciaMasonry() {
  const main = document.querySelector('[data-grid="masonry"]');
  if (main === null) return;
  main.setAttribute('data-masonry-ready', '');
  const masonry = new Masonry(main, {
    itemSelector: '[data-grid="masonry"] > div',
    columnWidth: '[data-grid-sizer]',
    gutter: '[data-gutter-sizer]',
    percentPosition: true,
    horizontalOrder: true,
    transitionDuration: 0,
  });
  const recoloca = () => masonry.layout();
  window.addEventListener('load', recoloca);
  if (document.fonts !== undefined && document.fonts.ready !== undefined) document.fonts.ready.then(recoloca);
  for (const img of main.querySelectorAll('img')) {
    if (!img.complete) img.addEventListener('load', recoloca, { once: true });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciaMasonry);
else iniciaMasonry();
