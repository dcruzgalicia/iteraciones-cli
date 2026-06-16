-- Read ref-level from temp file written by pipeline
local docHasParts = false
local f = io.open('/tmp/iteraciones-ref-level', 'r')
if f then
  local content = f:read('*all')
  f:close()
  if content and content:find('part') then
    docHasParts = true
  end
end

function Div(el)
  if el.classes:includes('references') then
    local level = docHasParts and 'part' or 'section'
    local headingText = docHasParts and '\\MakeUppercase{Referencias}' or 'Referencias'
    local heading
    if level == 'part' then
      -- \part* creates its own anchor on the heading page
      heading = '\\' .. level .. '*{' .. headingText .. '}\\addcontentsline{toc}{' .. level .. '}{\\texorpdfstring{' .. headingText .. '}{Referencias}}'
    else
      -- \section* with secnumdepth=-2 doesn't create anchor.
      -- \refstepcounter inside the heading text creates the anchor
      -- at the exact position of the title text.
      heading = '\\section*{\\refstepcounter{section}' .. headingText .. '}\\addcontentsline{toc}{section}{\\texorpdfstring{' .. headingText .. '}{Referencias}}'
    end
    return {
      pandoc.RawBlock('latex', heading),
      el
    }
  end
end
