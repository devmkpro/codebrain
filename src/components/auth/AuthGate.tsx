import React from "react";

// AuthGate — open source build, no authentication required
export function AuthGate({ children }) {
  return <React.Fragment>{children}</React.Fragment>;
}