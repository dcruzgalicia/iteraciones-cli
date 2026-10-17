local function br_count(div)
  if div.t ~= 'Div' then return nil end
  local attrs = div.attributes
  if not attrs then return nil end
  local raw = attrs['br']
  if raw == nil then return nil end
  local n = tonumber(raw)
  if not n then return nil end
  n = math.floor(n)
  if n <= 0 then return nil end
  return n
end

function Div(div)
  local n = br_count(div)
  if not n then return nil end
  local out = {}
  for i = 1, n do
    table.insert(out, pandoc.RawBlock('html', '<br/>'))
  end
  for _, child in ipairs(div.content or {}) do
    table.insert(out, child)
  end
  return out
end