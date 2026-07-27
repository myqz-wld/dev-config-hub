import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Persistent profile panels switch with display:none and keep their local UI
 * state. Fixed overlays live directly under body so panel layout and scrolling
 * can never become their positioning or clipping boundary.
 */
export function ProfileModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
