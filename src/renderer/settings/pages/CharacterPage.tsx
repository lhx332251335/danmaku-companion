import { ArrowRight, Braces, Sparkles, UserRound } from "lucide-react";
import { useId } from "react";
import type { AppConfig } from "../../../shared/types";
import { Card, Chip, Field, LinkButton, TextArea, TextField } from "../components";
import {
  CONTEXT_SUMMARY_HEADER,
  previewValues,
  summaryInactiveReason,
  templateSegments,
} from "../promptPreview";
import type { PageProps } from "./types";
import "../../styles/character.css";

const LANGUAGE_SUGGESTIONS = ["zh-CN", "zh-TW", "ja", "en"];

/** First visible character of the name for the avatar ("M" for Mika, "小" for 小雪). */
function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : "?";
}

/** `{{companion.name}}` in a help line. */
function Placeholder({ children }: { children: string }) {
  return <code className="ph-code">{children}</code>;
}

function PersonaCard({ draft }: { draft: AppConfig }) {
  const { name, persona, language } = draft.character;
  const snippet = persona.trim() || "还没有写人设";

  return (
    <div className="persona-card">
      <div className="persona-avatar" aria-hidden="true">
        {initialOf(name)}
      </div>
      <div className="persona-text">
        <b className="persona-name">{name.trim() || "未命名角色"}</b>
        <span className="persona-sub" title={snippet}>
          {snippet}
        </span>
      </div>
      {language.trim() ? (
        <Chip size="sm" tone="outline" className="persona-lang" title="语言">
          {language.trim()}
        </Chip>
      ) : null}
    </div>
  );
}

/** The system template rendered with the draft values: settings values highlighted. */
function SystemPromptPreview({ draft }: { draft: AppConfig }) {
  const segments = templateSegments(draft.prompt.systemTemplate, previewValues(draft));
  const labelId = useId();

  return (
    <div className="prompt-preview-wrap">
      <span id={labelId} className="sr-only">
        填入当前设置后的系统提示词
      </span>
      {/* Focusable so keyboard users can scroll a long prompt. */}
      <pre className="prompt-preview" tabIndex={0} role="region" aria-labelledby={labelId}>
        {segments.length === 0 ? (
          <span className="prompt-preview-empty">系统提示词是空的</span>
        ) : (
          segments.map((segment, index) => {
            if (segment.kind === "text") {
              return segment.text;
            }
            if (segment.kind === "value") {
              return segment.text === "" ? (
                <mark key={index} className="is-empty" title={`${segment.token} 是空的`}>
                  空
                </mark>
              ) : (
                <mark key={index} title={segment.token}>
                  {segment.text}
                </mark>
              );
            }
            if (segment.kind === "fixed") {
              return (
                <span
                  key={index}
                  className="tok"
                  title={
                    segment.key === "activeApp"
                      ? `${segment.token}：尚未实现，目前总是填入 unknown`
                      : `${segment.token}：固定的 JSON 结构`
                  }
                >
                  {segment.text}
                </span>
              );
            }
            return (
              <span key={index} className="tok is-unknown" title="没有这个占位符，会原样发送">
                {segment.token}
              </span>
            );
          })
        )}
        {draft.runtime.historySummaryEnabled && !summaryInactiveReason(draft.runtime) ? (
          <span className="prompt-preview-summary">
            {"\n\n"}
            {CONTEXT_SUMMARY_HEADER}
            {"\n"}
            <span className="tok is-summary">上下文摘要（历史窗口重置或减半后附上）</span>
          </span>
        ) : null}
      </pre>
    </div>
  );
}

/** 角色与称呼 (#character): persona card, 角色, 你, aside 系统提示词预览. */
export function CharacterPage({ controller, navigate }: PageProps) {
  const { draft, edit } = controller;
  const { character, user } = draft;
  const languageListId = `${useId().replace(/:/g, "")}-languages`;

  return (
    <div className="split character-page">
      <div className="stack">
        <Card title="角色" icon={<Sparkles />} iconTone="coral">
          <PersonaCard draft={draft} />
          <div className="row2">
            <Field
              label="角色名"
              help={
                <>
                  填入 <Placeholder>{"{{companion.name}}"}</Placeholder>
                </>
              }
            >
              <TextField
                value={character.name}
                autoComplete="off"
                onChange={(name) => edit("character", { name })}
              />
            </Field>
            <Field
              label="语言"
              hint="如 zh-CN、ja、en"
              help={
                <>
                  弹幕使用的语言 · <Placeholder>{"{{companion.language}}"}</Placeholder>
                </>
              }
            >
              <TextField
                value={character.language}
                list={languageListId}
                autoComplete="off"
                spellCheck={false}
                onChange={(language) => edit("character", { language })}
              />
            </Field>
            <datalist id={languageListId}>
              {LANGUAGE_SUGGESTIONS.map((language) => (
                <option key={language} value={language} />
              ))}
            </datalist>
          </div>
          <Field
            label="人设"
            help={
              <>
                角色是谁、怎么说话 · <Placeholder>{"{{companion.persona}}"}</Placeholder>
              </>
            }
          >
            <TextArea
              value={character.persona}
              rows={4}
              onChange={(persona) => edit("character", { persona })}
            />
          </Field>
          <Field
            label="语气"
            help={
              <>
                说话风格，例如简短、俏皮 · <Placeholder>{"{{companion.tone}}"}</Placeholder>
              </>
            }
          >
            <TextField value={character.tone} onChange={(tone) => edit("character", { tone })} />
          </Field>
        </Card>

        <Card title="你" icon={<UserRound />} sub="角色如何称呼和理解你">
          <div className="row2">
            <Field
              label="用户称呼"
              help={
                <>
                  角色怎么称呼你 · <Placeholder>{"{{user.name}}"}</Placeholder>
                </>
              }
            >
              <TextField value={user.name} autoComplete="off" onChange={(name) => edit("user", { name })} />
            </Field>
            <Field
              label="用户身份"
              help={
                <>
                  你在做什么，例如正在打游戏的玩家 · <Placeholder>{"{{user.role}}"}</Placeholder>
                </>
              }
            >
              <TextField value={user.role} onChange={(role) => edit("user", { role })} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="aside">
        <Card title="系统提示词预览" icon={<Braces />} bodyClassName="preview-body">
          <SystemPromptPreview draft={draft} />
          <p className="help">高亮处来自左侧设置；改动后，下一轮无法命中提示缓存。</p>
          <LinkButton className="preview-link" icon={<ArrowRight />} onClick={() => navigate("prompt")}>
            编辑模板
          </LinkButton>
        </Card>
      </div>
    </div>
  );
}
