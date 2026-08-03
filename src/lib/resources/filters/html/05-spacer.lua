-- Convierte Div.spacer a <div class="spacer"></div> (formato HTML).
-- La clase noindent se ignora (la sangría de párrafo es LaTeX-only).
-- Reemplaza al filter TS html/05-spacer (Fase 6).
-- Uso: pandoc --from json --to html5 --lua-filter html/05-spacer.lua

function Div(div)
  local is_spacer = false
  for _, c in ipairs(div.classes) do
    if c == 'spacer' then
      is_spacer = true
      break
    end
  end
  if not is_spacer then return nil end
  return pandoc.RawBlock('html', '<div class="spacer"></div>')
end
