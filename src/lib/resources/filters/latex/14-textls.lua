local function valor(el)
  local attrs = el.attributes
  if not attrs then return nil end
  local shrink = attrs['shrink']
  if shrink ~= nil then
    local n = tonumber(shrink)
    if n then return string.format('%g', -n) end
  end
  local stretch = attrs['stretch']
  if stretch ~= nil then
    local n = tonumber(stretch)
    if n then return string.format('%g', n) end
  end
  return nil
end

function Span(el)
  if FORMAT ~= 'latex' then return nil end
  local v = valor(el)
  if not v then return nil end
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(el.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '\\textls[' .. v .. ']{' .. body .. '}')
end

function Div(el)
  if FORMAT ~= 'latex' then return nil end
  local v = valor(el)
  if not v then return nil end
  local body = pandoc.write(pandoc.Pandoc(el.content), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawBlock('latex', '\\textls[' .. v .. ']{' .. body .. '}')
end