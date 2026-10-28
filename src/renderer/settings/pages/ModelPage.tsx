import {
  ArrowRight,
  Cable,
  Cpu,
  Image as ImageIcon,
  KeyRound,
  Lightbulb,
  Link as LinkIcon,
  RefreshCw,
} from "lucide-react";
import type { ModelOption } from "../../../shared/types";
import { LIMITS } from "../../../shared/limits";
import {
  Button,
  Callout,
  Card,
  Chip,
  Field,
  LinkButton,
  NumberField,
  Select,
  SliderField,
  Switch,
  TextField,
  type SelectOption,
} from "../components";
import { rangeHint } from "../format";
import type { SettingsController } from "../useSettingsController";
import type { PageProps } from "./types";
import "../../styles/model.css";

/** 「id · name · state · 视觉」, the same label the old model select used. */
function modelOptionLabel(model: ModelOption): string {
  return [
    model.id,
    model.name && model.name !== model.id ? model.name : undefined,
    model.state,
    model.vision ? "视觉" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The line under the model picker: what the list call found, or why it failed. */
function ModelListNote({ controller }: { controller: SettingsController }) {
  const { modelList, modelListLoading, modelOptions, selectedModel, draft } = controller;

  if (modelList?.ok === false) {
    return (
      <span className="model-note is-error">
        读取模型列表失败：{modelList.message}
        <span className="model-note-tail">可以直接输入模型 ID。</span>
      </span>
    );
  }
  if (!modelList) {
    return <>{modelListLoading ? "正在读取模型列表…" : "还没有读取模型列表。"}刷新会先保存修改。</>;
  }
  if (modelOptions.length === 0) {
    return <>接口没有返回模型，请直接输入模型 ID。刷新会先保存修改。</>;
  }
  const missing = !selectedModel && draft.model.model.trim() !== "";
  return (
    <>
      从接口读到 {modelOptions.length} 个模型
      {missing ? (
        <>
          ，当前的 <code>{draft.model.model}</code> 不在列表里
        </>
      ) : null}
      。刷新会先保存修改。
    </>
  );
}

function ModelPicker({ controller }: { controller: SettingsController }) {
  const { draft, edit, modelOptions, modelListLoading } = controller;
  const current = draft.model.model;
  const listed = modelOptions.some((model) => model.id === current);
  const options: SelectOption[] = modelOptions.map((model) => ({
    value: model.id,
    label: modelOptionLabel(model),
  }));
  if (!listed && current.trim() !== "") {
    // Keep the configured id visible (and selected) even when the server does not list it.
    options.unshift({ value: current, label: `${current} · 不在列表中` });
  }

  return (
    <div className="model-picker">
      {modelOptions.length > 0 ? (
        <Select
          value={listed || current.trim() !== "" ? current : ""}
          placeholder={current.trim() === "" ? `从 ${modelOptions.length} 个模型中选择…` : undefined}
          options={options}
          onChange={(value) => {
            if (value) edit("model", { model: value });
          }}
        />
      ) : (
        <TextField
          value={current}
          mono
          placeholder="例如 qwen2.5-vl-7b-instruct"
          spellCheck={false}
          autoComplete="off"
          onChange={(model) => edit("model", { model })}
        />
      )}
      <Button
        iconOnly
        icon={<RefreshCw />}
        label={modelListLoading ? "正在刷新模型列表" : "刷新模型列表（会先保存修改）"}
        busy={modelListLoading}
        onClick={() => void controller.refreshModels()}
      />
    </div>
  );
}

function ConnectionResult({ controller }: { controller: SettingsController }) {
  const { connection } = controller;
  if (!connection) return null;
  const count = connection.models?.length ?? 0;

  return (
    <Callout
      tone={connection.ok ? "ok" : "bad"}
      role="status"
      title={connection.ok ? "连接成功" : "连接失败"}
      onDismiss={controller.dismissConnection}
      dismissLabel="关闭测试结果"
      className="connection-result"
    >
      <p className="connection-message">
        {connection.ok
          ? count > 0
            ? `模型列表返回 ${count} 个模型`
            : "接口可以访问，但没有返回模型"
          : connection.message}
      </p>
      <p className="connection-endpoint mono">{connection.endpoint}</p>
    </Callout>
  );
}

/** 模型接口 (#model): connection, model and parameters, vision input; aside 连接测试. */
export function ModelPage({ controller, navigate }: PageProps) {
  const { draft, edit, selectedModel, workingAction } = controller;
  const model = draft.model;
  const temperatureOff = !model.sendTemperature;

  return (
    <div className="split model-page">
      <div className="stack">
        <Card title="连接" icon={<LinkIcon />}>
          <Field label="接口地址" hint="Base URL" help="OpenAI 兼容接口的地址，通常以 /v1 结尾">
            <TextField
              value={model.baseUrl}
              icon={<LinkIcon />}
              mono
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              placeholder="http://127.0.0.1:1234/v1"
              onChange={(baseUrl) => edit("model", { baseUrl })}
            />
          </Field>
          <Field label="API Key" hint="本地服务通常可留空" help="作为 Bearer 令牌发送，只保存在本机配置中">
            <TextField
              type="password"
              value={model.apiKey}
              icon={<KeyRound />}
              mono
              placeholder="未设置"
              revealLabels={{ show: "显示 API Key", hide: "隐藏 API Key" }}
              onChange={(apiKey) => edit("model", { apiKey })}
            />
          </Field>
        </Card>

        <Card title="模型与参数" icon={<Cpu />} iconTone="coral">
          <Field
            label="模型"
            hint={
              selectedModel && (selectedModel.state || selectedModel.vision) ? (
                <span className="model-chips">
                  {selectedModel.state ? (
                    <Chip size="sm" tone={selectedModel.state === "loaded" ? "ok" : "neutral"}>
                      {selectedModel.state}
                    </Chip>
                  ) : null}
                  {selectedModel.vision ? (
                    <Chip size="sm" tone="accent">
                      视觉
                    </Chip>
                  ) : null}
                </span>
              ) : undefined
            }
            help={<ModelListNote controller={controller} />}
          >
            <ModelPicker controller={controller} />
          </Field>

          <Field
            label="温度"
            hint="0 – 2，越高越跳脱"
            disabled={temperatureOff}
            help={temperatureOff ? "已关闭「发送温度参数」，请求里不带温度，由服务端决定" : undefined}
          >
            <SliderField
              value={model.temperature}
              range={LIMITS.temperature}
              step={0.1}
              numberStep={0.1}
              disabled={temperatureOff}
              onCommit={(temperature) => edit("model", { temperature })}
            />
          </Field>
          <Switch
            checked={model.sendTemperature}
            onChange={(sendTemperature) => edit("model", { sendTemperature })}
            label="发送温度参数"
            description="有些服务不接受 temperature，关闭后请求里不再携带"
          />

          <div className="row2">
            <Field label="最大输出" hint={rangeHint(LIMITS.maxTokens)} help="日志提示「输出截断」时调大">
              <NumberField
                value={model.maxTokens}
                range={LIMITS.maxTokens}
                integer
                unit="tokens"
                onCommit={(maxTokens) => edit("model", { maxTokens })}
              />
            </Field>
            <Field
              label="超时"
              hint={rangeHint(LIMITS.timeoutMs, "秒", 0.001)}
              help="单轮请求最多等多久，超时算失败"
            >
              <NumberField
                value={model.timeoutMs}
                range={LIMITS.timeoutMs}
                integer
                scale={0.001}
                unit="秒"
                onCommit={(timeoutMs) => edit("model", { timeoutMs })}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="视觉输入"
          icon={<ImageIcon />}
          aside={
            <LinkButton icon={<ArrowRight />} onClick={() => navigate("capture")}>
              截图设置
            </LinkButton>
          }
        >
          <Switch
            checked={model.visionEnabled}
            onChange={(visionEnabled) => edit("model", { visionEnabled })}
            label="发送截图"
            description="关闭后不再截图，只发送文字，模型看不到屏幕；「截图与历史」里的截图设置随之不起作用"
          />
        </Card>
      </div>

      <div className="aside">
        <Card title="连接测试" icon={<Cable />} iconTone="ok" bodyClassName="connection-body">
          <Button
            block
            icon={<Cable />}
            busy={workingAction === "test"}
            busyLabel="测试中…"
            disabled={workingAction !== null}
            onClick={() => void controller.testConnection()}
          >
            测试连接
          </Button>
          <ConnectionResult controller={controller} />
          <p className="help">
            测试前会先保存当前修改，再请求接口的 <code>/models</code>；完成后刷新模型列表。
          </p>
        </Card>
        <Callout tone="neutral" icon={<Lightbulb />} className="model-tip">
          <p>
            <strong>先用「生成一次」试试。</strong>
            它会先保存修改，立刻
            {model.visionEnabled ? "截一张图并发出一轮请求" : "发出一轮纯文字请求"}
            ，结果出现在生成日志里，不需要启动循环。
          </p>
          <LinkButton className="model-tip-link" icon={<ArrowRight />} onClick={() => navigate("logs")}>
            查看生成日志
          </LinkButton>
        </Callout>
      </div>
    </div>
  );
}
