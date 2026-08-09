-- Convierte líneas con solo "::" en Div.spacer (semántico, sin formato específico).
-- Uso: pandoc --from markdown --to json --lua-filter semantic/string/01-double-colon.lua

function Para(para)
  if #para.content ~= 1 then return nil end
  local inl = para.content[1]
  if inl.t ~= 'Str' or inl.text ~= '::' then return nil end
  return pandoc.Div(pandoc.Blocks{}, pandoc.Attr('', { 'spacer' }))
end
