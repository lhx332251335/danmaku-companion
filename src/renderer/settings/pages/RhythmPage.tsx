import { Construction } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import type { PageProps } from "./types";
import "../../styles/rhythm.css";

/**
 * 运行节奏 (#rhythm): timeline 一轮是怎样进行的, 截图间隔, 启动延迟, 每轮弹幕, 投放窗口.
 * Placeholder from the foundation task; the page task replaces the body.
 */
export function RhythmPage(_props: PageProps) {
  return (
    <EmptyState icon={<Construction />} title="运行节奏">
      这一页正在重做。
    </EmptyState>
  );
}
