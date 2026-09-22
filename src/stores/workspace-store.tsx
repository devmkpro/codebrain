import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appStorage } from "./persist-storage";

// useWorkspaceStore
export const useWorkspaceStore = create()(persist(set => ({
  path: null,
  config: {},
  setPath: path => set({
    path
  }),
  setConfig: config => set({
    config
  }),
  clear: () => set({
    path: null,
    config: {}
  })
}), {
  name: "codebrain-app-workspace",
  storage: appStorage
}));