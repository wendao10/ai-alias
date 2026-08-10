import { Plugin, PluginSettingTab, Setting, Notice, Modal, Editor, App, TFile } from 'obsidian';

interface Mapping {
	real: string;
	code: string;
}

interface BareHit {
	start: number;
	end: number;
	code: string;
	real: string;
}

interface AIAliasSettings {
	prefix: string;
	suffix: string;
	language: 'en' | 'zh';
	mappings: Mapping[];
}

const DEFAULT_SETTINGS: AIAliasSettings = {
	prefix: '[[',
	suffix: ']]',
	language: 'en',
	mappings: []
};

const STR: { en: Record<string, string>; zh: Record<string, string> } = {
	en: {
		title: 'AI Alias',
		language: 'Language',
		languageDesc: 'Interface language for this plugin.',
		prefix: 'Alias wrap prefix',
		prefixDesc: 'Left wrapper around the alias. Default [[ renders as an Obsidian link; change to 【 or « to avoid that.',
		suffix: 'Alias wrap suffix',
		suffixDesc: 'Right wrapper around the alias.',
		add: 'Add',
		importExport: 'Import / Export mappings',
		importExportDesc: 'Export: copy JSON to clipboard (safe, not written to any note). Import: paste JSON from clipboard; choose Clear & insert or Insert.',
		exportBtn: 'Export to clipboard',
		importBtn: 'Import from clipboard',
		// CRUD manager
		mappingTitle: 'Mapping table',
		searchPh: 'Search real name or alias…',
		batchAdd: 'Batch add',
		delSel: 'Delete selected',
		clearAll: 'Clear all',
		addSave: 'Save',
		cancel: 'Cancel',
		thReal: 'Real name',
		thCode: 'Alias',
		actions: 'Actions',
		edit: 'Edit',
		del: 'Delete',
		empty: '(empty) Add an entry first.',
		filteredEmpty: 'No matches.',
		errEmpty: 'Real name and alias cannot be empty',
		errChars: 'Alias may only contain letters, digits and underscore',
		errDup: 'This alias already exists, choose another',
		added: 'Added: ',
		addedN: 'Added %d entries',
		edited: 'Saved changes',
		delOne: 'Deleted 1 entry',
		delN: 'Deleted %d entries',
		confirmDelSel: 'Delete the selected %d entries?',
		confirmClear: 'Clear all %d mappings? This cannot be undone.',
		cancelClear: 'Cancelled',
		batchTitle: 'Batch add mappings',
		batchFmt: 'One per line: real=code (supports = / → / tab / comma). Blank lines are ignored.',
		batchSave: 'Add',
		previewWarn: 'Skipped: ',
		dupInBatch: 'duplicate in batch',
		importMergeOk: 'Inserted %d new entries',
		crudNote: 'Validation: real and alias cannot be empty; alias only allows A-Z a-z 0-9 _; alias must be unique. Tip: search filters live; click a column header to sort; press Enter in the add form to submit.',
		// import
		importTitle: 'Import Mappings (paste JSON)',
		importFormat: 'Format: { "prefix":"[[", "suffix":"]]", "mappings":[{ "real":"...", "code":"PROJ_01" }] }.',
		overwriteBtn: 'Clear & insert',
		mergeBtn: 'Insert',
		importHelp: 'Insert: append imported mappings to your current list; existing codes are not duplicated (your current entries are kept). Clear & insert: clear all current mappings first, then replace with only the imported content (full reset).',
		parseSave: 'Parse & Save',
		errEmptyField: 'Found empty real name or alias',
		errInvalid: 'Alias has invalid chars: ',
		errDuplicate: 'Duplicate alias: ',
		imported: 'Cleared and inserted %d entries',
		importFail: 'Import failed: ',
		// commands
		cmdEncrypt: 'AI Alias: Convert real names to aliases (selection or whole note)',
		cmdDecrypt: 'AI Alias: Convert aliases to real names (selection or whole note)',
		cmdPrefix: 'AI Alias: Copy AI prompt prefix (safe, no real names)',
		menuEncrypt: 'AI Alias: Real name → Alias',
		menuDecrypt: 'AI Alias: Alias → Real name',
		emptyEncrypt: 'Mapping table is empty; add entries in settings first',
		emptyDecrypt: 'Mapping table is empty',
		encrypted: 'Encrypted (selection / whole note)',
		decrypted: 'Decrypted (selection / whole note)',
		// bare-code (unwrapped alias) recovery
		bareTitle: 'Unwrapped alias codes found',
		bareDesc: 'The following %d alias code(s) appear WITHOUT the %p … %s wrapper, so they were not auto-restored. Check the ones to convert to real names, then click Replace selected.',
		bareWarn: 'Warning: a bare code can look like a normal word. Review the context of each before replacing.',
		bareSelectAll: 'Select all',
		bareSelectNone: 'Clear selection',
		bareReplace: 'Replace selected (%d)',
		bareContext: 'Context',
		bareBodySection: 'In note body',
		bareTitleSection: 'In note title (file name)',
		bareTitleWarn: 'Restoring the title renames the note file and may affect links from other notes to this note. This rename is a file-level operation and cannot be undone with the in-note Undo (Ctrl/Cmd+Z) — please proceed with caution.',
		bareTitleRenamed: 'Renamed note title',
		bareTitleSkip: 'Skipped %d title entr(y/ies) with invalid file-name characters',
		prefixCopied: 'Copied AI prompt prefix to clipboard',
		copyFail: 'Copy failed: ',
		promptPrefix: 'Note: strings in the form %PXXX%S in the following text are placeholder aliases (e.g. %PPROJ_01%S, %PORG_ABC%S), representing masked real entities. Keep these aliases exactly as-is: do not translate, explain, rewrite, or guess their meaning; if you need to refer to them, keep using the same alias.'
	},
	zh: {
		title: 'AI Alias（保密代号）',
		language: '语言',
		languageDesc: '本插件的界面语言。',
		prefix: '代号包裹前缀',
		prefixDesc: '包裹代号的左符号。默认 [[ 会被 Obsidian 渲染成链接，可改为 【 或 « 避免。',
		suffix: '代号包裹后缀',
		suffixDesc: '包裹代号的右符号。',
		add: '添加',
		importExport: '导入 / 导出映射',
		importExportDesc: '导出：复制 JSON 到剪贴板（安全，不写入任何笔记）。导入：从剪贴板粘贴 JSON，可选择清空后插入或插入。',
		exportBtn: '导出到剪贴板',
		importBtn: '从剪贴板导入',
		// CRUD manager
		mappingTitle: '映射表',
		searchPh: '搜索原文或代号…',
		batchAdd: '批量添加',
		delSel: '删除选中',
		clearAll: '清空全部',
		addSave: '保存',
		cancel: '取消',
		thReal: '原文',
		thCode: '代号',
		actions: '操作',
		edit: '编辑',
		del: '删除',
		empty: '（空）请先添加条目。',
		filteredEmpty: '无匹配结果。',
		errEmpty: '原文和代号都不能为空',
		errChars: '代号只能包含字母、数字、下划线',
		errDup: '该代号已存在，请换一个',
		added: '已添加：',
		addedN: '已添加 %d 条',
		edited: '已保存修改',
		delOne: '已删除 1 条',
		delN: '已删除 %d 条',
		confirmDelSel: '确定删除选中的 %d 条？',
		confirmClear: '确定清空全部 %d 条映射？此操作不可撤销。',
		cancelClear: '已取消',
		batchTitle: '批量添加映射',
		batchFmt: '每行一条，格式：原文=代号（支持 = / → / 制表符 / 逗号）。空行忽略。',
		batchSave: '添加',
		previewWarn: '跳过：',
		dupInBatch: '批量内重复',
		importMergeOk: '已插入 %d 条新映射',
		crudNote: '校验规则：原文与代号均不可为空；代号仅允许 A-Z a-z 0-9 _；代号全局唯一。提示：搜索实时筛选；点击表头排序；添加表单内按回车提交。',
		// import
		importTitle: '导入映射表（粘贴 JSON）',
		importFormat: '格式：{ "prefix":"[[", "suffix":"]]", "mappings":[{ "real":"...", "code":"PROJ_01" }] }。',
		overwriteBtn: '清空后插入',
		mergeBtn: '插入',
		importHelp: '插入：把导入的映射追加到现有列表，已有代号不会重复添加（保留你现有的条目）。清空后插入：先清空现有全部映射，再用导入内容替换（相当于整表重来）。',
		parseSave: '解析并保存',
		errEmptyField: '存在空的原名或代号',
		errInvalid: '代号含非法字符：',
		errDuplicate: '代号重复：',
		imported: '已清空并插入 %d 条',
		importFail: '导入失败：',
		// commands
		cmdEncrypt: 'AI Alias：真实名转代号（选中/全文）',
		cmdDecrypt: 'AI Alias：代号转真实名（选中/全文）',
		cmdPrefix: 'AI Alias：复制 AI 提示词前缀（安全，无真实名称）',
		menuEncrypt: 'AI Alias：真实名 → 代号',
		menuDecrypt: 'AI Alias：代号 → 真实名',
		emptyEncrypt: '映射表为空，请先在设置中添加条目',
		emptyDecrypt: '映射表为空',
		encrypted: '已加密（选中内容 / 全文）',
		decrypted: '已解密（选中内容 / 全文）',
		// 裸代号（未加前后缀）兜底还原
		bareTitle: '发现未加前后缀的代号',
		bareDesc: '以下 %d 个代号未用 %p … %s 包裹，因此未被自动还原。勾选要还原为真实名的项，然后点“替换选中”。',
		bareWarn: '注意：裸代号可能与正常单词混淆，替换前请逐条核对上下文。',
		bareSelectAll: '全选',
		bareSelectNone: '清空选择',
		bareReplace: '替换选中（%d）',
		bareContext: '上下文',
		bareBodySection: '笔记正文',
		bareTitleSection: '笔记标题（文件名）',
		bareTitleWarn: '还原标题将重命名笔记文件，可能影响其它笔记对该笔记的链接。此重命名属于文件级操作，无法用笔记内的「撤销」（Ctrl/Cmd+Z）还原，请慎重操作。',
		bareTitleRenamed: '已重命名笔记标题',
		bareTitleSkip: '已跳过 %d 条含非法文件名字符的标题还原',
		prefixCopied: '已复制 AI 提示词前缀到剪贴板',
		copyFail: '复制失败：',
		promptPrefix: '注意：以下文本中的 %PXXX%S 形式字符串是占位代号（例如 %PPROJ_01%S、%PORG_ABC%S），代表被脱敏的真实实体。请严格原样保留这些代号，不要翻译、解释、改写或猜测其含义；若需提及，请继续使用同一代号。'
	}
};

