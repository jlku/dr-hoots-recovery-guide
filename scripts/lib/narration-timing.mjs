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

export function wordTimings(record) {
  const characters = flattenRecordCharacters(record);
  return [...record.text.matchAll(/\S+/g)].map((match) => {
    const first = match.index;
    const last = first + match[0].length - 1;
    return { text: match[0], charStart: first, start: characters[first].start, end: characters[last].end };
  });
}
