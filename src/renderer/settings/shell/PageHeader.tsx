import { Check, Save, Undo2 } from "lucide-react";
import { Button } from "../components/Button";
import type { PageMeta } from "../constants";
import type { SettingsController } from "../useSettingsController";

interface PageHeaderProps {
  meta: PageMeta;
  controller: SettingsController;
}

/**
 * h1 + one-line description. Right side: with unsaved edits 「● 有未保存的修改」 + 还原 + 保存
 * (Ctrl S); otherwise a quiet 「✓ 已保存」.
 */
export function PageHeader({ meta, controller }: PageHeaderProps) {
  const { dirty, saving, isMac } = controller;
  const shortcut = isMac ? "⌘S" : "Ctrl S";

  return (
    <header className="page-head">
      <div className="page-titles">
        <h1 id="page-title">{meta.title}</h1>
        <p title={meta.description}>{meta.description}</p>
      </div>
      {dirty || saving ? (
        <>
          <span className="save-state" role="status">
            有未保存的修改
          </span>
          <Button
            variant="subtle"
            icon={<Undo2 />}
            disabled={saving}
            title="放弃未保存的修改，恢复到已保存的设置"
            onClick={controller.revert}
          >
            还原
          </Button>
          <Button
            variant="primary"
            className="save-btn"
            icon={<Save />}
            busy={saving}
            busyLabel="保存中"
            aria-keyshortcuts={isMac ? "Meta+S" : "Control+S"}
            onClick={() => void controller.save()}
          >
            保存
            <kbd aria-hidden="true">{shortcut}</kbd>
          </Button>
        </>
      ) : (
        <Button className="save-btn is-saved" icon={<Check />} disabled>
          已保存
        </Button>
      )}
    </header>
  );
}
