import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Profile panels use CSS paint containment to keep repeated tab switches from
 * accumulating glyph compositing. Fixed overlays must leave that containing
 * block or they are positioned and clipped against the full profile panel.
 */
export function ProfileModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
