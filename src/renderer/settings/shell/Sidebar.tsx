import { Lock } from "lucide-react";
import iconUrl from "../../assets/icon-64.png";
import { Badge } from "../components/Chip";
import { PAGES, type PageId, type PageMeta, type SettingsPageId } from "../constants";
import type { SettingsController } from "../useSettingsController";
import { ProfileSwitcher } from "./ProfileSwitcher";

interface SidebarProps {
  controller: SettingsController;
  page: PageId;
}

const groups: Array<{ id: PageMeta["group"]; label: string }> = [
  { id: "live", label: "实时" },
  { id: "settings", label: "设置" },
];

/** Brand, profile switcher, the two nav groups and the local-only note. */
export function Sidebar({ controller, page }: SidebarProps) {
  const { dirtyPages, logs, status } = controller;

  function trailing(item: PageMeta) {
    if (item.id === "logs") {
      return logs.length > 0 ? <Badge label={`${logs.length} 条日志`}>{logs.length}</Badge> : null;
    }
    if (item.id === "overview") {
      return status.lastError ? (
        <>
          <span className="nav-dot is-error" aria-hidden="true" />
          <span className="sr-only">（上一轮失败）</span>
        </>
      ) : null;
    }
    return dirtyPages[item.id as SettingsPageId] ? (
      <>
        <span className="nav-dot" aria-hidden="true" title="有未保存的修改" />
        <span className="sr-only">（有未保存的修改）</span>
      </>
    ) : null;
  }

  return (
    <aside className="side" aria-label="侧边栏">
      <div className="brand">
        <img className="brand-mark" src={iconUrl} alt="" width={34} height={34} />
        <div className="brand-text">
          <div className="brand-name">弹幕伴侣</div>
          <div className="brand-sub">Danmaku Companion</div>
        </div>
      </div>

      <ProfileSwitcher controller={controller} />

      <nav className="nav" aria-label="页面">
        {groups.map((group) => (
          <div key={group.id} role="group" aria-labelledby={`nav-${group.id}`}>
            <div className="nav-label" id={`nav-${group.id}`}>
              {group.label}
            </div>
            <ul>
              {PAGES.filter((item) => item.group === group.id).map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <a href={`#${item.id}`} aria-current={item.id === page ? "page" : undefined}>
                      <span className="decor" aria-hidden="true">
                        <Icon />
                      </span>
                      <span className="nav-text">{item.title}</span>
                      {trailing(item)}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="side-foot">
        <Lock aria-hidden="true" />
        配置与密钥只保存在本机
      </div>
    </aside>
  );
}
