function normalizeFragment(fragment: string) {
  return fragment
    .replace(/^[-*]\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^(prompt|response|source):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractJsonCandidates(raw: string): string[] {
  const candidates = new Set<string>();
  const trimmed = raw.trim();

  if (trimmed) {
    candidates.add(trimmed);
  }

  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fenced = match[1]?.trim();
    if (fenced) {
      candidates.add(fenced);
    }
  }

  const firstArray = raw.indexOf('[');
  const lastArray = raw.lastIndexOf(']');
  if (firstArray !== -1 && lastArray > firstArray) {
    candidates.add(raw.slice(firstArray, lastArray + 1).trim());
  }

  const firstObject = raw.indexOf('{');
  const lastObject = raw.lastIndexOf('}');
  if (firstObject !== -1 && lastObject > firstObject) {
    candidates.add(raw.slice(firstObject, lastObject + 1).trim());
  }

  return [...candidates];
}

export function collectStudyFragments(sourceText: string, maxItems = 8): string[] {
  const fromLines = sourceText.split(/\n+/);
  const fromSentences = sourceText.split(/[.!?](?:\s+|$)/);
  const fragments = [...fromLines, ...fromSentences]
    .map(normalizeFragment)
    .filter((fragment) => fragment.length > 12);

  return [...new Set(fragments)].slice(0, maxItems);
}
