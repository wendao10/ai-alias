# AI Alias

A **fully local** Obsidian plugin that deterministically masks sensitive names in your notes with custom aliases **before** you send the text to any public AI — whether an in-Obsidian assistant (Copilot, Editing Toolbar, etc.) or an external tool such as Codex, Claude Code, Doubao, DeepSeek, etc. — then restores them on the AI's reply.

## Why
- Sending project names, company/department names, resource/system names, or people's names directly to any public AI — in-Obsidian or external — is a leak risk.
- This plugin replaces real names with your own alphanumeric aliases (e.g. `[[PROJ_01]]`) locally, so you only ever feed the AI placeholder aliases; when the AI's reply comes back, the same mapping table restores the real names.
- **The mapping table (with real names) lives only in `data.json` on your machine and is never sent to the AI.** Replacement is deterministic — it does not rely on the AI to do the substitution (which would be lossy and error-prone).

## Install / Enable
1. The plugin files live in `.obsidian/plugins/ai-alias/` (`manifest.json` + `main.js`).
2. In Obsidian open **Settings → Community plugins**.
3. If "Safe mode" is on, turn it off; the plugin **AI Alias** should appear in the list — toggle it on.
   - If it does not appear, restart Obsidian once, then toggle it on.

## Configure the mapping
- **Settings → AI Alias**:
  - **Language**: choose **English** or **中文**; affects the plugin's settings UI (and command/menu labels).
  - **Alias wrap prefix / suffix**: default `[[` and `]]`. If you don't want Obsidian to render it as a (broken) link, change to `【` `】` or `«` `»`.
  - **Add mapping**: enter **Real name** + **Alias** (letters/digits/underscore). No category needed.
  - **Import / Export mappings**: bulk edit. Export = copy JSON to clipboard (safe, not written to any note). Import = paste JSON from clipboard to overwrite current settings.

## Daily workflow
1. Write your real content in a note.
2. Select the passage you want to ask the AI (or leave it empty for the whole note), then run **encrypt**:
   - Right-click in the editor → **AI Alias: Real name → Alias**, or Command palette → *AI Alias: Convert real names to aliases*.
   - Real names become `[[alias]]`.
3. Copy the masked text and paste it into any AI chat — an in-Obsidian assistant or an external tool such as Codex, Claude Code, Doubao, DeepSeek, etc. First run **AI Alias: Copy AI prompt prefix** and paste that "keep aliases intact" instruction at the top of your question.
4. The AI replies with `[[alias]]` inside. Copy it back into your note, select it, right-click → **AI Alias: Alias → Real name** (or Command palette decrypt) to restore real names.

## Commands
- `AI Alias: Convert real names to aliases (selection or whole note)` — also in the editor right-click menu
- `AI Alias: Convert aliases to real names (selection or whole note)` — also in the editor right-click menu
- `AI Alias: Copy AI prompt prefix (safe, no real names)`

## Security notes
- The mapping table is stored in `.obsidian/plugins/ai-alias/data.json`. Your git repo is private, so committing it is fine; if the repo ever goes public, exclude that file or use "Export mappings" to keep it yourself.
- Before reinstalling / switching machines, use **Export mappings** to back up the JSON somewhere safe; import to restore.
- The plugin runs fully offline — no network, no uploads.

---

# AI Alias（中文）

一个**纯本地**的 Obsidian 插件，用于在与任何公网 AI 协作时——无论是 Obsidian 内的助手（Copilot、Editing Toolbar 等），还是 Codex、Claude Code、豆包、DeepSeek 等外部工具——对笔记里的敏感名称做**确定性加/解密替换**：提交给 AI 前把真实名称换成你自定义的代号，AI 回复回来后再还原。

## 为什么
- 把项目名、公司/部门名、资源/系统名、人名等直接发给任何公网 AI（Obsidian 内或外部工具），有泄密风险。
- 本插件在本地把真实名称替换成字母数字代号（如 `[[PROJ_01]]`），AI 只看到占位代号；回复回来后用同一映射表还原真名。
- **映射表（含真实名称）只存于本机 `data.json`，绝不上传 AI**。替换是确定性的，不依赖 AI 去做（AI 替换会漏、会猜错）。

## 安装 / 启用
1. 插件文件位于 `.obsidian/plugins/ai-alias/`（`manifest.json` + `main.js`）。
2. Obsidian 打开 **设置 → 第三方插件**。
3. 若开着"安全模式"先关闭；列表里出现 **AI Alias** 后打开开关。
   - 若未出现，重启一次 Obsidian 再开。

## 配置映射
- **设置 → AI Alias**：
  - **语言**：选 **English** 或 **中文**，控制插件设置界面（及命令/菜单文案）。
  - **代号包裹前缀 / 后缀**：默认 `[[` 和 `]]`。不想被 Obsidian 渲染成链接，可改为 `【` `】` 或 `«` `»`。
  - **添加映射**：填 **原文（真实名称）** + **代号**（字母/数字/下划线），无需分类。
  - **导入 / 导出映射**：批量编辑。导出=复制到剪贴板（安全，不写入笔记）；导入=从剪贴板粘贴 JSON 覆盖当前设置。

## 日常用法
1. 在笔记里写真实内容。
2. 选中要问 AI 的段落（不选=整篇），运行**加密**：右键 → **AI Alias：真实名 → 代号**，或命令面板 *AI Alias：真实名转代号*。真实名称变 `[[代号]]`。
3. 复制加密文本粘贴进任意 AI 对话框——Obsidian 内助手或 Codex、Claude Code、豆包、DeepSeek 等外部工具均可；先运行 **AI Alias：复制 AI 提示词前缀**，把"请原样保留代号"的说明贴在问题最前。
4. AI 回复（含 `[[代号]]`）复制回笔记并选中 → 右键 **AI Alias：代号 → 真实名**（或命令面板解密）还原真名。

## 命令
- `AI Alias：真实名转代号（选中/全文）` —— 同时出现在编辑器右键菜单
- `AI Alias：代号转真实名（选中/全文）` —— 同时出现在编辑器右键菜单
- `AI Alias：复制 AI 提示词前缀（安全，无真实名称）`

## 安全提示
- 映射表在 `.obsidian/plugins/ai-alias/data.json`。git 仓库为 private，随提交无碍；若仓库变公开，请排除该文件或用"导出映射"自行保管。
- 重装/换机前用"导出映射"备份 JSON 到安全处；导入即可恢复。
- 插件完全离线，不联网、不上传。

已上架obsidian第三方插件市场，PKMer链接请见https://pkmer.cn/Pkmer-Docs/10-obsidian/obsidian%E7%A4%BE%E5%8C%BA%E6%8F%92%E4%BB%B6/ai-alias/
