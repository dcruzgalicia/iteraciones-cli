local function valor(el)
  local n = tonumber(el.attributes['shrink'])
  if not n then return nil end
  return string.format('%g', -n)
end

function Div(el)
  if FORMAT ~= 'latex' then return nil end
  local v = valor(el)
  if not v then return nil end
  local body = pandoc.write(pandoc.Pandoc(el.content), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawBlock('latex', '\\textls[' .. v .. ']{' .. body .. '}')
end
