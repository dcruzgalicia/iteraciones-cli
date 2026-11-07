local function warn(msg)
  if pandoc.log and pandoc.log.warn then
    pandoc.log.warn(msg)
  else
    io.stderr:write('iteraciones: ' .. msg .. '\n')
  end
end

local function nbsp_span(span)
  local raw = span.attributes and span.attributes.n
  if raw == nil then return nil end
  local n = tonumber(raw)
  if n == nil or n < 1 or n % 1 ~= 0 then
    warn('span {n=' .. raw .. '}: n debe ser un entero positivo; se ignora')
    return pandoc.Str('')
  end
  if FORMAT:match('html') or FORMAT:match('epub') then
    return pandoc.RawInline('html', string.rep('&nbsp;', n))
  end
  if FORMAT:match('latex') then
    return pandoc.RawInline('latex', string.rep('~', n))
  end
  return nil
end

return {{ Span = nbsp_span }}
