/*
 * One way to reach Node from the renderer.
 *
 * Kept in its own module with no `obsidian` import on purpose: the dialog and
 * copy helpers are used by the smoke test's fake environment too, and pulling
 * in the Obsidian package (whose npm entry point is empty) would break that.
 *
 * Electron exposes Node as `window.require`; a plain Node process has the bare
 * global instead. Both paths are needed, and both are desktop-only.
 */

export function nodeRequire<T = unknown>(name: string): T {
  const w =
    typeof window !== "undefined"
      ? (window as unknown as { require?: (m: string) => unknown })
      : null;
  const req = w?.require ?? (typeof require === "function" ? require : null);
  if (!req) throw new Error(`需要桌面版 Obsidian：无法加载 Node 模块 "${name}"。`);
  return req(name) as T;
}
