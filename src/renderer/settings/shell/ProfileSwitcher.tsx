import { Check, ChevronsUpDown, CopyPlus, Layers, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { formatMonthDay } from "../format";
import type { SettingsController } from "../useSettingsController";

interface ProfileSwitcherProps {
  controller: SettingsController;
}

/**
 * 当前配置 button with a popover (role="dialog", not a menu, because it holds inputs):
 * switch, rename, copy and delete profiles. Switching and copying save the draft first.
 * Focus moves into the popover on open; Escape, an outside click or tabbing out closes it,
 * and Escape or a finished action returns focus to the button.
 */
export function ProfileSwitcher({ controller }: ProfileSwitcherProps) {
  const { profiles, activeProfile, profileBusy, profileWorking } = controller;
  const [open, setOpen] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [newName, setNewName] = useState("");
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const autoId = useId().replace(/:/g, "");
  const dialogId = `profiles-${autoId}`;
  const headingId = `${dialogId}-title`;
  const profileList = profiles?.profiles ?? [];
  const canDelete = profileList.length > 1;

  // Prefill the rename field with the active name each time the popover opens or the
  // active profile changes underneath it.
  useEffect(() => {
    if (open) setRenameText(activeProfile?.name ?? "");
  }, [open, activeProfile?.id, activeProfile?.name]);

  // Move focus inside on open: the active profile row, else the first control.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const target =
      dialog?.querySelector<HTMLElement>('[aria-current="true"]') ??
      dialog?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    target?.focus();
  }, [open]);

  // Outside click closes without moving focus (the click put it where the user wanted).
  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) {
      // After React re-enables the trigger.
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  async function handleSwitch(id: string) {
    if (id === profiles?.activeProfileId) {
      close(true);
      return;
    }
    setSwitchingId(id);
    const switched = await controller.switchProfile(id);
    setSwitchingId(null);
    if (switched) {
      close(true);
    }
  }

  async function handleRename(event: FormEvent) {
    event.preventDefault();
    await controller.renameProfile(renameText);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (await controller.createProfile(newName)) {
      setNewName("");
      close(true);
    }
  }

  async function handleDelete() {
    if (await controller.deleteProfile()) {
      close(true);
    }
  }

  const renameTrimmed = renameText.trim();
  const renameDisabled =
    !activeProfile || profileBusy || !renameTrimmed || renameTrimmed === activeProfile.name;
  const busyIcon = <LoaderCircle className="spin" aria-hidden="true" />;

  return (
    <div
      className="profile"
      ref={rootRef}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="profile-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        disabled={!profiles}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="profile-ico" aria-hidden="true">
          <Layers />
        </span>
        <span className="profile-t">
          <small>当前配置</small>
          <b>{activeProfile?.name ?? "—"}</b>
        </span>
        <span className="decor" aria-hidden="true">
          <ChevronsUpDown />
        </span>
      </button>

      {open ? (
        <div
          ref={dialogRef}
          id={dialogId}
          className="popover"
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close(true);
            }
          }}
        >
          <div className="pop-label">
            <h2 id={headingId}>切换配置</h2>
            <span>切换前自动保存</span>
          </div>
          <ul className="pop-list">
            {profileList.map((profile) => {
              const switching = profileWorking === "switch" && switchingId === profile.id;
              return (
                <li key={profile.id}>
                  <button
                    type="button"
                    className="pop-item"
                    aria-current={profile.active ? "true" : undefined}
                    disabled={profileBusy && !profile.active}
                    onClick={() => void handleSwitch(profile.id)}
                  >
                    <span className="pop-check" aria-hidden="true">
                      {switching ? busyIcon : profile.active ? <Check /> : null}
                    </span>
                    <span className="pop-name">{profile.name}</span>
                    <span className="pop-meta num">
                      {profile.active ? (
                        "当前"
                      ) : switching ? (
                        <span className="sr-only">切换中</span>
                      ) : (
                        <>
                          <span className="sr-only">更新于 </span>
                          {formatMonthDay(profile.updatedAt)}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="pop-sep" />
          <form onSubmit={(event) => void handleRename(event)}>
            <div className="pop-label">
              <label htmlFor={`${dialogId}-rename`}>重命名当前配置</label>
            </div>
            <div className="pop-form">
              <input
                id={`${dialogId}-rename`}
                className="input"
                value={renameText}
                disabled={!activeProfile || profileBusy}
                onChange={(event) => setRenameText(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                icon={profileWorking === "rename" ? busyIcon : <Pencil />}
                disabled={renameDisabled}
              >
                重命名
              </Button>
            </div>
          </form>
          <form onSubmit={(event) => void handleCreate(event)}>
            <div className="pop-label">
              <label htmlFor={`${dialogId}-new`}>复制为新配置</label>
            </div>
            <div className="pop-form">
              <input
                id={`${dialogId}-new`}
                className="input"
                value={newName}
                placeholder="基于当前配置"
                disabled={profileBusy}
                onChange={(event) => setNewName(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                icon={profileWorking === "create" ? busyIcon : <CopyPlus />}
                disabled={profileBusy}
              >
                新建
              </Button>
            </div>
          </form>

          <div className="pop-sep" />
          <button
            type="button"
            className="pop-item is-danger"
            disabled={profileBusy || !canDelete}
            title={canDelete ? undefined : "至少要保留一套配置"}
            onClick={() => void handleDelete()}
          >
            <span className="decor" aria-hidden="true">
              {profileWorking === "delete" ? busyIcon : <Trash2 />}
            </span>
            <span className="pop-name">删除“{activeProfile?.name ?? ""}”…</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
