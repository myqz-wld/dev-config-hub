export type DoodleIconKind = "switch" | "warning";

export function DoodleIcon({ kind }: { kind: DoodleIconKind }) {
  return (
    <svg
      className={`doodle-icon doodle-${kind}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {renderDoodle(kind)}
    </svg>
  );
}

function renderDoodle(kind: DoodleIconKind) {
  switch (kind) {
    case "switch":
      return (
        <>
          <path d="M5.2 8.4c2.9-1.9 7.1-2 10.1-.6" />
          <path d="M13.5 4.7c1.1.9 2.1 1.9 3 3-1.1.8-2.2 1.5-3.5 2.2" />
          <path d="M18.9 15.3c-2.8 1.9-7.2 2.1-10.1.7" />
          <path d="M10.6 19.2c-1.1-.8-2.2-1.8-3.1-3 1.1-.8 2.3-1.6 3.5-2.2" />
        </>
      );
    case "warning":
      return (
        <>
          <path d="M11.5 4.2c2.5 4.4 4.7 8.5 6.7 12.8-4.8.5-9.1.4-13.2-.1 2.1-4.2 4.1-8.3 6.5-12.7Z" />
          <path d="M12 8.5c-.1 1.8-.2 3.3-.1 4.8" />
          <line x1="12" y1="16.2" x2="12.1" y2="16.3" />
        </>
      );

  }
}
