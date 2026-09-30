-- Convierte Div.spacer a un <div> con la utilidad de Tailwind `h-[1.5em]`
-- (formato HTML): el separador vertical del marcador :: mide ~1.5em, el
-- interlineado del tamaño base. Es una utilidad y no una clase de CSS propia
-- porque el escáner de Tailwind la genera desde el HTML (#2487).
-- La clase noindent se ignora (la sangría de párrafo es LaTeX-only).
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
  return pandoc.RawBlock('html', '<div class="h-[1.5em]"></div>')
end
