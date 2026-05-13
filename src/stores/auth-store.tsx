import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// useAuthStore
export const useAuthStore = create(set => ({
  email: null,
  setEmail: email => set({
    email
  })
}));