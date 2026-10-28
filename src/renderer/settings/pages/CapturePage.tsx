import { Construction } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import type { PageProps } from "./types";
import "../../styles/capture.css";

/**
 * 截图与历史 (#capture): 截图, 历史与缓存 (history modes, limits, 上下文摘要), 隐私与存储, aside 实时用量.
 * Placeholder from the foundation task; the page task replaces the body.
 */
export function CapturePage(_props: PageProps) {
  return (
    <EmptyState icon={<Construction />} title="截图与历史">
      这一页正在重做。
    </EmptyState>
  );
}
