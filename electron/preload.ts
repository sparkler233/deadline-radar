import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("deadlineRadar", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:save", settings),
  listItems: () => ipcRenderer.invoke("items:list"),
  saveItems: (items: unknown) => ipcRenderer.invoke("items:save", items),
  parseText: (input: unknown) => ipcRenderer.invoke("parser:parse-text", input),
  checkLarkCli: (settings: unknown) => ipcRenderer.invoke("lark:check", settings),
  startLarkAuth: (settings: unknown) => ipcRenderer.invoke("lark:start-auth", settings),
  syncItem: (item: unknown, settings: unknown) => ipcRenderer.invoke("lark:sync-item", item, settings),
  getAppInfo: () => ipcRenderer.invoke("app:info")
});
