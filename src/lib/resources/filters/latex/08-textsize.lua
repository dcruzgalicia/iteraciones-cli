local SIZES = {
  tiny = true, scriptsize = true, footnotesize = true, small = true,
  normalsize = true, large = true, Large = true, LARGE = true,
  huge = true, Huge = true,
}

function Span(el)
  if FORMAT ~= 'latex' then return nil end
  local cmd = nil
  for _, c in ipairs(el.classes) do
    if SIZES[c] then cmd = '\\' .. c; break end
  end
  if not cmd then return nil end
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(el.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '{' .. cmd .. ' ' .. body .. '}')
end

function Div(el)
  if FORMAT ~= 'latex' then return nil end
  local cmd = nil
  for _, c in ipairs(el.classes) do
    if SIZES[c] then cmd = '\\' .. c; break end
  end
  if not cmd then return nil end
  local body = pandoc.write(pandoc.Pandoc(el.content), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawBlock('latex', '{' .. cmd .. ' ' .. body .. '}')
end
