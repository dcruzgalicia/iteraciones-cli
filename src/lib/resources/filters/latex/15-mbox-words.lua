local mbox
local helpers_path = os.getenv('ITERACIONES_MBOX_HELPERS')
if helpers_path and helpers_path ~= '' then
  mbox = dofile(helpers_path)
else
  local script_dir = PANDOC_SCRIPT_FILE:match('^(.*[\\/])')
  package.path = package.path .. ';' .. script_dir .. '?.lua'
  mbox = require 'shared.mbox-helpers'
end

local function abrir()
  return pandoc.RawInline('latex', '\\mbox{')
end

local function cerrar()
  return pandoc.RawInline('latex', '}')
end

local function es_espacio(inl)
  return inl.t == 'Space' or inl.t == 'SoftBreak'
end

local function unidades(inlines)
  local lista = {}
  for i, c in ipairs(inlines) do
    local cls = mbox.classify(c)
    if cls == 'word' then
      table.insert(lista, { idx = i, inner = nil })
    elseif cls == 'word-group' then
      for k = 1, mbox.group_word_count(c) do
        table.insert(lista, { idx = i, inner = k })
      end
    end
  end
  return lista
end

local function envolver_grupo(inl, desde, hasta)
  local palabra = 0
  local function camina(contenido)
    local salida = {}
    for _, c in ipairs(contenido) do
      local cls = mbox.classify(c)
      if cls == 'word' then
        palabra = palabra + 1
        if palabra == desde then table.insert(salida, abrir()) end
        table.insert(salida, c)
        if palabra == hasta then table.insert(salida, cerrar()) end
      elseif cls == 'word-group' then
        c.content = camina(c.content)
        table.insert(salida, c)
      else
        table.insert(salida, c)
      end
    end
    return salida
  end
  inl.content = camina(inl.content)
  return inl
end

local function envolver_rango(inlines, desde, hasta)
  local u1 = desde
  local u2 = hasta
  local salida = {}
  for i, inl in ipairs(inlines) do
    local desde_interno, hasta_interno
    if i == u1.idx and i == u2.idx then
      desde_interno, hasta_interno = u1.inner, u2.inner
    elseif i == u1.idx and u1.inner ~= nil then
      desde_interno, hasta_interno = u1.inner, mbox.group_word_count(inl)
    elseif i == u2.idx and u2.inner ~= nil then
      desde_interno, hasta_interno = 1, u2.inner
    end
    local dentro = i >= u1.idx and i <= u2.idx
    if dentro and i == u1.idx then table.insert(salida, abrir()) end
    if desde_interno then
      table.insert(salida, envolver_grupo(inl, desde_interno, hasta_interno))
    elseif dentro and es_espacio(inl) then
      table.insert(salida, pandoc.RawInline('latex', ' '))
    else
      table.insert(salida, inl)
    end
    if dentro and i == u2.idx then table.insert(salida, cerrar()) end
  end
  return salida
end

local function aplicar_runt(inlines, cuantas)
  local lista = unidades(inlines)
  if #lista <= cuantas then return inlines end
  return envolver_rango(inlines, lista[#lista - cuantas + 1], lista[#lista])
end

local function envolver_palabras(inlines, objetivo)
  local salida = {}
  for _, c in ipairs(inlines) do
    local cls = mbox.classify(c)
    if cls == 'word' and c.text ~= nil then
      local nucleo, cola = c.text:match('^(.-)(%p*)$')
      if nucleo == objetivo then
        table.insert(salida, abrir())
        table.insert(salida, pandoc.Str(nucleo))
        table.insert(salida, cerrar())
        if cola ~= '' then table.insert(salida, pandoc.Str(cola)) end
      else
        table.insert(salida, c)
      end
    elseif cls == 'word-group' then
      c.content = envolver_palabras(c.content, objetivo)
      table.insert(salida, c)
    else
      table.insert(salida, c)
    end
  end
  return salida
end

local function aplicar_nohyph(inlines, lista)
  local salida = inlines
  for _, palabra in ipairs(lista) do
    if palabra ~= '' then salida = envolver_palabras(salida, palabra) end
  end
  return salida
end

local function procesar_bloques(bloques, cuantas, palabras)
  for i, bloque in ipairs(bloques) do
    if bloque.t == 'Para' then
      local inlines = bloque.content
      if cuantas > 0 then inlines = aplicar_runt(inlines, cuantas) end
      if palabras then inlines = aplicar_nohyph(inlines, palabras) end
      bloque.content = inlines
    elseif bloque.t == 'Div' or bloque.t == 'BlockQuote' then
      procesar_bloques(bloque.content, cuantas, palabras)
    end
  end
  return bloques
end

function Div(el)
  if FORMAT ~= 'latex' then return nil end
  local cuantas = tonumber(el.attributes['runt']) or 0
  local palabras
  if el.attributes['nohyph'] then
    palabras = {}
    for palabra in el.attributes['nohyph']:gmatch('%S+') do
      table.insert(palabras, palabra)
    end
    if #palabras == 0 then palabras = nil end
  end
  if cuantas <= 0 and palabras == nil then return nil end
  el.content = procesar_bloques(el.content, cuantas, palabras)
  return el
end
