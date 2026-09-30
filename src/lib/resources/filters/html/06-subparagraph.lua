-- Convierte ### (h3) en un <div> con las utilidades de Tailwind del
-- \subparagraph de LaTeX (KOMA-Script: negrita + itálica) antes de que pandoc
-- intente generar un h7 (que no existe en HTML). Son utilidades y no una clase
-- de CSS propia porque el escáner de Tailwind las genera desde el HTML (#2487).
-- Los h1 y h2 se manejan con --shift-heading-level-by=4.
function Header(el)
  if el.level == 3 then
    local text = pandoc.write(pandoc.Pandoc({el}), 'html')
    local content = text:match('>(.-)<') or ''
    return pandoc.RawBlock('html',
      '<div class="font-bold italic">' .. content .. '</div>')
  end
end
