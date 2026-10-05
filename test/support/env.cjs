/*
 * Headless DOM: the one-time environment every other support module assumes.
 *
 * jsdom stands in for the Obsidian window; the element-prototype shims are the
 * exact set Obsidian patches onto every element — a missing one shows up as an
 * unreadable `e.hasClass is not a function` deep inside minified output.
 *
 * Requiring this module is idempotent (Node caches it); it must simply come
 * before anything that touches `window` or `document`.
 */

const assert = require("assert");
const { JSDOM, VirtualConsole } = require("jsdom");

// jsdom has no media pipeline at all, so `play()`/`load()` raise "not
// implemented" on the virtual console. The plugin already treats that as
// "headless, nothing to do"; swallowing it here keeps the test output readable.
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", () => {});

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "app://obsidian.md/index.html",
  virtualConsole,
});
const { window } = dom;

global.window = window;
global.document = window.document;
global.HTMLElement = window.HTMLElement;
global.Element = window.Element;
global.Node = window.Node;
global.Image = window.Image;
global.Audio = window.Audio;
global.navigator = window.navigator;
global.getComputedStyle = window.getComputedStyle.bind(window);
window.require = () => null; // no Electron in here

const proto = window.Element.prototype;
proto.empty = function () {
  while (this.firstChild) this.removeChild(this.firstChild);
  return this;
};
proto.addClass = function (...names) {
  for (const chunk of names) {
    for (const name of String(chunk).split(/\s+/)) if (name) this.classList.add(name);
  }
  return this;
};
proto.removeClass = function (...names) {
  for (const chunk of names) {
    for (const name of String(chunk).split(/\s+/)) if (name) this.classList.remove(name);
  }
  return this;
};
proto.toggleClass = function (name, on) {
  if (on === undefined) this.classList.toggle(name);
  else if (on) this.classList.add(name);
  else this.classList.remove(name);
  return this;
};
proto.hasClass = function (name) {
  return this.classList.contains(name);
};
proto.setText = function (text) {
  this.textContent = String(text);
  return this;
};
proto.setAttr = function (name, value) {
  if (value === null || value === undefined) this.removeAttribute(name);
  else this.setAttribute(name, String(value));
  return this;
};
proto.getAttr = function (name) {
  return this.getAttribute(name);
};
proto.createEl = function (tag, options, callback) {
  const el = this.ownerDocument.createElement(tag);
  if (typeof options === "string") el.className = options;
  else if (options) {
    if (options.cls) el.className = options.cls;
    if (options.text !== undefined) el.textContent = String(options.text);
    if (options.type) el.setAttribute("type", options.type);
    if (options.placeholder) el.setAttribute("placeholder", options.placeholder);
    if (options.value !== undefined) el.setAttribute("value", String(options.value));
    if (options.title) el.setAttribute("title", options.title);
    if (options.attr) {
      for (const [k, v] of Object.entries(options.attr)) el.setAttribute(k, String(v));
    }
  }
  this.appendChild(el);
  if (callback) callback(el);
  return el;
};
proto.createDiv = function (options, callback) {
  return this.createEl("div", options, callback);
};
proto.createSpan = function (options, callback) {
  return this.createEl("span", options, callback);
};
proto.detach = function () {
  this.remove();
  return this;
};

assert.ok(proto.createEl, "DOM shims installed");

module.exports = { window, dom };
