-- Convierte ### (h3) en <div class="subparagraph"> antes de que pandoc
-- intente generar un h7 (que no existe en HTML).
-- Los h1 y h2 se manejan con --shift-heading-level-by=4.
function Header(el)
  if el.level == 3 then
    local text = pandoc.write(pandoc.Pandoc({el}), 'html')
    local content = text:match('>(.-)<') or ''
    return pandoc.RawBlock('html',
      '<div class="subparagraph">' .. content .. '</div>')
  end
end
