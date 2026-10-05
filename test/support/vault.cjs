/*
 * The fake vault.
 *
 * Not a table of recorded answers: `rename`, `trash` and `createFolder` really
 * move nodes in the path index. That matters because the plugin decides where a
 * file belongs from its *path* — a rename that did not update `file.path` would
 * make half of the smoke assertions pass for the wrong reason.
 */

require("./env.cjs");

class TFile {
  constructor(filePath, size = 4096, mtime = 1_700_000_000_000) {
    this.path = filePath;
    this.name = filePath.split("/").pop();
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = (this.name.match(/\.([^.]+)$/) || [, ""])[1];
    this.stat = { size, mtime, ctime: mtime };
    this.parent = null;
  }
}

class TFolder {
  constructor(folderPath) {
    this.path = folderPath;
    this.name = folderPath === "/" ? "/" : folderPath.split("/").pop();
    this.children = [];
    this.parent = null;
  }
  isRoot() {
    return this.path === "/";
  }
}

class FakeVault {
  constructor(name = "TestVault") {
    this.name = name;
    this.root = new TFolder("/");
    this.byPath = new Map();
    this.trashed = [];
    this.handlers = new Map();
    this.adapter = {
      getFullPath: (p) => `C:/vault/${p}`,
      getBasePath: () => "C:/vault",
    };
  }

  // --- building a tree -----------------------------------------------------

  folder(folderPath) {
    if (this.byPath.has(folderPath)) return this.byPath.get(folderPath);
    let cursor = "";
    let parent = this.root;
    for (const segment of folderPath.split("/")) {
      cursor = cursor ? `${cursor}/${segment}` : segment;
      let node = this.byPath.get(cursor);
      if (!node) {
        node = new TFolder(cursor);
        node.parent = parent;
        parent.children.push(node);
        this.byPath.set(cursor, node);
      }
      parent = node;
    }
    return parent;
  }

  file(filePath, size = 4096) {
    const file = new TFile(filePath, size);
    const parentPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    const parent = parentPath ? this.folder(parentPath) : this.root;
    file.parent = parent;
    parent.children.push(file);
    this.byPath.set(filePath, file);
    return file;
  }

  // --- Vault API ----------------------------------------------------------

  getRoot() {
    return this.root;
  }
  getName() {
    return this.name;
  }
  getAbstractFileByPath(p) {
    if (!p) return null;
    return this.byPath.get(p) ?? null;
  }
  getResourcePath(file) {
    return `app://testvault/${file.path}`;
  }
  getAllLoadedFiles() {
    return [...this.byPath.values()];
  }
  getFiles() {
    return [...this.byPath.values()].filter((n) => n instanceof TFile);
  }
  async createFolder(p) {
    const node = this.folder(p);
    this.emit("create", node);
    return node;
  }
  async createBinary(p, data) {
    const file = this.file(p);
    file.size = data.byteLength;
    this.emit("create", file);
    return file;
  }
  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    return { id: `evt-${event}`, event };
  }
  off(event, handler) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event, ...args) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  // --- mutations ----------------------------------------------------------

  /** Moves a node (and a folder's whole subtree) and rewrites every path. */
  rename(node, newPath) {
    const oldPath = node.path;
    const isFolder = node instanceof TFolder;

    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    this.byPath.delete(oldPath);

    const parentPath = newPath.includes("/") ? newPath.slice(0, newPath.lastIndexOf("/")) : "";
    const parent = parentPath ? this.folder(parentPath) : this.root;
    node.parent = parent;
    parent.children.push(node);
    node.path = newPath;
    node.name = newPath.split("/").pop();
    if (!isFolder) {
      node.basename = node.name.replace(/\.[^.]+$/, "");
      node.extension = (node.name.match(/\.([^.]+)$/) || [, ""])[1];
    }
    this.byPath.set(newPath, node);

    if (isFolder) {
      for (const child of [...node.children]) this.rebase(child, oldPath, newPath);
    }
    this.emit("rename", node, oldPath);
    return node;
  }

  rebase(node, oldPrefix, newPrefix) {
    this.byPath.delete(node.path);
    node.path = node.path.replace(oldPrefix, newPrefix);
    this.byPath.set(node.path, node);
    if (node instanceof TFolder) {
      for (const child of node.children) this.rebase(child, oldPrefix, newPrefix);
    }
  }

  trash(node) {
    const isFolder = node instanceof TFolder;
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    this.byPath.delete(node.path);
    if (isFolder) {
      for (const child of [...node.children]) this.trash(child);
    } else {
      this.trashed.push(node.path);
    }
    this.emit("delete", node);
    return true;
  }
}

/** The standard fixture every smoke group starts from. */
function makeVault() {
  const vault = new FakeVault();
  vault.folder("music/Rock");
  vault.folder("music/Jazz");
  vault.folder("music/deep/ignored"); // second level: must never become a playlist
  vault.file("music/Rock/夜曲_周杰伦.mp3", 5_000_000);
  vault.file("music/Rock/A_B_C.flac", 30_000_000);
  vault.file("music/Rock/broken.wma", 2_000_000);
  vault.file("music/Jazz/So What_Miles Davis.mp3", 8_000_000);
  vault.file("music/Jazz/notes.md"); // not audio
  vault.file("music/deep/ignored/buried.mp3"); // too deep to be seen
  vault.file("music/Loose.mp3"); // sitting in the root: swept into default
  return vault;
}

module.exports = { TFile, TFolder, FakeVault, makeVault };
