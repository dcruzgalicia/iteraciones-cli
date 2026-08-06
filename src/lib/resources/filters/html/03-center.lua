-- Convierte Div.center a <div class="center"> (formato HTML).
-- Reemplaza al filter TS html/03-center.
-- Uso: pandoc --from json --to html5 --lua-filter html/03-center.lua

function Div(div)
  local is_center = false
  for _, c in ipairs(div.classes) do
    if c == 'center' then
      is_center = true
      break
    end
  end
  if not is_center then return nil end
  local result = { pandoc.RawBlock('html', '<div class="center">') }
  for _, block in ipairs(div.content) do
    table.insert(result, block)
  end
  table.insert(result, pandoc.RawBlock('html', '</div>'))
  return result
end