function isValidCode(code: string): boolean {
	return /^[A-Za-z0-9_]+$/.test(code);
}

class BatchAddModal extends Modal {
	plugin: AIAliasPlugin;
	tab: AIAliasSettingTab;
	taEl!: HTMLTextAreaElement;
	previewEl!: HTMLElement;
	saveBtn!: HTMLElement;
	preview: { valid: Mapping[]; skipped: { line: string; reason: string }[] } | null = null;

	constructor(app: App, plugin: AIAliasPlugin, tab: AIAliasSettingTab) {
		super(app);
		this.plugin = plugin;
		this.tab = tab;
	}

	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		contentEl.createEl('h3', { text: t('batchTitle') });
		contentEl.createEl('p', { cls: 'ai-sub', text: t('batchFmt') });
		this.taEl = contentEl.createEl('textarea', { cls: 'ai-ta' });
		this.previewEl = contentEl.createEl('div', { cls: 'ai-preview' });
		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		foot.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.close());
		this.saveBtn = foot.createEl('button', { text: t('batchSave'), cls: 'mod-cta' });
		this.saveBtn.addEventListener('click', () => this.doSave());
		this.taEl.addEventListener('input', () => this.parse());
		this.parse();
	}

	parse(): void {
		const t = (k: string): string => this.plugin.t(k);
		const raw = this.taEl.value.split(/\r?\n/);
		const valid: Mapping[] = [];
		const skipped: { line: string; reason: string }[] = [];
		const seen = new Set<string>();
		for (const line of raw) {
			const s = line.trim();
			if (!s) continue;
			const m = s.match(/^(.*?)\s*(?:=|→|,|\t)\s*(.+)$/);
			if (!m) {
				skipped.push({ line: s, reason: t('errEmpty') });
				continue;
			}
			const real = m[1].trim();
			const code = m[2].trim();
			if (!real || !code) {
				skipped.push({ line: s, reason: t('errEmpty') });
				continue;
			}
			if (!isValidCode(code)) {
				skipped.push({ line: s, reason: t('errChars') });
				continue;
			}
			if (seen.has(code) || this.plugin.settings.mappings.some((mm) => mm.code === code)) {
				skipped.push({ line: s, reason: t('dupInBatch') });
				continue;
			}
			seen.add(code);
			valid.push({ real, code });
		}
		this.preview = { valid, skipped };
		this.previewEl.empty();
		if (valid.length === 0 && skipped.length === 0) {
			this.previewEl.createEl('div', { cls: 'ai-pitem' }).createEl('span', { cls: 'ai-warn', text: t('empty') });
		} else {
			for (const v of valid) {
				const p = this.previewEl.createEl('div', { cls: 'ai-pitem' });
				p.createEl('span', { text: v.real });
				p.createEl('span', { cls: 'ai-code', text: this.plugin.wrap(v.code) });
			}
			for (const sk of skipped) {
				const p = this.previewEl.createEl('div', { cls: 'ai-pitem' });
				p.createEl('span', { text: sk.line });
				p.createEl('span', { cls: 'ai-warn', text: t('previewWarn') + sk.reason });
			}
		}
		this.saveBtn.setText(t('batchSave') + (valid.length ? ` (${valid.length})` : ''));
	}

	doSave(): void {
		if (!this.preview || this.preview.valid.length === 0) {
			this.close();
			return;
		}
		this.plugin.settings.mappings.push(...this.preview.valid);
		void this.plugin.save();
		new Notice(this.plugin.t('addedN').replace('%d', String(this.preview.valid.length)));
		this.tab.renderTable();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class ImportModal extends Modal {
	plugin: AIAliasPlugin;
	tab: AIAliasSettingTab;
	taEl!: HTMLTextAreaElement;

	constructor(app: App, plugin: AIAliasPlugin, tab: AIAliasSettingTab) {
		super(app);
		this.plugin = plugin;
		this.tab = tab;
	}

	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		contentEl.createEl('h3', { text: t('importTitle') });
		contentEl.createEl('p', { cls: 'ai-sub', text: t('importFormat') });
		contentEl.createEl('p', { cls: 'ai-help', text: t('importHelp') });
		this.taEl = contentEl.createEl('textarea', { cls: 'ai-ta' });
		void navigator.clipboard.readText().then((txt) => (this.taEl.value = txt)).catch(() => undefined);
		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		foot.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.close());
		foot.createEl('button', { text: t('mergeBtn') }).addEventListener('click', () => this.doImport(true));
		foot.createEl('button', { text: t('overwriteBtn'), cls: 'mod-warning' }).addEventListener('click', () => this.doImport(false));
	}

	parseObj(): { prefix: string; suffix: string; mappings: Mapping[] } {
		const t = (k: string): string => this.plugin.t(k);
		const obj = JSON.parse(this.taEl.value) as { prefix?: unknown; suffix?: unknown; mappings?: unknown };
		const raw = Array.isArray(obj.mappings) ? (obj.mappings as Record<string, unknown>[]) : [];
		const mappings: Mapping[] = [];
		const seen = new Set<string>();
		for (const m of raw) {
			const real = typeof m.real === 'string' ? m.real.trim() : '';
			const code = typeof m.code === 'string' ? m.code.trim() : '';
			if (!real || !code) throw new Error(t('errEmptyField'));
			if (!isValidCode(code)) throw new Error(t('errInvalid') + code);
			if (seen.has(code)) throw new Error(t('errDuplicate') + code);
			seen.add(code);
			mappings.push({ real, code });
		}
		return {
			prefix: typeof obj.prefix === 'string' ? obj.prefix : '',
			suffix: typeof obj.suffix === 'string' ? obj.suffix : '',
			mappings
		};
	}

	applyPrefixSuffix(prefix: string, suffix: string): void {
		if (prefix !== '') this.plugin.settings.prefix = prefix;
		if (suffix !== '') this.plugin.settings.suffix = suffix;
	}

	doImport(merge: boolean): void {
		const t = (k: string): string => this.plugin.t(k);
		try {
			const { prefix, suffix, mappings } = this.parseObj();
			this.applyPrefixSuffix(prefix, suffix);
			if (merge) {
				const existing = new Set(this.plugin.settings.mappings.map((m) => m.code));
				let added = 0;
				for (const m of mappings) {
					if (!existing.has(m.code)) {
						this.plugin.settings.mappings.push(m);
						existing.add(m.code);
						added++;
					}
				}
				void this.plugin.save();
				new Notice(t('importMergeOk').replace('%d', String(added)));
			} else {
				this.plugin.settings.mappings = mappings;
				void this.plugin.save();
				new Notice(t('imported').replace('%d', String(mappings.length)));
			}
			this.tab.renderTable();
			this.close();
		} catch (e) {
			new Notice(t('importFail') + (e instanceof Error ? e.message : String(e)));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class BareCodeConfirmModal extends Modal {
	plugin: AIAliasPlugin;
	editor: Editor;
	isSelection: boolean;
	original: string;
	hits: BareHit[];
	checks: boolean[];
	checkEls: HTMLInputElement[] = [];
	file: TFile | null;
	title: string;
	titleHits: BareHit[];
	titleChecks: boolean[];
	titleCheckEls: HTMLInputElement[] = [];

	constructor(app: App, plugin: AIAliasPlugin, editor: Editor, isSelection: boolean, original: string, hits: BareHit[], file: TFile | null, titleHits: BareHit[]) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
		this.isSelection = isSelection;
		this.original = original;
		this.hits = hits;
		this.checks = hits.map(() => true); // default: all checked
		this.file = file;
		this.title = file ? file.basename : '';
		this.titleHits = titleHits;
		this.titleChecks = titleHits.map(() => true); // default: all checked (user choice)
	}

	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		const p = this.plugin.settings.prefix;
		const s = this.plugin.settings.suffix;

		const total = this.hits.length + this.titleHits.length;
		contentEl.createEl('h3', { text: t('bareTitle') });
		const desc = contentEl.createEl('p', { cls: 'ai-sub' });
		desc.innerHTML = t('bareDesc')
			.replace('%d', String(total))
			.replace('%p', p)
			.replace('%s', s);
		contentEl.createEl('p', { cls: 'ai-help', text: t('bareWarn') });

		if (this.hits.length > 0) {
			contentEl.createEl('p', { cls: 'ai-sub ai-context-label', text: t('bareBodySection') });
			const list = contentEl.createEl('div', { cls: 'ai-barelist' });
			this.hits.forEach((h, i) => {
				const row = list.createEl('div', { cls: 'ai-bareitem' });
				const cb = row.createEl('input', { type: 'checkbox' });
				cb.checked = true;
				cb.addEventListener('change', () => {
					this.checks[i] = cb.checked;
					this.refreshFooter();
				});
				this.checkEls.push(cb);
				const body = row.createEl('div', { cls: 'ai-barebody' });
				const codeLine = body.createEl('div', { cls: 'ai-barecode' });
				codeLine.createEl('span', { text: h.code, cls: 'ai-code' });
				codeLine.createEl('span', { text: '  →  ', cls: 'ai-arrow' });
				codeLine.createEl('span', { text: h.real, cls: 'ai-real' });
				this.renderContext(body, h, this.original);
			});
		}

		if (this.titleHits.length > 0) {
			contentEl.createEl('p', { cls: 'ai-sub ai-context-label', text: t('bareTitleSection') });
			const warnEl = contentEl.createEl('p', { cls: 'ai-help ai-help-warn' });
			warnEl.innerHTML = t('bareTitleWarn')
				.replace('此重命名', '<br>此重命名')
				.replace('This rename', '<br>This rename');
			const list = contentEl.createEl('div', { cls: 'ai-barelist' });
			this.titleHits.forEach((h, i) => {
				const row = list.createEl('div', { cls: 'ai-bareitem' });
				const cb = row.createEl('input', { type: 'checkbox' });
				cb.checked = this.titleChecks[i];
				cb.addEventListener('change', () => {
					this.titleChecks[i] = cb.checked;
					this.refreshFooter();
				});
				this.titleCheckEls.push(cb);
				const body = row.createEl('div', { cls: 'ai-barebody' });
				const codeLine = body.createEl('div', { cls: 'ai-barecode' });
				codeLine.createEl('span', { text: h.code, cls: 'ai-code' });
				codeLine.createEl('span', { text: '  →  ', cls: 'ai-arrow' });
				codeLine.createEl('span', { text: h.real, cls: 'ai-real' });
				this.renderContext(body, h, this.title);
			});
		}

		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		const selAll = foot.createEl('button', { text: t('bareSelectAll') });
		selAll.addEventListener('click', () => this.setAll(true));
		const selNone = foot.createEl('button', { text: t('bareSelectNone') });
		selNone.addEventListener('click', () => this.setAll(false));
		foot.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.close());
		this.replaceBtn = foot.createEl('button', { text: t('bareReplace').replace('%d', String(total)), cls: 'mod-cta' });
		this.replaceBtn.addEventListener('click', () => {
			void this.doReplace();
		});
	}

	private renderContext(parent: HTMLElement, h: BareHit, original: string): void {
		const before = original.slice(Math.max(0, h.start - 20), h.start);
		const after = original.slice(h.end, Math.min(original.length, h.end + 20));
		const lead = h.start > 20 ? '…' : '';
		const tail = h.end + 20 < original.length ? '…' : '';
		const ctx = parent.createEl('div', { cls: 'ai-barectx' });
		if (lead) ctx.createSpan({ text: lead });
		ctx.createSpan({ text: before });
		ctx.createSpan({ text: h.code, cls: 'ai-hl' });
		ctx.createSpan({ text: after });
		if (tail) ctx.createSpan({ text: tail });
	}

	private sanitizeFileName(s: string): string | null {
		const cleaned = s
			.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
			.replace(/^\.+/, '')
			.replace(/[.\s]+$/, '');
		return cleaned.length > 0 ? cleaned : null;
	}

	private setAll(v: boolean): void {
		this.checks = this.checks.map(() => v);
		this.checkEls.forEach((el) => (el.checked = v));
		this.titleChecks = this.titleChecks.map(() => v);
		this.titleCheckEls.forEach((el) => (el.checked = v));
		this.refreshFooter();
	}

	private refreshFooter(): void {
		const n = this.checks.filter(Boolean).length + this.titleChecks.filter(Boolean).length;
		this.replaceBtn.setText(this.plugin.t('bareReplace').replace('%d', String(n)));
	}

	private async doReplace(): Promise<void> {
		// ---- body replacement (in place) ----
		const sel = new Set<number>();
		this.checks.forEach((c, i) => {
			if (c) sel.add(i);
		});
		let out = '';
		let cursor = 0;
		for (let i = 0; i < this.hits.length; i++) {
			const h = this.hits[i];
			out += this.original.slice(cursor, h.start);
			out += sel.has(i) ? h.real : this.original.slice(h.start, h.end);
			cursor = h.end;
		}
		out += this.original.slice(cursor);
		if (this.isSelection) this.editor.replaceSelection(out);
		else this.editor.setValue(out);

		// ---- title rename (file operation) ----
		let titleMsg: string | null = null;
		if (this.file && this.titleHits.length > 0) {
			const chosen = this.titleHits
				.map((h, i) => ({ h, i }))
				.filter((x) => this.titleChecks[x.i])
				.sort((a, b) => a.h.start - b.h.start);
			if (chosen.length > 0) {
				let built = '';
				let c = 0;
				let skipped = 0;
				for (const { h } of chosen) {
					built += this.title.slice(c, h.start);
					const safe = this.sanitizeFileName(h.real);
					if (safe === null) {
						skipped++;
						c = h.end;
						continue;
					}
					built += safe;
					c = h.end;
				}
				built += this.title.slice(c);
				if (built !== this.title) {
					const dir = this.file.parent ? this.file.parent.path : '';
					const ext = this.file.extension ? '.' + this.file.extension : '';
					const newPath = (dir ? dir + '/' : '') + built + ext;
					try {
						await this.app.fileManager.renameFile(this.file, newPath);
						titleMsg = this.plugin.t('bareTitleRenamed');
						if (skipped > 0) titleMsg += '；' + this.plugin.t('bareTitleSkip').replace('%d', String(skipped));
					} catch (e) {
						titleMsg = '重命名标题失败：' + (e instanceof Error ? e.message : String(e));
					}
				} else if (skipped > 0) {
					titleMsg = this.plugin.t('bareTitleSkip').replace('%d', String(skipped));
				}
			}
		}

		const baseMsg = this.plugin.t('decrypted');
		new Notice(titleMsg ? baseMsg + '；' + titleMsg : baseMsg);
		this.close();
	}

	replaceBtn!: HTMLElement;
}

