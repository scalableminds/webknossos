export function generateRandomCuckooEntrySet<K, V>(
  generateEntry: () => [K, V],
  count: number = 1600,
) {
  const set = new Set();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const entry = generateEntry();
    const entryKey = entry[0];
    if (set.has(entryKey)) {
      i--;
      continue;
    }
    set.add(entryKey);
    entries.push(entry);
  }
  return entries;
}
