-- Convierte Div.verse a <div class="verse"> (formato HTML).
-- Reemplaza al transpiler TS html/02-verse (Fase 6).
-- Uso: pandoc --from json --to html5 --lua-filter html/02-verse.lua

function Div(div)
  local is_verse = false
  for _, c in ipairs(div.classes) do
    if c == 'verse' then
      is_verse = true
      break
    end
  end
  if not is_verse then return nil end
  local result = { pandoc.RawBlock('html', '<div class="verse">') }
  for _, block in ipairs(div.content) do
    table.insert(result, block)
  end
  table.insert(result, pandoc.RawBlock('html', '</div>'))
  return result
end
