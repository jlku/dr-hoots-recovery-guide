// Word and character timing derived from an ElevenLabs manifest record.
// The activation pipeline has a private equivalent; it is frozen and does not
// export it, so this small module is the v2 source of truth for timing.

export function flattenRecordCharacters(record) {
  if (!record || typeof record.text !== "string") throw new Error("narration record needs text");
  const groups = Array.isArray(record.timestamps) ? record.timestamps : [];
  const characters = groups.flatMap((group) =>
    (group.characters ?? []).map((character, index) => ({
      character,
      start: group.character_start_times_seconds?.[index],
      end: group.character_end_times_seconds?.[index]
    }))
  );
  const flattened = characters.map((entry) => entry.character).join("");
  if (flattened !== record.text) {
    throw new Error(`narration record ${record.id} timestamps do not match its text`);
  }
  for (const entry of characters) {
    if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end < entry.start) {
      throw new Error(`narration record ${record.id} has a malformed timestamp`);
    }
  }
  return characters;
}

export function speechEndSeconds(record) {
  const characters = flattenRecordCharacters(record);
  return characters.length ? Math.max(...characters.map((entry) => entry.end)) : 0;
}

// Languages written without spaces between words. Their words come from the ICU segmenter.
export function isSpacelessLanguage(language) {
  return /^(zh|ja)(-|$)/.test(language ?? "");
}

// Tokens of the spoken text with their character offsets and whether a space follows. Spaced
// languages split on whitespace. Chinese is split into words, and punctuation stays on the word
// before it so no caption line starts with a comma.
export function tokenize(text, language = "en") {
  if (!isSpacelessLanguage(language)) {
    return [...text.matchAll(/\S+/g)].map((match) => ({ text: match[0], index: match.index, space: /\s/.test(text[match.index + match[0].length] ?? "") }));
  }
  const tokens = [];
  for (const part of new Intl.Segmenter(language, { granularity: "word" }).segment(text)) {
    if (/^\s+$/.test(part.segment)) {
      if (tokens.length) tokens.at(-1).space = true;
      continue;
    }
    const previous = tokens.at(-1);
    if (!part.isWordLike && previous && !previous.space) {
      previous.text += part.segment;
      continue;
    }
    tokens.push({ text: part.segment, index: part.index, space: false });
  }
  if (tokens.length) tokens.at(-1).space = false;
  return tokens;
}

export function wordTimings(record, language = "en") {
  const characters = flattenRecordCharacters(record);
  return tokenize(record.text, language).map((token) => {
    const last = token.index + token.text.length - 1;
    return { text: token.text, charStart: token.index, start: characters[token.index].start, end: characters[last].end, space: token.space };
  });
}
