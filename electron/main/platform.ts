import { app } from "electron";

export const is = {
  dev: !app.isPackaged,
};

export const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux",
};
