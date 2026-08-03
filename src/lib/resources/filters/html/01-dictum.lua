-- Convierte Div.dictum a <blockquote class="dictum"> (formato HTML).
-- Reemplaza al filter TS html/01-dictum (Fase 6).
-- Uso: pandoc --from json --to html5 --lua-filter html/01-dictum.lua

function Div(div)
  local is_dictum = false
  for _, c in ipairs(div.classes) do
    if c == 'dictum' then
      is_dictum = true
      break
    end
  end
  if not is_dictum then return nil end
  local result = { pandoc.RawBlock('html', '<blockquote class="dictum">') }
  for _, block in ipairs(div.content) do
    table.insert(result, block)
  end
  table.insert(result, pandoc.RawBlock('html', '</blockquote>'))
  return result
end
