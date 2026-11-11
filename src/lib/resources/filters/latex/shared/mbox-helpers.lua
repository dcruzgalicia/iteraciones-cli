local M = {}

function M.classify(inl)
  if inl.t == 'Str' then
    if M.is_punct_str(inl.text) then return 'punct' end
    return 'word'
  end
  if inl.t == 'Space' or inl.t == 'SoftBreak' then return 'space' end
  if inl.t == 'Span' and inl.classes:find('uppercase', 1, true) then return 'word' end
  if inl.t == 'Emph' or inl.t == 'Strong' or inl.t == 'Underline' or inl.t == 'Superscript' or
     inl.t == 'Subscript' or inl.t == 'SmallCaps' or inl.t == 'Span' or inl.t == 'Link' or inl.t == 'Cite' or
     inl.t == 'Quoted' or inl.t == 'Mark' or inl.t == 'Strikeout' then
    return 'word-group'
  end
  return 'skip'
end

function M.group_word_count(inl)
  local n = 0
  for _, c in ipairs(inl.content) do
    local cls = M.classify(c)
    if cls == 'word' then
      n = n + 1
    elseif cls == 'word-group' then
      n = n + M.group_word_count(c)
    end
  end
  return n
end

function M.is_punct_str(text)
  return #text > 0 and text:match('^%p+$') ~= nil
end

return M
