import { Plugin, PluginSettingTab, Setting, Notice, Modal, Editor, App } from 'obsidian';

interface Mapping {
	real: string;
	code: string;
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
		addMapping: 'Add mapping',
		addMappingDesc: 'Real name → your alphanumeric alias',
		add: 'Add',
		importExport: 'Import / Export mappings',
		importExportDesc: 'Export: copy JSON to clipboard (safe, not written to any note). Import: paste JSON from clipboard to overwrite current settings.',
		exportBtn: 'Export to clipboard',
		importBtn: 'Import from clipboard',
		current: 'Current mappings (%d entries)',
		empty: '(empty) Add an entry first.',
		delete: 'Delete',
		addTitle: 'Add Mapping',
		realName: 'Real name (original)',
		realNameDesc: 'The actual sensitive name to mask',
		realPlaceholder: 'e.g. TianShu Project',
		aliasName: 'Alias (letters, digits, underscore)',
		aliasDesc: 'Your custom placeholder code, wrapped with prefix/suffix',
		aliasPlaceholder: 'e.g. PROJ_01',
		errEmpty: 'Real name and alias cannot be empty',
		errChars: 'Alias may only contain letters, digits and underscore',
		errDup: 'This alias already exists, choose another',
		added: 'Added: ',
		importTitle: 'Import Mappings (paste JSON)',
		importFormat: 'Format: { "prefix":"[[", "suffix":"]]", "mappings":[{ "real":"...", "code":"PROJ_01" }] }. Importing overwrites current settings.',
		parseSave: 'Parse & Save',
		errEmptyField: 'Found empty real name or alias',
		errInvalid: 'Alias has invalid chars: ',
		errDuplicate: 'Duplicate alias: ',
		imported: 'Imported %d entries',
		importFail: 'Import failed: ',
		cmdEncrypt: 'AI Alias: Convert real names to aliases (selection or whole note)',
		cmdDecrypt: 'AI Alias: Convert aliases to real names (selection or whole note)',
		cmdPrefix: 'AI Alias: Copy AI prompt prefix (safe, no real names)',
		menuEncrypt: 'AI Alias: Real name → Alias',
		menuDecrypt: 'AI Alias: Alias → Real name',
		emptyEncrypt: 'Mapping table is empty; add entries in settings first',
		emptyDecrypt: 'Mapping table is empty',
		encrypted: 'Encrypted (selection / whole note)',
		decrypted: 'Decrypted (selection / whole note)',
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
		addMapping: '添加映射',
		addMappingDesc: '真实名称 → 你的字母数字代号',
		add: '添加',
		importExport: '导入 / 导出映射',
		importExportDesc: '导出：复制 JSON 到剪贴板（安全，不写入任何笔记）。导入：从剪贴板粘贴 JSON 覆盖当前设置。',
		exportBtn: '导出到剪贴板',
		importBtn: '从剪贴板导入',
		current: '当前映射表（共 %d 条）',
		empty: '（空）请先添加条目。',
		delete: '删除',
		addTitle: '添加映射',
		realName: '原文（真实名称）',
		realNameDesc: '需要被脱敏的实际名称',
		realPlaceholder: '如：天枢项目',
		aliasName: '代号（字母、数字、下划线）',
		aliasDesc: '你自定义的占位代号，将包裹在前后缀中使用',
		aliasPlaceholder: '如：PROJ_01',
		errEmpty: '原文和代号都不能为空',
		errChars: '代号只能包含字母、数字、下划线',
		errDup: '该代号已存在，请换一个',
		added: '已添加：',
		importTitle: '导入映射表（粘贴 JSON）',
		importFormat: '格式：{ "prefix":"[[", "suffix":"]]", "mappings":[{ "real":"...", "code":"PROJ_01" }] }。导入会覆盖当前设置。',
		parseSave: '解析并保存',
		errEmptyField: '存在空的原名或代号',
		errInvalid: '代号含非法字符：',
		errDuplicate: '代号重复：',
		imported: '导入成功，共 %d 条',
		importFail: '导入失败：',
		cmdEncrypt: 'AI Alias：真实名转代号（选中/全文）',
		cmdDecrypt: 'AI Alias：代号转真实名（选中/全文）',
		cmdPrefix: 'AI Alias：复制 AI 提示词前缀（安全，无真实名称）',
		menuEncrypt: 'AI Alias：真实名 → 代号',
		menuDecrypt: 'AI Alias：代号 → 真实名',
		emptyEncrypt: '映射表为空，请先在设置中添加条目',
		emptyDecrypt: '映射表为空',
		encrypted: '已加密（选中内容 / 全文）',
		decrypted: '已解密（选中内容 / 全文）',
		prefixCopied: '已复制 AI 提示词前缀到剪贴板',
		copyFail: '复制失败：',
		promptPrefix: '注意：以下文本中的 %PXXX%S 形式字符串是占位代号（例如 %PPROJ_01%S、%PORG_ABC%S），代表被脱敏的真实实体。请严格原样保留这些代号，不要翻译、解释、改写或猜测其含义；若需提及，请继续使用同一代号。'
	}
};

