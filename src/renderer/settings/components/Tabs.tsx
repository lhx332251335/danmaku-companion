import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Small trailing content, e.g. <Chip size="sm">空</Chip>. */
  badge?: ReactNode;
}

export interface TabsProps<T extends string> {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Prefix for the tab and panel ids; pair with <TabPanel idPrefix=…>. */
  idPrefix: string;
  "aria-label": string;
  className?: string;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const tabPanelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * WAI-ARIA tabs with a roving tabindex: only the selected tab is in the tab order; arrow
 * keys, Home and End move and select.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
  "aria-label": ariaLabel,
  className,
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  function focusTab(index: number) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.id);
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(idPrefix, tab.id))}`)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.id === value);
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusTab(moves[event.key]);
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={["tabs", className].filter(Boolean).join(" ")}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            className="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idPrefix: string;
  id: string;
  className?: string;
  children: ReactNode;
}

/** The panel of the selected tab (render only the selected one). */
export function TabPanel({ idPrefix, id, className, children }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idPrefix, id)}
      aria-labelledby={tabId(idPrefix, id)}
      className={className}
    >
      {children}
    </div>
  );
}
