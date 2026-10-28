import { ArrowRight } from "lucide-react";
import { LinkButton } from "../components/Button";
import { Callout } from "../components/Callout";
import type { PageId } from "../constants";
import type { SettingsController } from "../useSettingsController";

interface BannersProps {
  controller: SettingsController;
  page: PageId;
  navigate: (page: PageId) => void;
}

/**
 * Page-level messages at the top of every page: the last failed action (dismissible) and the
 * runtime's last error (stays until a round succeeds), with a link to the logs.
 */
export function Banners({ controller, page, navigate }: BannersProps) {
  const { actionError, status } = controller;
  if (!actionError && !status.lastError) {
    return null;
  }

  return (
    <div className="page-banners">
      {actionError ? (
        <Callout
          tone="bad"
          banner
          title="操作失败："
          onDismiss={controller.dismissActionError}
          dismissLabel="关闭错误提示"
        >
          {actionError}
        </Callout>
      ) : null}
      {status.lastError ? (
        <Callout
          tone="bad"
          banner
          title="上一轮失败："
          action={
            page === "logs" ? undefined : (
              <LinkButton icon={<ArrowRight />} onClick={() => navigate("logs")}>
                查看日志
              </LinkButton>
            )
          }
        >
          {status.lastError}
          {status.state === "running" ? "（循环仍在运行，下一轮会自动重试）" : ""}
        </Callout>
      ) : null}
    </div>
  );
}
