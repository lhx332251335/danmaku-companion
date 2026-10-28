import { Construction } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import type { PageProps } from "./types";
import "../../styles/logs.css";

/**
 * 生成日志 (#logs): toolbar (全部/失败/摘要 filter, 保留条数, 刷新, 清空日志), log rows with flags, expanded detail.
 * Placeholder from the foundation task; the page task replaces the body.
 */
export function LogsPage(_props: PageProps) {
  return (
    <EmptyState icon={<Construction />} title="生成日志">
      这一页正在重做。
    </EmptyState>
  );
}
