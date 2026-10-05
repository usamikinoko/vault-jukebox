/*
 * Vault-path helpers. Vault paths always use "/" and never a leading slash;
 * the empty string is the vault root.
 */

export function parentPath(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

export function joinPath(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`;
}

/** Trim surrounding whitespace and slashes; "" is the vault root itself. */
export function cleanPath(p: string): string {
  return p.trim().replace(/^\/+|\/+$/g, "");
}

/** Lowercase extension without the dot; "" when the name has none. */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}
