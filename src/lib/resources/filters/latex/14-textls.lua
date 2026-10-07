function Span(el)
  if FORMAT ~= 'latex' then return nil end
  local value = el.attributes['value']
  if not value then return nil end
  local num = tonumber(value)
  if not num then return nil end
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(el.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '\\textls[' .. value .. ']{' .. body .. '}')
end

function Div(el)
  if FORMAT ~= 'latex' then return nil end
  local value = el.attributes['value']
  if not value then return nil end
  local num = tonumber(value)
  if not num then return nil end
  local body = pandoc.write(pandoc.Pandoc(el.content), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawBlock('latex', '\\textls[' .. value .. ']{' .. body .. '}')
end
