local SIZES = {
  ['text-xs'] = 'footnotesize',
  ['text-sm'] = 'small',
  ['text-base'] = 'normalsize',
  ['text-lg'] = 'large',
  ['text-xl'] = 'Large',
  ['text-2xl'] = 'LARGE',
  ['text-4xl'] = 'huge',
  ['text-6xl'] = 'Huge',
}

function Span(el)
  if FORMAT ~= 'latex' then return nil end
  local cmd = nil
  for _, c in ipairs(el.classes) do
    if SIZES[c] then cmd = SIZES[c]; break end
  end
  if not cmd then return nil end
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(el.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '{\\' .. cmd .. ' ' .. body .. '}')
end

function Div(el)
  if FORMAT ~= 'latex' then return nil end
  local cmd = nil
  for _, c in ipairs(el.classes) do
    if SIZES[c] then cmd = SIZES[c]; break end
  end
  if not cmd then return nil end
  local body = pandoc.write(pandoc.Pandoc(el.content), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawBlock('latex', '{\\' .. cmd .. ' ' .. body .. '}')
end
