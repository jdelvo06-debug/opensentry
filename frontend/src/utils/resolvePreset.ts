// frontend/src/utils/resolvePreset.ts

export interface AliasEntry {
  id: string;
  aliases: string[];
  baseFile: string;
}

/**
 * Normalize a string for comparison: lowercase, strip non-alphanumeric (keep spaces), trim.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * Check whether `aliasNorm` is a meaningful match within `nameNorm`.
 *
 * Matching rules (must satisfy at least one):
 *  1. The alias appears at the START of the location name.
 *     e.g. alias="shaw afb" matches "shaw afb south carolina" (starts with "shaw afb")
 *  2. The alias appears as a whole word/phrase boundary in the name — it must be
 *     preceded by a space (or start) AND followed by a space (or end).
 *     e.g. alias="kssc" matches "kssc shaw afb" but NOT "ksscx"
 *
 * This prevents loose substring matches like "shaw" matching "Shaw, Bolivar County"
 * because after normalization "shaw bolivar county" does NOT start with "shaw" alone
 * (it starts with "shaw" but then has "bolivar" immediately — since the alias "shaw"
 * is not followed by end-of-string, and "shaw" isn't the full start of a longer phrase
 * that continues with a non-base word, we rely on the alias list being specific enough).
 *
 * Actually, the key insight: single-word aliases like "shaw" are inherently ambiguous.
 * The alias list should use multi-word aliases like "shaw afb", "shaw air force base",
 * "shaw south carolina" to avoid false positives. But we still need to handle the
 * single-word case safely: a single-word alias only matches if it's the ENTIRE first
 * token of the location name (i.e., the name is just that word, or starts with that word
 * AND the next character is a space followed by something that looks base-related).
 *
 * Simpler approach: match if alias matches start-of-name OR alias is a whole-word match
 * in the name. A single-word alias like "shaw" will match "shaw afb" (start of name)
 * but NOT "shaw bolivar county" because... actually "shaw" IS at the start there too.
 *
 * Final approach: We rank matches. Multi-word aliases are preferred. A single-word alias
 * only counts if there's no more specific multi-word alias that also matches — but that
 * gets complex. Instead, the simplest fix: a single-word alias only matches if the
 * location name starts with it AND the next word (if any) is a known military/base
 * indicator OR the alias is the entire name. But that's fragile.
 *
 * Simplest robust approach: require that the alias matches either:
 *   (a) The entire normalized name (exact match), OR
 *   (b) The start of the normalized name, AND the alias ends with a space or the
 *       name character right after the alias is a space (word boundary on the right).
 *
 * Wait — (b) already handles it. "shaw" at start of "shaw afb south carolina" — the
 * character after "shaw" is a space → word boundary → match. "shaw" at start of
 * "shaw bolivar county" — char after "shaw" is also a space → also matches. That's
 * still too loose.
 *
 * The real fix: sort aliases longest-first. A single-word alias like "shaw" should only
 * be used as a fallback if no longer alias (e.g. "shaw afb", "shaw air force base")
 * matched. But we're iterating all aliases for a given entry, so if ANY alias matches
 * we return that entry. The problem is "shaw" matching "Shaw, Bolivar County".
 *
 * Final strategy: for an alias to match, it must satisfy ONE of:
 *   1. The alias is >= 2 words (multi-word) AND appears at the start of the name
 *      with a word boundary on the right.
 *   2. The alias is 1 word AND it is an EXACT match with the entire name.
 *   3. The alias (any length) appears somewhere in the name as a whole-phrase match
 *      with word boundaries on BOTH sides.
 *
 * This way "shaw afb" (2 words) matches "shaw afb south carolina" (rule 1).
 * "kssc" (1 word) matches "kssc" exactly (rule 2) or "kssc shaw afb" (rule 3 —
 * "kssc" at start with space after = word boundary both sides).
 * But "shaw" (1 word) does NOT match "shaw bolivar county" because rule 2 requires
 * exact match (fails) and rule 3 requires "shaw" to be surrounded by word boundaries —
 * at the start it has a left boundary but the right is a space which IS a boundary...
 * Hmm, that still matches.
 *
 * OK — I think the cleanest approach is: single-word aliases are inherently risky.
 * The real solution is to be strict: an alias matches only if it appears at the START
 * of the normalized name AND the alias length is a substantial portion of the name,
 * OR if it's a complete phrase match within the name.
 *
 * Let me just go with the simplest effective approach that the spec suggests:
 * - Check if the alias matches the START of the location name
 * - OR if the location name contains the alias as a whole word/phrase (word boundaries)
 * - BUT: for single-word aliases, require the alias to be the EXACT complete first
 *   "segment" (comma-separated part) of the location name, OR the alias must appear
 *   with additional qualifying words.
 *
 * Actually, re-reading the spec more carefully:
 * "check if any alias matches the START of the location name, or if the location name
 *  contains the alias as a whole word/phrase (not just a substring)"
 *
 * The key is "whole word/phrase". For multi-word aliases like "shaw afb", matching
 * "Shaw AFB, South Carolina" is fine because "shaw afb" is a complete phrase at the
 * start. For "Shaw, Bolivar County", the normalized name is "shaw bolivar county".
 * "shaw afb" is NOT in there. "shaw" is there but only as a single word, and since
 * the alias list has more specific aliases, the single-word "shaw" would need to be
 * evaluated carefully.
 *
 * I think the right approach: longest-match-wins. Try each alias; if it matches as a
 * whole phrase at the start or within the name, it's a hit. Process longer aliases
 * first so "shaw afb" beats "shaw". If only "shaw" matches (no longer alias matched),
 * then "shaw" alone IS too ambiguous — but looking at the alias data, "shaw" IS in the
 * alias list. The spec says it should NOT match "Shaw, Bolivar County".
 *
 * So for a single-word alias, we need an additional constraint: it must match the
 * ENTIRE first comma-separated segment. "Shaw" as a segment in "Shaw, Bolivar County"
 * — normalized first segment = "shaw" → exact match with alias "shaw" → would match.
 *
 * Hmm. Let me re-read the spec hints more carefully:
 * "aliases like 'shaw afb', 'shaw air force base', 'kssc', 'shaw south carolina'
 *  should match the real base result but NOT generic 'Shaw' city results from Nominatim"
 *
 * So the intent is: when Nominatim returns "Shaw Air Force Base, South Carolina",
 * aliases "shaw afb" and "shaw air force base" match it. When Nominatim returns
 * "Shaw, Bolivar County, Mississippi", the alias "shaw" should NOT match it because
 * it's a city, not the base.
 *
 * The distinguishing factor: base results have qualifying terms like "afb", "air force
 * base", "south carolina" attached to "shaw". City results have generic terms like
 * county, state names without military indicators.
 *
 * Approach: sort aliases longest-first. First match wins. Since "shaw air force base"
 * and "shaw afb" are longer, they'll match before "shaw" when the Nominatim result
 * is the actual base. For city results like "Shaw, Bolivar County", none of the longer
 * aliases match, and we DON'T want "shaw" alone to match.
 *
 * So the rule should be: single-word aliases must match the ENTIRE normalized name
 * (exact match). This prevents "shaw" from matching "shaw bolivar county" while
 * still allowing "kssc" to match exactly "kssc" if someone types that.
 *
 * But wait — "shaw" matching exactly the entire name... Nominatim won't return just
 * "Shaw" — it'll return "Shaw, Mississippi, United States" or similar. So in practice,
 * "shaw" as a single-word alias will almost never match anything, which is fine because
 * the multi-word aliases cover the real base.
 *
 * Final rule:
 * - Multi-word alias: matches if it appears at the START of the normalized name
 *   (word boundary on the right, i.e., alias ends at end-of-string or next char is space)
 * - Single-word alias: matches ONLY if it equals the ENTIRE normalized name exactly
 */

