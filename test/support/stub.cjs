/*
 * The `obsidian` module stub and the workspace around it.
 *
 * Everything here is a behaviour-bearing fake, not a recording: menus collect
 * their items so tests can click them, modals register into `ctx` so prompts
 * can be answered, and the workspace really creates views through the plugin's
 * own `registerView` creator.
 */

require("./env.cjs");
const { TFile, TFolder } = require("./vault.cjs");
const Module = require("module");

const ctx = {
  notices: [],
  modals: [],
  menus: [],
  viewCreators: new Map(),
  views: [],
  leaves: [],
};

const app = {
  vault: null,
  workspace: null,
  setting: { open() {}, openTabById() {} },
  // Obsidian puts fileManager on the app, not on the vault. Delegating via
  // `app.vault` keeps it correct across the several vaults this test boots.
  fileManager: {
    renameFile: (file, newPath) => app.vault.rename(file, newPath),
    trashFile: (file) => app.vault.trash(file),
  },
};

class ItemView {
  constructor(leaf) {
    this.leaf = leaf;
    this.app = app;
    this.containerEl = window.document.createElement("div");
    this.contentEl = window.document.createElement("div");
    this.containerEl.appendChild(this.contentEl);
  }
  getViewType() {
    return "unknown";
  }
  getDisplayText() {
    return "unknown";
  }
  getIcon() {
    return "document";
  }
}

class Plugin {
  constructor(pluginApp, manifest) {
    this.app = pluginApp;
    this.manifest = manifest;
    this._data = null;
    this.commands = [];
    this.ribbonIcons = [];
    this.statusBarItems = [];
  }
  registerView(type, creator) {
    ctx.viewCreators.set(type, creator);
  }
  addRibbonIcon(icon, title, callback) {
    const el = window.document.createElement("div");
    el.setAttribute("data-icon", icon);
    el.setAttribute("aria-label", title);
    el.addEventListener("click", callback);
    this.ribbonIcons.push(el);
    return el;
  }
  addCommand(command) {
    this.commands.push(command);
    return command;
  }
  addSettingTab(tab) {
    this.settingTab = tab;
  }
  addStatusBarItem() {
    const el = window.document.createElement("div");
    this.statusBarItems.push(el);
    return el;
  }
  registerEvent(ref) {
    return ref;
  }
  registerDomEvent(el, type, callback) {
    el.addEventListener(type, callback);
  }
  async loadData() {
    return this._data;
  }
  async saveData(data) {
    this._data = JSON.parse(JSON.stringify(data));
  }
}

class PluginSettingTab {
  constructor(pluginApp, plugin) {
    this.app = pluginApp;
    this.plugin = plugin;
    this.containerEl = window.document.createElement("div");
  }
}

const { Setting } = require("./settings-stub.cjs");

class Modal {
  constructor(modalApp) {
    this.app = modalApp;
    this.contentEl = window.document.createElement("div");
    this.modalEl = window.document.createElement("div");
    this.scope = {
      handlers: {},
      register(_mods, key, fn) {
        this.handlers[key] = fn;
      },
    };
    ctx.modals.push(this);
  }
  open() {
    this.onOpen?.();
  }
  close() {
    this.onClose?.();
    this.closed = true;
  }
}

class Menu {
  constructor() {
    this.items = [];
    ctx.menus.push(this);
  }
  addItem(cb) {
    const item = {};
    const self = () => item;
    for (const name of ["setTitle", "setIcon", "setChecked", "setDisabled", "setWarning", "setSection"]) {
      item[name] = (value) => {
        item[name.slice(3).toLowerCase()] = value;
        return item;
      };
    }
    item.onClick = (fn) => {
      item.click = fn;
      return item;
    };
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() {
    this.items.push({ separator: true });
    return this;
  }
  showAtMouseEvent() {
    return this;
  }
  showAtPosition() {
    return this;
  }
}

const obsidianStub = {
  Plugin,
  ItemView,
  PluginSettingTab,
  Setting,
  Modal,
  Menu,
  TFile,
  TFolder,
  Notice: class Notice {
    constructor(message) {
      ctx.notices.push(String(message));
    }
  },
  setIcon: (el, icon) => {
    if (el) el.setAttribute("data-icon", icon);
  },
  normalizePath: (p) => p,
  Platform: { isDesktopApp: true, isMobile: false },
  debounce: (fn) => {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), 0);
    };
  },
};

const workspace = {
  activeLeaf: null,
  getLeavesOfType(type) {
    return ctx.leaves.filter((leaf) => leaf.view && leaf.view.getViewType?.() === type);
  },
  getLeaf() {
    const leaf = {
      view: null,
      async setViewState(state) {
        const creator = ctx.viewCreators.get(state.type);
        if (!creator) throw new Error(`no view registered for ${state.type}`);
        const view = creator(this);
        this.view = view;
        ctx.views.push(view);
        await view.onOpen?.();
        return this;
      },
    };
    ctx.leaves.push(leaf);
    workspace.activeLeaf = leaf;
    return leaf;
  },
  async revealLeaf(leaf) {
    workspace.activeLeaf = leaf;
    return leaf;
  },
  detachLeavesOfType(type) {
    ctx.leaves = ctx.leaves.filter((leaf) => leaf.view?.getViewType?.() !== type);
  },
  on() {
    return { id: "ws" };
  },
};

app.workspace = workspace;

/** Intercept `require("obsidian")` in the built artefact. Call once, early. */
function installModuleHook() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "obsidian") return obsidianStub;
    return originalLoad.call(this, request, parent, isMain);
  };
}

module.exports = { ctx, app, workspace, obsidianStub, installModuleHook };
