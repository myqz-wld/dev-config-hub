import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ProfileModalPortal } from "./ProfileModalPortal.tsx";

describe("ProfileModalPortal", () => {
  afterEach(() => cleanup());

  it("mounts fixed overlays directly under body instead of the persistent panel host", () => {
    const host = document.createElement("div");
    host.className = "panel-host";
    document.body.append(host);

    const { container } = render(
      <ProfileModalPortal>
        <div className="modal-backdrop" data-testid="profile-overlay" />
      </ProfileModalPortal>,
      { container: host },
    );

    const overlay = document.querySelector<HTMLElement>("[data-testid='profile-overlay']");
    expect(container.querySelector("[data-testid='profile-overlay']")).toBeNull();
    expect(overlay?.parentElement).toBe(document.body);
  });
});
