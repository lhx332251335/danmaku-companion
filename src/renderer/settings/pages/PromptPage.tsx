import { ArrowRight, Plus, RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { defaultAppConfig } from "../../../shared/defaultConfig";
import type { AppConfig } from "../../../shared/types";
import {
  Button,
  Callout,
  Card,
  Chip,
  LinkButton,
  TabPanel,
  Tabs,
  TextArea,
  TodoTag,
  type TabItem,
} from "../components";
import { SUMMARY_PLACEHOLDER, UNIMPLEMENTED_HINTS } from "../constants";
import { countText } from "../format";
import { mentionsRequestedCount, summaryInactiveReason, summaryPreviewValues } from "../promptPreview";
import type { SettingsController } from "../useSettingsController";
import type { PageProps } from "./types";
import "../../styles/prompt.css";

type TemplateTab = "system" | "user" | "summary";
type TemplateField = keyof AppConfig["prompt"];

const TEMPLATE_FIELDS: Record<TemplateTab, TemplateField> = {
  system: "systemTemplate",
  user: "userTemplate",
  summary: "summaryTemplate",
};

const TAB_LABELS: Record<TemplateTab, string> = {
  system: "系统提示词",
  user: "用户提示词",
  summary: "摘要提示词",
};

const TAB_ORDER: readonly TemplateTab[] = ["system", "user", "summary"];
const ID_PREFIX = "prompt-tabs";

/** #prompt/summary or #prompt/user opens that tab (pageFromHash ignores the suffix). */
function tabFromHash(hash: string): TemplateTab {
  const suffix = hash.replace(/^#\/?/, "").split(/[?&/=]/)[1];
  return suffix === "user" || suffix === "summary" ? suffix : "system";
}

interface PlaceholderRow {
  token: string;
  meaning: string;
  /** Current value shown after the meaning; omitted for fixed values. */
  value?: string;
  todo?: string;
}

function placeholderRows(draft: AppConfig, tab: TemplateTab): PlaceholderRow[] {
  const values = summaryPreviewValues(draft);
  const rows: PlaceholderRow[] = [
    { token: "{{companion.name}}", meaning: "角色名", value: values["companion.name"] },
    { token: "{{companion.persona}}", meaning: "人设", value: values["companion.persona"] },
    { token: "{{companion.tone}}", meaning: "语气", value: values["companion.tone"] },
    { token: "{{companion.language}}", meaning: "语言", value: values["companion.language"] },
    { token: "{{user.name}}", meaning: "用户称呼", value: values["user.name"] },
    { token: "{{user.role}}", meaning: "用户身份", value: values["user.role"] },
    { token: "{{requestedCount}}", meaning: "每轮弹幕", value: values.requestedCount },
    { token: "{{jsonShape}}", meaning: "要求返回的 JSON 结构" },
    { token: "{{activeApp}}", meaning: "目前总是 unknown", todo: UNIMPLEMENTED_HINTS.activeApp },
  ];
  if (tab === "summary") {
    rows.unshift({ token: SUMMARY_PLACEHOLDER, meaning: "摘要上限", value: `${values.summaryMaxChars} 字` });
  }
  return rows;
}

function PlaceholderList({
  draft,
  tab,
  onInsert,
}: {
  draft: AppConfig;
  tab: TemplateTab;
  onInsert: (token: string) => void;
}) {
  return (
    <ul className="ph-list" aria-label={`插入到${TAB_LABELS[tab]}的占位符`}>
      {placeholderRows(draft, tab).map((row) => (
        <li key={row.token}>
          <button
            type="button"
            className={["ph", row.todo ? "is-todo" : ""].filter(Boolean).join(" ")}
            title={row.todo}
            onClick={() => onInsert(row.token)}
          >
            <span className="sr-only">插入 </span>
            <code>{row.token}</code>
            <span className="ph-meaning">
              {row.todo ? <TodoTag hint={row.todo} /> : null}
              {row.meaning}
              {row.value !== undefined ? (
                <>
                  {" · "}
                  <b>{row.value.trim() === "" ? "（空）" : row.value}</b>
                </>
              ) : null}
            </span>
            <Plus className="ph-ins" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SummaryStatus({
  controller,
  navigate,
}: { controller: SettingsController } & Pick<PageProps, "navigate">) {
  const { runtime } = controller.draft;
  const link = (
    <LinkButton icon={<ArrowRight />} onClick={() => navigate("capture")}>
      截图与历史
    </LinkButton>
  );

  const inactive = summaryInactiveReason(runtime);
  if (inactive) {
    return (
      <Callout tone="warn" className="prompt-callout" action={link}>
        <p>
          <strong>上下文摘要已开启，但用不上</strong>：{inactive}。
        </p>
      </Callout>
    );
  }

  return runtime.historySummaryEnabled ? (
    <Callout tone="violet" className="prompt-callout" action={link}>
      <p>
        <strong>上下文摘要已开启</strong>，摘要上限 {runtime.historySummaryMaxChars} 字。
      </p>
    </Callout>
  ) : (
    <Callout tone="info" className="prompt-callout" action={link}>
      <p>
        <strong>上下文摘要没有开启</strong>，这份提示词暂时不会用到。
      </p>
    </Callout>
  );
}

function TabDescription({ tab, visionEnabled }: { tab: TemplateTab; visionEnabled: boolean }) {
  if (tab === "system") {
    return (
      <p className="prompt-desc">
        定义角色与输出格式，位于每次请求的最前面。修改后下一轮无法命中提示缓存，需要重新预填充一次。
      </p>
    );
  }
  if (tab === "user") {
    return (
      <p className="prompt-desc">
        每轮和截图一起发送的文字，可以留空；留空时只发送截图
        {visionEnabled ? "。" : "（视觉输入已关闭，留空时改为发送一句默认的英文请求）。"}
      </p>
    );
  }
  return (
    <p className="prompt-desc">
      开启「上下文摘要」时使用：历史窗口重置或减半的前一轮，额外请求一份摘要。可用{" "}
      <code>{SUMMARY_PLACEHOLDER}</code>
      ；留空时使用内置的默认提示词。
    </p>
  );
}

/** 提示词模板 (#prompt): tabs 系统/用户/摘要提示词, mono editor, aside 插入占位符. */
export function PromptPage({ controller, navigate }: PageProps) {
  const { draft, edit } = controller;
  const [tab, setTab] = useState<TemplateTab>(() => tabFromHash(window.location.hash));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Last caret per tab, so an insert after switching tabs lands where the user left off. */
  const selections = useRef<Partial<Record<TemplateTab, { start: number; end: number }>>>({});
  /** Caret to restore after a fallback insert re-rendered the textarea. */
  const pendingCaret = useRef<number | null>(null);

  const field = TEMPLATE_FIELDS[tab];
  const value = draft.prompt[field];
  const defaultValue = defaultAppConfig.prompt[field];

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (pendingCaret.current !== null && textarea) {
      textarea.focus();
      textarea.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  function rememberSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    const { selectionStart, selectionEnd } = event.currentTarget;
    selections.current[tab] = { start: selectionStart, end: selectionEnd };
  }

  function setTemplate(next: string) {
    edit("prompt", { [field]: next } as Partial<AppConfig["prompt"]>);
  }

  function insert(token: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Never focused on this tab yet: append at the end.
    const saved = selections.current[tab] ?? { start: value.length, end: value.length };
    const start = Math.min(saved.start, value.length);
    const end = Math.min(Math.max(saved.end, start), value.length);

    textarea.focus();
    textarea.setSelectionRange(start, end);
    // insertText keeps the browser's undo history and fires a normal input event (→ onChange).
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, token);
    } catch {
      inserted = false;
    }
    if (!inserted || textarea.value === value) {
      setTemplate(value.slice(0, start) + token + value.slice(end));
      pendingCaret.current = start + token.length;
    }
    selections.current[tab] = { start: start + token.length, end: start + token.length };
  }

  const missingCount = tab === "system" && !mentionsRequestedCount(value);
  const hasCallout = tab === "summary" || missingCount;

  const tabs: TabItem<TemplateTab>[] = TAB_ORDER.map((id) => ({
    id,
    label: TAB_LABELS[id],
    badge:
      draft.prompt[TEMPLATE_FIELDS[id]].trim() === "" ? (
        <Chip size="sm" className="tab-chip">
          空
        </Chip>
      ) : undefined,
  }));

  return (
    <div className="split prompt-page">
      <Card bare className="prompt-card">
        <Tabs tabs={tabs} value={tab} onChange={setTab} idPrefix={ID_PREFIX} aria-label="提示词模板" />
        <TabPanel
          idPrefix={ID_PREFIX}
          id={tab}
          className={["prompt-panel", hasCallout ? "has-callout" : ""].filter(Boolean).join(" ")}
        >
          <TabDescription tab={tab} visionEnabled={draft.model.visionEnabled} />
          {tab === "summary" ? <SummaryStatus controller={controller} navigate={navigate} /> : null}
          {missingCount ? (
            <Callout tone="warn" className="prompt-callout">
              <p>
                模板里没有 <code>{"{{requestedCount}}"}</code>：保存时会在末尾自动补上一句「Return exactly{" "}
                {"{{requestedCount}}"} comments…」。
              </p>
            </Callout>
          ) : null}
          <div className="editor-wrap">
            <TextArea
              key={tab}
              textareaRef={textareaRef}
              className="prompt-editor"
              mono
              value={value}
              aria-label={`${TAB_LABELS[tab]}模板`}
              placeholder={
                tab === "user"
                  ? "例如：这是 {{user.name}} 现在的屏幕，请给出 {{requestedCount}} 条弹幕。"
                  : tab === "summary"
                    ? "留空时使用内置的默认摘要提示词"
                    : undefined
              }
              onChange={setTemplate}
              onSelect={rememberSelection}
              onBlur={rememberSelection}
            />
          </div>
          <div className="card-foot prompt-foot">
            <span className="help num prompt-count">{countText(value)}</span>
            <span className="prompt-foot-spacer" />
            {value !== defaultValue ? (
              <Button
                variant="subtle"
                size="sm"
                icon={<RotateCcw />}
                title={`把${TAB_LABELS[tab]}换回内置默认（保存前可以还原）`}
                onClick={() => setTemplate(defaultValue)}
              >
                恢复默认
              </Button>
            ) : null}
            {tab === "system" ? (
              <LinkButton icon={<ArrowRight />} onClick={() => navigate("character")}>
                查看填充后的效果
              </LinkButton>
            ) : null}
          </div>
        </TabPanel>
      </Card>

      <div className="aside">
        <Card title="插入占位符" icon={<Plus />} sub="点击插入到光标处" bodyClassName="ph-body">
          <PlaceholderList draft={draft} tab={tab} onInsert={insert} />
        </Card>
      </div>
    </div>
  );
}
