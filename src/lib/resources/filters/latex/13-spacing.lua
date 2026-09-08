-- Convierte Div con atributo spacing en \begin{spacing}{valor}...\end{spacing}
-- Requiere el paquete setspace (cargado en 03-spacing.tex).
-- Uso: ::: {spacing=1.1} contenido :::
-- Solo LaTeX: en HTML se ignora.

function Div(el)
  if FORMAT ~= 'latex' then return nil end
  local value = el.attributes['spacing']
  if not value then return nil end
  local num = tonumber(value)
  if not num or num <= 0 then return nil end
  local body = pandoc.write(pandoc.Pandoc(el.content), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawBlock('latex', '\\begin{spacing}{' .. value .. '}\n' .. body .. '\n\\end{spacing}')
end
