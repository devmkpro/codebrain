import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fileKey } from "../components/files/FileTree";

// useEditorStore
export const useEditorStore = create(set => ({
  files: [],
  activeKey: null,
  open: (workspacePath, relPath, content) => {
    const key = fileKey(workspacePath, relPath);
    set(s => {
      if (s.files.some(f => fileKey(f.workspacePath, f.relPath) === key)) {
        return {
          activeKey: key
        };
      }
      return {
        files: [...s.files, {
          workspacePath,
          relPath,
          content,
          dirty: false
        }],
        activeKey: key
      };
    });
  },
  close: key => set(s => {
    const files = s.files.filter(f => fileKey(f.workspacePath, f.relPath) !== key);
    const activeKey = s.activeKey === key ? files.length > 0 ? fileKey(files[files.length - 1].workspacePath, files[files.length - 1].relPath) : null : s.activeKey;
    return {
      files,
      activeKey
    };
  }),
  setActive: key => set({
    activeKey: key
  }),
  setContent: (key, content) => set(s => ({
    files: s.files.map(f => fileKey(f.workspacePath, f.relPath) === key ? {
      ...f,
      content,
      dirty: true
    } : f)
  })),
  markSaved: key => set(s => ({
    files: s.files.map(f => fileKey(f.workspacePath, f.relPath) === key ? {
      ...f,
      dirty: false
    } : f)
  }))
}));