function isMatch(nameNorm: string, aliasNorm: string): boolean {
  if (!aliasNorm) return false;

  const wordCount = aliasNorm.split(/\s+/).length;

  if (wordCount >= 2) {
    // Multi-word alias: must appear at start of name with word boundary on the right
    if (nameNorm.startsWith(aliasNorm)) {
      const nextChar = nameNorm[aliasNorm.length];
      if (!nextChar || nextChar === " ") {
        return true;
      }
    }
    // Also check: alias appears as whole phrase somewhere in the name (bounded)
    // e.g., "aviano italy" in "comune di aviano italy province of pudova"
    const idx = nameNorm.indexOf(aliasNorm);
    if (idx !== -1) {
      const leftOk = idx === 0 || nameNorm[idx - 1] === " ";
      const rightIdx = idx + aliasNorm.length;
      const rightOk = rightIdx === nameNorm.length || nameNorm[rightIdx] === " ";
      if (leftOk && rightOk) return true;
    }
    return false;
  }

  // Single-word alias: exact match with entire name only
  return nameNorm === aliasNorm;
}

/**
 * Resolve a location name against a list of preset aliases.
 *
 * @param locationName - The display name from Nominatim (e.g., "Shaw AFB, South Carolina")
 * @param aliases - The preset alias entries to match against
 * @returns The matching AliasEntry or null
 */
export function resolvePreset(
  locationName: string,
  aliases: AliasEntry[],
): AliasEntry | null {
  const nameNorm = normalize(locationName);

  // Sort all alias entries' aliases longest-first to prefer specific matches
  // We check all aliases across all entries, returning the first (longest) match
  const candidates: { entry: AliasEntry; alias: string; aliasNorm: string; len: number }[] = [];
  for (const entry of aliases) {
    for (const alias of entry.aliases) {
      const aliasNorm = normalize(alias);
      candidates.push({ entry, alias, aliasNorm, len: aliasNorm.length });
    }
  }
  // Longest alias first — prefer "shaw air force base" over "shaw afb" over "shaw"
  candidates.sort((a, b) => b.len - a.len);

  for (const c of candidates) {
    if (isMatch(nameNorm, c.aliasNorm)) {
      return c.entry;
    }
  }

  return null;
}