class AIAliasSettingTab extends PluginSettingTab {
	plugin: AIAliasPlugin;

	// CRUD state
	private searchTerm = '';
	private sortKey: 'real' | 'code' | null = null;
	private sortDir = 1;
	private selected = new Set<number>();
	private editing: number | null = null;
	private addOpen = false;

	// DOM refs
	private searchEl!: HTMLInputElement;
	private countEl!: HTMLElement;
	private tableEl!: HTMLElement;
	private addFormEl!: HTMLElement;
	private addRealEl!: HTMLInputElement;
	private addCodeEl!: HTMLInputElement;
	private addHintEl!: HTMLElement;

	constructor(app: App, plugin: AIAliasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const t = (k: string): string => this.plugin.t(k);

		containerEl.createEl('h2', { text: t('title') });

		new Setting(containerEl)
			.setName(t('language'))
			.setDesc(t('languageDesc'))
			.addDropdown((d) =>
				d
					.addOption('en', 'English')
					.addOption('zh', '中文')
					.setValue(this.plugin.settings.language)
					.onChange((v) => {
						this.plugin.settings.language = v as 'en' | 'zh';
						this.plugin.registerCommands();
						void this.plugin.save();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName(t('prefix'))
			.setDesc(t('prefixDesc'))
			.addText((tc) =>
				tc.setPlaceholder('[[').setValue(this.plugin.settings.prefix).onChange((v) => {
					this.plugin.settings.prefix = v;
					void this.plugin.save();
					this.renderTable();
				})
			);

		new Setting(containerEl)
			.setName(t('suffix'))
			.setDesc(t('suffixDesc'))
			.addText((tc) =>
				tc.setPlaceholder(']]').setValue(this.plugin.settings.suffix).onChange((v) => {
					this.plugin.settings.suffix = v;
					void this.plugin.save();
					this.renderTable();
				})
			);

		new Setting(containerEl)
			.setName(t('importExport'))
			.setDesc(t('importExportDesc'))
			.addButton((btn) =>
				btn.setButtonText(t('exportBtn')).onClick(() => {
					void navigator.clipboard
						.writeText(JSON.stringify(this.plugin.settings, null, 2))
						.then(() => new Notice(t('prefixCopied')))
						.catch((e) => new Notice(t('copyFail') + (e instanceof Error ? e.message : String(e))));
				})
			)
			.addButton((btn) =>
				btn.setButtonText(t('importBtn')).onClick(() => new ImportModal(this.app, this.plugin, this).open())
			);

		// ---- Mapping manager ----
		containerEl.createEl('h3', { text: t('mappingTitle'), cls: 'ai-h3' });

		const toolbar = containerEl.createEl('div', { cls: 'ai-toolbar' });
		const searchWrap = toolbar.createEl('div', { cls: 'ai-search' });
		this.searchEl = searchWrap.createEl('input', { type: 'text', placeholder: t('searchPh') });
		this.searchEl.value = this.searchTerm;
		this.searchEl.addEventListener('input', (e) => {
			this.searchTerm = (e.target as HTMLInputElement).value;
			this.renderTable();
		});
		this.countEl = toolbar.createEl('span', { cls: 'ai-count' });

		const btnBar = containerEl.createEl('div', { cls: 'ai-btns' });
		const addB = btnBar.createEl('button', { text: t('add'), cls: 'mod-cta' });
		addB.addEventListener('click', () => this.toggleAddForm());
		const batchB = btnBar.createEl('button', { text: t('batchAdd') });
		batchB.addEventListener('click', () => new BatchAddModal(this.app, this.plugin, this).open());
		const delSelB = btnBar.createEl('button', { text: t('delSel'), cls: 'mod-warning' });
		delSelB.addEventListener('click', () => this.deleteSelected());
		const clearB = btnBar.createEl('button', { text: t('clearAll'), cls: 'mod-warning' });
		clearB.addEventListener('click', () => this.clearAll());

		this.addFormEl = containerEl.createEl('div', { cls: 'ai-addform' });
		this.addFormEl.style.display = 'none';
		const f1 = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		f1.createEl('label', { text: t('realName') });
		this.addRealEl = f1.createEl('input', { type: 'text', placeholder: t('realPlaceholder') });
		this.addRealEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.addCodeEl.focus();
			}
		});
		const f2 = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		f2.createEl('label', { text: t('aliasName') });
		this.addCodeEl = f2.createEl('input', { type: 'text', placeholder: t('codePlaceholder') });
		this.addCodeEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.saveInlineAdd();
			}
		});
		const f3 = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		f3.createEl('label', { text: ' ' });
		f3.createEl('button', { text: t('addSave'), cls: 'mod-cta' }).addEventListener('click', () => this.saveInlineAdd());
		const f4 = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		f4.createEl('label', { text: ' ' });
		f4.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.toggleAddForm(true));
		this.addHintEl = this.addFormEl.createEl('div', { cls: 'ai-hint' });

		this.tableEl = containerEl.createEl('div', { cls: 'ai-table' });

		containerEl.createEl('div', { cls: 'ai-note', text: t('crudNote') });

		this.renderTable();
	}

	private toggleAddForm(forceClose = false): void {
		this.addOpen = forceClose ? false : !this.addOpen;
		this.addFormEl.style.display = this.addOpen ? 'flex' : 'none';
		this.addHintEl.setText('');
		if (this.addOpen) {
			this.addRealEl.focus();
		} else {
			this.addRealEl.value = '';
			this.addCodeEl.value = '';
		}
	}

	private filteredMappings(): { real: string; code: string; i: number }[] {
		let list = this.plugin.settings.mappings.map((m, i) => ({ ...m, i }));
		const q = this.searchTerm.trim().toLowerCase();
		if (q) {
			list = list.filter((m) => m.real.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
		}
		if (this.sortKey) {
			const key = this.sortKey;
			list.sort((a, b) => {
				const va = a[key].toLowerCase();
				const vb = b[key].toLowerCase();
				return va < vb ? -1 * this.sortDir : va > vb ? 1 * this.sortDir : 0;
			});
		}
		return list;
	}

	renderTable(): void {
		const t = (k: string): string => this.plugin.t(k);
		const tableEl = this.tableEl;
		tableEl.empty();
		const list = this.filteredMappings();
		this.countEl.setText(`共 ${this.plugin.settings.mappings.length} 条 · 显示 ${list.length} 条`);

		const table = tableEl.createEl('table', { cls: 'ai-alias-tbl' });
		const thead = table.createEl('thead');
		const htr = thead.createEl('tr');
		const thCb = htr.createEl('th');
		const selAll = thCb.createEl('input', { type: 'checkbox' });
		selAll.addEventListener('change', (e) => {
			const checked = (e.target as HTMLInputElement).checked;
			if (checked) list.forEach((m) => this.selected.add(m.i));
			else this.selected.clear();
			this.renderTable();
		});
		const thReal = htr.createEl('th', {
			text: t('thReal') + (this.sortKey === 'real' ? (this.sortDir > 0 ? ' ▲' : ' ▼') : '')
		});
		thReal.addEventListener('click', () => this.toggleSort('real'));
		const thCode = htr.createEl('th', {
			text: t('thCode') + (this.sortKey === 'code' ? (this.sortDir > 0 ? ' ▲' : ' ▼') : '')
		});
		thCode.addEventListener('click', () => this.toggleSort('code'));
		thCode.addClass('ai-right');
		htr.createEl('th', { text: t('actions') }).addClass('ai-right');

		const tbody = table.createEl('tbody');
		if (this.plugin.settings.mappings.length === 0) {
			const tr = tbody.createEl('tr');
			const td = tr.createEl('td', { text: t('empty') });
			td.setAttribute('colspan', '4');
			td.addClass('ai-empty');
			return;
		}
		if (list.length === 0) {
			const tr = tbody.createEl('tr');
			const td = tr.createEl('td', { text: t('filteredEmpty') });
			td.setAttribute('colspan', '4');
			td.addClass('ai-empty');
			return;
		}
		for (const m of list) {
			const tr = tbody.createEl('tr');
			if (this.selected.has(m.i)) tr.addClass('ai-sel');
			const tdCb = tr.createEl('td');
			const cb = tdCb.createEl('input', { type: 'checkbox' });
			cb.checked = this.selected.has(m.i);
			cb.addEventListener('change', (e) => {
				const checked = (e.target as HTMLInputElement).checked;
				if (checked) this.selected.add(m.i);
				else this.selected.delete(m.i);
				tr.toggleClass('ai-sel', checked);
			});
			if (this.editing === m.i) {
				const tdR = tr.createEl('td');
				const inR = tdR.createEl('input', { type: 'text', cls: 'ai-edit-in' }) as HTMLInputElement;
				inR.value = m.real;
				const tdC = tr.createEl('td');
				const inC = tdC.createEl('input', { type: 'text', cls: 'ai-edit-in' }) as HTMLInputElement;
				inC.value = m.code;
				const tdA = tr.createEl('td');
				tdA.addClass('ai-right');
				tdA.createEl('button', { text: t('addSave'), cls: 'mod-cta' }).addEventListener('click', () =>
					this.saveEdit(m.i, inR.value, inC.value)
				);
				tdA.createEl('button', { text: t('cancel') }).addEventListener('click', () => {
					this.editing = null;
					this.renderTable();
				});
			} else {
				tr.createEl('td', { text: m.real });
				const tdC = tr.createEl('td', { text: this.plugin.wrap(m.code) });
				tdC.addClass('ai-code');
				const tdA = tr.createEl('td');
				tdA.addClass('ai-right');
				tdA.createEl('button', { text: t('edit') }).addEventListener('click', () => {
					this.editing = m.i;
					this.selected.clear();
					this.renderTable();
				});
				tdA.createEl('button', { text: t('del'), cls: 'mod-warning' }).addEventListener('click', () =>
					this.deleteOne(m.i)
				);
			}
		}
	}

	private toggleSort(k: 'real' | 'code'): void {
		if (this.sortKey === k) this.sortDir *= -1;
		else {
			this.sortKey = k;
			this.sortDir = 1;
		}
		this.renderTable();
	}

	private saveInlineAdd(): void {
		const t = (k: string): string => this.plugin.t(k);
		const real = this.addRealEl.value.trim();
		const code = this.addCodeEl.value.trim();
		if (!real || !code) {
			this.addHintEl.setText(t('errEmpty'));
			this.addHintEl.className = 'ai-hint ai-err';
			return;
		}
		if (!isValidCode(code)) {
			this.addHintEl.setText(t('errChars'));
			this.addHintEl.className = 'ai-hint ai-err';
			return;
		}
		if (this.plugin.settings.mappings.some((m) => m.code === code)) {
			this.addHintEl.setText(t('errDup'));
			this.addHintEl.className = 'ai-hint ai-err';
			return;
		}
		this.plugin.settings.mappings.push({ real, code });
		void this.plugin.save();
		this.addHintEl.setText(t('added') + this.plugin.wrap(code));
		this.addHintEl.className = 'ai-hint ai-ok';
		this.addRealEl.value = '';
		this.addCodeEl.value = '';
		this.addRealEl.focus();
		this.renderTable();
	}

	private saveEdit(i: number, realRaw: string, codeRaw: string): void {
		const t = (k: string): string => this.plugin.t(k);
		const real = realRaw.trim();
		const code = codeRaw.trim();
		if (!real || !code) {
			new Notice(t('errEmpty'));
			return;
		}
		if (!isValidCode(code)) {
			new Notice(t('errChars'));
			return;
		}
		if (this.plugin.settings.mappings.some((m, j) => j !== i && m.code === code)) {
			new Notice(t('errDup'));
			return;
		}
		this.plugin.settings.mappings[i] = { real, code };
		this.editing = null;
		void this.plugin.save();
		new Notice(t('edited'));
		this.renderTable();
	}

	private deleteOne(i: number): void {
		this.plugin.settings.mappings.splice(i, 1);
		this.selected.clear();
		if (this.editing !== null) {
			if (this.editing === i) this.editing = null;
			else if (this.editing > i) this.editing -= 1;
		}
		void this.plugin.save();
		new Notice(this.plugin.t('delOne'));
		this.renderTable();
	}

	private deleteSelected(): void {
		if (this.selected.size === 0) {
			new Notice(this.plugin.t('cancelClear'));
			return;
		}
		if (!confirm(this.plugin.t('confirmDelSel').replace('%d', String(this.selected.size)))) return;
		const idxs = [...this.selected].sort((a, b) => b - a);
		idxs.forEach((i) => this.plugin.settings.mappings.splice(i, 1));
		const n = idxs.length;
		this.selected.clear();
		void this.plugin.save();
		new Notice(this.plugin.t('delN').replace('%d', String(n)));
		this.renderTable();
	}

	private clearAll(): void {
		if (this.plugin.settings.mappings.length === 0) return;
		if (!confirm(this.plugin.t('confirmClear').replace('%d', String(this.plugin.settings.mappings.length)))) {
			new Notice(this.plugin.t('cancelClear'));
			return;
		}
		const n = this.plugin.settings.mappings.length;
		this.plugin.settings.mappings = [];
		this.selected.clear();
		this.editing = null;
		void this.plugin.save();
		new Notice(this.plugin.t('delN').replace('%d', String(n)));
		this.renderTable();
	}
}

