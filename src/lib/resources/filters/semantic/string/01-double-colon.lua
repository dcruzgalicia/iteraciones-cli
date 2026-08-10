-- Convierte líneas con solo "::" en Div.spacer (semántico, sin formato específico).
-- El marcador es una línea cuyo único contenido es :: (pandoc normaliza los
-- espacios trailing en el AST, así que ":: " es equivalente a "::").
-- Uso: pandoc --from markdown --to json --lua-filter semantic/string/01-double-colon.lua

local function to_spacer()
  return pandoc.Div(pandoc.Blocks{}, pandoc.Attr('', { 'spacer' }))
end

local function is_double_colon(inlines)
  if #inlines ~= 1 then return false end
  local inl = inlines[1]
  return inl.t == 'Str' and inl.text == '::'
end

function Para(para)
  if not is_double_colon(para.content) then return nil end
  return to_spacer()
end

-- Los items de lista y las celdas de tabla son bloques Plain, no Para: sin
-- este handler, "::" se imprimía literal dentro de listas y tablas.
function Plain(plain)
  if not is_double_colon(plain.content) then return nil end
  return to_spacer()
end
