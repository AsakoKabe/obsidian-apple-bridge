export class TAbstractFile {
  path: string;
  name: string;
  parent: TFolder | null = null;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export class TFile extends TAbstractFile {
  extension: string;
  basename: string;
  stat = { ctime: 0, mtime: 0, size: 0 };

  constructor(path: string) {
    super(path);
    const filename = path.split("/").pop() ?? path;
    const dotIdx = filename.lastIndexOf(".");
    this.extension = dotIdx >= 0 ? filename.slice(dotIdx + 1) : "";
    this.basename = dotIdx >= 0 ? filename.slice(0, dotIdx) : filename;
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot(): boolean {
    return this.path === "/";
  }
}

export class Notice {
  constructor(
    public message: string,
    _timeout?: number
  ) {}
}

export class Vault {}
/** Minimal HTMLElement-like object used by the status bar mock. */
export class MockStatusBarEl {
  textContent = "";
  style: Record<string, string> = {};
  private listeners: Record<string, (() => void)[]> = {};

  addClass(_cls: string) {}
  setAttribute(_name: string, _value: string) {}
  addEventListener(event: string, handler: () => void) {
    (this.listeners[event] ??= []).push(handler);
  }
  click() {
    for (const h of this.listeners["click"] ?? []) h();
  }
  remove() {}
}

export class Plugin {
  addStatusBarItem(): MockStatusBarEl {
    return new MockStatusBarEl();
  }
}
export class App {}
export class PluginSettingTab {}
export class Setting {
  constructor(_el: unknown) {}
  setName(_name: string) {
    return this;
  }
  setDesc(_desc: string) {
    return this;
  }
  addToggle(_cb: unknown) {
    return this;
  }
  addText(_cb: unknown) {
    return this;
  }
  addDropdown(_cb: unknown) {
    return this;
  }
}
