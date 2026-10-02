export type ExplicitSkill = { name: string; description?: string };
type Reference = { start: number; end: number; name: string };

/** Dollar references in ordinary prose; escaped dollars and code spans are literal. */
function references(input: string): Reference[] {
  const found: Reference[] = [];
  let codeTicks = 0;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '`') {
      let count = 1;
      while (input[index + count] === '`') count++;
      if (!codeTicks) codeTicks = count;
      else if (codeTicks === count) codeTicks = 0;
      index += count - 1;
      continue;
    }
    if (codeTicks || char !== '$' || (index > 0 && !/[\s([{'"]/.test(input[index - 1]))) continue;
    let end = index + 1;
    if (input[end] && !/[A-Za-z\s]/.test(input[end])) continue;
    while (end < input.length && /[A-Za-z0-9_-]/.test(input[end])) end++;
    found.push({ start: index, end, name: input.slice(index + 1, end) });
    index = end - 1;
  }
  return found;
}

export const parseExplicitSkillNames = (input: string): string[] => [
  ...new Set(
    references(input)
      .map((ref) => ref.name)
      .filter(Boolean)
  ),
];

export function getActiveExplicitSkillQuery(input: string, caret = input.length): string | null {
  const reference = references(input).find((ref) => caret > ref.start && caret <= ref.end);
  return reference ? input.slice(reference.start + 1, caret) : null;
}

/** Replace the complete active token and preserve text on either side of the caret. */
export function insertExplicitSkill(
  input: string,
  name: string,
  caret = input.length
): { value: string; caret: number } {
  const reference = references(input).find((ref) => caret > ref.start && caret <= ref.end);
  if (!reference) return { value: input, caret };
  const token = `$${name}`;
  const suffix = input.slice(reference.end);
  const space = suffix.startsWith(' ') ? '' : ' ';
  return {
    value: `${input.slice(0, reference.start)}${token}${space}${suffix}`,
    caret: reference.start + token.length + 1,
  };
}

export function unknownExplicitSkills(input: string, skills: ExplicitSkill[] | undefined): string[] {
  const available = new Set((skills ?? []).map((skill) => skill.name));
  return parseExplicitSkillNames(input).filter((name) => !available.has(name));
}