class AddMappingModal extends Modal {
	plugin: AIAliasPlugin;
	constructor(app: App, plugin: AIAliasPlugin) {
		super(app);
		this.plugin = plugin;
	}
	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		contentEl.createEl('h3', { text: t('addTitle') });
		let real = '';
		let code = '';
		new Setting(contentEl)
			.setName(t('realName'))
			.setDesc(t('realNameDesc'))
			.addText((el) => el.setPlaceholder(t('realPlaceholder')).onChange((v) => (real = v)));
		new Setting(contentEl)
			.setName(t('aliasName'))
			.setDesc(t('aliasDesc'))
			.addText((el) => el.setPlaceholder(t('aliasPlaceholder')).onChange((v) => (code = v)));
		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(t('add'))
				.setCta()
				.onClick(async () => {
					if (!real || !code) {
						new Notice(t('errEmpty'));
						return;
					}
					if (!/^[A-Za-z0-9_]+$/.test(code)) {
						new Notice(t('errChars'));
						return;
					}
					if (this.plugin.settings.mappings.some((m) => m.code === code)) {
						new Notice(t('errDup'));
						return;
					}
					this.plugin.settings.mappings.push({ real, code });
					await this.plugin.save();
					if (this.plugin.settingsTab) this.plugin.settingsTab.display();
					new Notice(t('added') + code);
					this.close();
				})
		);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

class ImportModal extends Modal {
	plugin: AIAliasPlugin;
	constructor(app: App, plugin: AIAliasPlugin) {
		super(app);
		this.plugin = plugin;
	}
	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		contentEl.createEl('h3', { text: t('importTitle') });
		contentEl.createEl('p', { text: t('importFormat') });
		const ta = contentEl.createEl('textarea', {
			attr: { rows: 14, style: 'width:100%;font-family:monospace;' }
		});
		void navigator.clipboard.readText().then((txt) => (ta.value = txt)).catch(() => undefined);
		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(t('parseSave'))
				.setCta()
				.onClick(async () => {
				try {
					const obj = JSON.parse(ta.value) as {
						prefix?: unknown;
						suffix?: unknown;
						mappings?: unknown;
					};
					const raw = Array.isArray(obj.mappings) ? (obj.mappings as Record<string, unknown>[]) : [];
					const mappings: Mapping[] = [];
					const seen = new Set<string>();
					for (const m of raw) {
						const real = typeof m.real === 'string' ? m.real : '';
						const code = typeof m.code === 'string' ? m.code : '';
						if (!real || !code) throw new Error(t('errEmptyField'));
						if (!/^[A-Za-z0-9_]+$/.test(code)) throw new Error(t('errInvalid') + code);
						if (seen.has(code)) throw new Error(t('errDuplicate') + code);
						seen.add(code);
						mappings.push({ real, code });
					}
					this.plugin.settings.prefix =
						typeof obj.prefix === 'string' && obj.prefix !== '' ? obj.prefix : this.plugin.settings.prefix;
					this.plugin.settings.suffix =
						typeof obj.suffix === 'string' && obj.suffix !== '' ? obj.suffix : this.plugin.settings.suffix;
					this.plugin.settings.mappings = mappings;
					await this.plugin.save();
					if (this.plugin.settingsTab) this.plugin.settingsTab.display();
					new Notice(t('imported').replace('%d', String(mappings.length)));
					this.close();
				} catch (e) {
					new Notice(t('importFail') + (e instanceof Error ? e.message : String(e)));
				}
				})
		);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

class AIAliasSettingTab extends PluginSettingTab {
	plugin: AIAliasPlugin;
	constructor(app: App, plugin: AIAliasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display(): void {
		const { containerEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		containerEl.empty();
		new Setting(containerEl).setName(t('title')).setHeading();

		new Setting(containerEl)
			.setName(t('language'))
			.setDesc(t('languageDesc'))
			.addDropdown((d) => {
				d.addOption('en', 'English');
				d.addOption('zh', '中文');
				d.setValue(this.plugin.settings.language || 'en');
				d.onChange(async (v) => {
					this.plugin.settings.language = v as 'en' | 'zh';
					await this.plugin.save();
					this.plugin.registerCommands();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName(t('prefix'))
			.setDesc(t('prefixDesc'))
			.addText((el) =>
				el.setValue(this.plugin.settings.prefix).onChange(async (v) => {
					this.plugin.settings.prefix = v;
					await this.plugin.save();
				})
			);
		new Setting(containerEl)
			.setName(t('suffix'))
			.setDesc(t('suffixDesc'))
			.addText((el) =>
				el.setValue(this.plugin.settings.suffix).onChange(async (v) => {
					this.plugin.settings.suffix = v;
					await this.plugin.save();
				})
			);

		new Setting(containerEl)
			.setName(t('addMapping'))
			.setDesc(t('addMappingDesc'))
			.addButton((btn) =>
				btn.setButtonText(t('add')).setCta().onClick(() => new AddMappingModal(this.app, this.plugin).open())
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
				btn.setButtonText(t('importBtn')).onClick(() => new ImportModal(this.app, this.plugin).open())
			);

		new Setting(containerEl).setName(t('current').replace('%d', String(this.plugin.settings.mappings.length))).setHeading();
		if (this.plugin.settings.mappings.length === 0) {
			containerEl.createEl('p', { text: t('empty') });
		}
		this.plugin.settings.mappings.forEach((m, i) => {
			new Setting(containerEl)
				.setName(this.plugin.settings.prefix + m.code + this.plugin.settings.suffix)
				.setDesc(m.real)
				.addButton((btn) =>
					btn.setButtonText(t('delete')).onClick(async () => {
						this.plugin.settings.mappings.splice(i, 1);
						await this.plugin.save();
						this.display();
					})
				);
		});
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
		const sel = editor.getSelection();
		if (sel && sel.length > 0) {
			editor.replaceSelection(this.decrypt(sel));
		} else {
			editor.setValue(this.decrypt(editor.getValue()));
		}
		new Notice(this.t('decrypted'));
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

	async save(): Promise<void> {
		await this.saveData(this.settings);
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data) as AIAliasSettings;
		if (!Array.isArray(this.settings.mappings)) this.settings.mappings = [];
		if (this.settings.language !== 'zh') this.settings.language = 'en';
	}
}
