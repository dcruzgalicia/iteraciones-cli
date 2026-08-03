-- Convierte Div.flushright a <div class="flushright"> (formato HTML).
-- Reemplaza al filter TS html/04-flushright (Fase 6).
-- Uso: pandoc --from json --to html5 --lua-filter html/04-flushright.lua

function Div(div)
  local is_flushright = false
  for _, c in ipairs(div.classes) do
    if c == 'flushright' then
      is_flushright = true
      break
    end
  end
  if not is_flushright then return nil end
  local result = { pandoc.RawBlock('html', '<div class="flushright">') }
  for _, block in ipairs(div.content) do
    table.insert(result, block)
  end
  table.insert(result, pandoc.RawBlock('html', '</div>'))
  return result
end
