import { Construction } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import type { PageProps } from "./types";
import "../../styles/danmaku.css";

/**
 * 弹幕外观 (#danmaku): 文字, 运动与分布, 配色, 弹幕层与录屏, sticky 实时预览.
 * Placeholder from the foundation task; the page task replaces the body.
 */
export function DanmakuPage(_props: PageProps) {
  return (
    <EmptyState icon={<Construction />} title="弹幕外观">
      这一页正在重做。
    </EmptyState>
  );
}
