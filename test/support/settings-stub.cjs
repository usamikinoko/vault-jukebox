/*
 * The settings-page stubs: a chainable control API and a `Setting` that
 * really renders into the host, so tests can assert on what the page says.
 */

require("./env.cjs");

/** A control API whose setters chain, as Obsidian's do. */
function chained(extra = {}) {
  const api = { ...extra };
  const self = () => api;
  for (const name of [
    "setValue",
    "setLimits",
    "setDynamicTooltip",
    "setPlaceholder",
    "setWarning",
    "setDisabled",
    "setIcon",
    "setTooltip",
    "setCta",
    "addOption",
  ]) {
    api[name] = self;
  }
  api.onChange = self;
  api.onClick = self;
  return api;
}

function textControl(parent) {
  const inputEl = window.document.createElement("input");
  parent.appendChild(inputEl);
  return chained({ inputEl });
}
function buttonControl(parent) {
  const buttonEl = window.document.createElement("button");
  parent.appendChild(buttonEl);
  const api = chained({ buttonEl });
  api.setButtonText = (t) => {
    buttonEl.setText(t);
    return api;
  };
  api.onClick = (fn) => {
    buttonEl.addEventListener("click", fn);
    return api;
  };
  return api;
}

/** Renders into the host so tests can assert on what the settings page says. */
class Setting {
  constructor(host) {
    const settingEl = window.document.createElement("div");
    settingEl.addClass("setting-item");
    const nameEl = window.document.createElement("div");
    nameEl.addClass("setting-item-name");
    const descEl = window.document.createElement("div");
    descEl.addClass("setting-item-description");
    const controlEl = window.document.createElement("div");
    controlEl.addClass("setting-item-control");
    settingEl.appendChild(nameEl);
    settingEl.appendChild(descEl);
    settingEl.appendChild(controlEl);
    if (host) host.appendChild(settingEl);

    const api = chained({ settingEl, nameEl, descEl, controlEl });
    api.setName = (t) => {
      nameEl.setText(t);
      return api;
    };
    api.setDesc = (t) => {
      descEl.setText(t);
      return api;
    };
    api.addText = (cb) => {
      cb(textControl(controlEl));
      return api;
    };
    api.addToggle = (cb) => {
      const inputEl = window.document.createElement("input");
      controlEl.appendChild(inputEl);
      cb(chained({ toggleEl: inputEl }));
      return api;
    };
    api.addSlider = (cb) => {
      const inputEl = window.document.createElement("input");
      controlEl.appendChild(inputEl);
      cb(chained({ sliderEl: inputEl }));
      return api;
    };
    api.addDropdown = (cb) => {
      const selectEl = window.document.createElement("select");
      controlEl.appendChild(selectEl);
      cb(chained({ selectEl }));
      return api;
    };
    api.addButton = (cb) => {
      cb(buttonControl(controlEl));
      return api;
    };
    api.addExtraButton = (cb) => {
      cb(buttonControl(controlEl));
      return api;
    };
    return api;
  }
}


module.exports = { chained, Setting };
