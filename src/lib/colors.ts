// Deterministic, not a hand-picked palette: confirmed roles alone span 8
// values today across ~20 possible ones, and traffic types span 20 distinct
// port_family values on confirmed-contacts edges — too many to maintain by
// hand, and a hardcoded map silently drops a new value into "unstyled"
// forever (what happened here before: a 3-entry ROLE_COLORS map meant a
// confirmed web_server or c2_server node looked identical to one with no
// confirmed role at all). A hash of the string is cheap, stable across
// reloads, and never missing an entry.
export function hueOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}
export function roleColor(role: string): { bg: string; border: string } {
  const hue = hueOf(`role:${role}`);
  return { bg: `hsl(${hue}, 55%, 14%)`, border: `hsl(${hue}, 70%, 60%)` };
}
export function familyColor(family: string): string {
  return `hsl(${hueOf(`family:${family}`)}, 65%, 58%)`;
}
