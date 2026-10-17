function Div(el)
  if FORMAT == 'latex' then return nil end
  if el.attributes and (el.attributes['shrink'] ~= nil or el.attributes['stretch'] ~= nil or el.attributes['runt'] ~= nil) then
    return el.content
  end
  return nil
end

function Span(el)
  if FORMAT == 'latex' then return nil end
  if el.classes and el.classes:find('text-nowrap', 1, true) then
    return el.content
  end
  return nil
end