export default class AIAliasPlugin extends Plugin {
	settings!: AIAliasSettings;
	settingsTab!: AIAliasSettingTab;

	t(key: string): string {
		const lang = this.settings.language || 'en';
		return STR[lang] && STR[lang][key] !== undefined ? STR[lang][key] : STR.en[key];
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.settingsTab = new AIAliasSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);
		this.registerCommands();

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				menu.addItem((item) =>
					item.setTitle(this.t('menuEncrypt')).setIcon('lock').onClick(() => this.runEncrypt(editor))
				);
				menu.addItem((item) =>
					item.setTitle(this.t('menuDecrypt')).setIcon('unlock').onClick(() => this.runDecrypt(editor))
				);
			})
		);
	}

	registerCommands(): void {
		const ids = ['encrypt', 'decrypt', 'copy-ai-prefix'];
		const appCommands = (this.app as unknown as { commands: { removeCommand: (id: string) => void } }).commands;
		for (const id of ids) {
			appCommands.removeCommand(this.manifest.id + ':' + id);
		}

		this.addCommand({
			id: 'encrypt',
			name: this.t('cmdEncrypt'),
			editorCallback: (editor: Editor) => this.runEncrypt(editor)
		});
		this.addCommand({
			id: 'decrypt',
			name: this.t('cmdDecrypt'),
			editorCallback: (editor: Editor) => this.runDecrypt(editor)
		});
		this.addCommand({
			id: 'copy-ai-prefix',
			name: this.t('cmdPrefix'),
			callback: () => {
				const p = this.settings.prefix;
				const s = this.settings.suffix;
				const text = this.t('promptPrefix').split('%P').join(p).split('%S').join(s);
				void navigator.clipboard
					.writeText(text)
					.then(() => new Notice(this.t('prefixCopied')))
					.catch((e) => new Notice(this.t('copyFail') + (e instanceof Error ? e.message : String(e))));
			}
		});
	}

	wrap(code: string): string {
		return this.settings.prefix + code + this.settings.suffix;
	}

	runEncrypt(editor: Editor): void {
		if (this.settings.mappings.length === 0) {
			new Notice(this.t('emptyEncrypt'));
			return;
		}
		const sel = editor.getSelection();
		if (sel && sel.length > 0) {
			editor.replaceSelection(this.encrypt(sel));
		} else {
			editor.setValue(this.encrypt(editor.getValue()));
		}
		new Notice(this.t('encrypted'));
	}

	runDecrypt(editor: Editor): void {
		if (this.settings.mappings.length === 0) {
			new Notice(this.t('emptyDecrypt'));
			return;
		}
		const file = this.app.workspace.getActiveFile();
		const sel = editor.getSelection();
		const isSelection = !!(sel && sel.length > 0);
		const text = isSelection ? sel : editor.getValue();
		const decrypted = this.decrypt(text);
		const hits = this.scanBareCodes(decrypted);
		const titleHits = file ? this.scanBareCodes(file.basename) : [];
		if (hits.length === 0 && titleHits.length === 0) {
			// nothing unwrapped — write back directly, no interruption
			if (isSelection) editor.replaceSelection(decrypted);
			else editor.setValue(decrypted);
			new Notice(this.t('decrypted'));
			return;
		}
		new BareCodeConfirmModal(this.app, this, editor, isSelection, decrypted, hits, file, titleHits).open();
	}

	encrypt(text: string): string {
		const ms = [...this.settings.mappings].sort((a, b) => b.real.length - a.real.length);
		let out = text;
		for (const m of ms) {
			if (!m.real) continue;
			out = out.split(m.real).join(this.wrap(m.code));
		}
		return out;
	}

	decrypt(text: string): string {
		let out = text;
		for (const m of this.settings.mappings) {
			out = out.split(this.wrap(m.code)).join(m.real);
		}
		return out;
	}

	private buildBareRegex(code: string): RegExp {
		const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// word-ish boundary: code must not be glued to another letter/digit/underscore
		return new RegExp('(?<![A-Za-z0-9_])' + esc + '(?![A-Za-z0-9_])', 'g');
	}

	// Scan for alias codes that appear WITHOUT the prefix/suffix wrapper.
	// Called after decrypt(), so wrapped codes are already converted to real names.
	scanBareCodes(text: string): BareHit[] {
		const hits: BareHit[] = [];
		for (const m of this.settings.mappings) {
			const re = this.buildBareRegex(m.code);
			let mm: RegExpExecArray | null;
			while ((mm = re.exec(text)) !== null) {
				hits.push({ start: mm.index, end: mm.index + mm[0].length, code: m.code, real: m.real });
				if (mm[0].length === 0) re.lastIndex++;
			}
		}
		// resolve overlaps: prefer the earlier start, and among same start the longer match
		hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
		const resolved: BareHit[] = [];
		let lastEnd = -1;
		for (const h of hits) {
			if (h.start >= lastEnd) {
				resolved.push(h);
				lastEnd = h.end;
			}
		}
		return resolved;
	}

	async save(): Promise<void> {
		await this.saveData(this.settings);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<AIAliasSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {}) as AIAliasSettings;
		if (!Array.isArray(this.settings.mappings)) this.settings.mappings = [];
		if (this.settings.language !== 'zh') this.settings.language = 'en';
	}
}
