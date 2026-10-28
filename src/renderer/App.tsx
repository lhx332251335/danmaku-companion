import { OverlayApp } from "./OverlayApp";
import { SettingsApp } from "./settings/SettingsApp";

export function App() {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "overlay" ? <OverlayApp /> : <SettingsApp />;
}
