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

function Plain(plain)
  if not is_double_colon(plain.content) then return nil end
  return to_spacer()
end
