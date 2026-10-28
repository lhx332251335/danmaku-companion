import type { PageId } from "../constants";
import type { SettingsController } from "../useSettingsController";

/** Every page component receives the controller and a way to switch pages. */
export interface PageProps {
  controller: SettingsController;
  /** Switches page (updates location.hash), e.g. navigate("logs") for 查看日志. */
  navigate: (page: PageId) => void;
}
