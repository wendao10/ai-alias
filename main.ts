import {
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	Modal,
	Editor,
	App,
	TFile,
	TFolder,
	TAbstractFile,
	Menu,
	Vault,
	setIcon
} from 'obsidian';

interface Category {
	id: string;
	key?: string;
	name: string;
	prefix: string;
	seq: number;
}

interface Mapping {
	real: string;
	code: string;
	category?: string | null;
	manual?: boolean;
}

interface AIAliasSettings {
	prefix: string;
	suffix: string;
	language: 'en' | 'zh';
	mappings: Mapping[];
	categories: Category[];
	schemaVersion?: number;
	// ---- v1.7.0 batch operations ----
	batchIncludeSubfolders: boolean;
	batchBareCodePolicy: 'skip' | 'confirmAll';
	batchRenameTitles: boolean;
	batchSkipFrontmatter: boolean;
	batchBackupEnabled: boolean;
	batchBackupKeep: number;
}

const SCHEMA_VERSION = 2;
const FILTER_ALL = '__all__';
const FILTER_UNCAT = '__uncat__';

// batch tuning
const BATCH_YIELD = 20; // files scanned between main-thread yields
const BATCH_MANY = 100; // above this many changed files the warning turns red + needs a second confirm
const SNAPSHOT_VERSION = 1;

const DEFAULT_SETTINGS: AIAliasSettings = {
	prefix: '[[',
	suffix: ']]',
	language: 'en',
	mappings: [],
	categories: [],
	batchIncludeSubfolders: true,
	batchBareCodePolicy: 'confirmAll',
	batchRenameTitles: false,
	batchSkipFrontmatter: true,
	batchBackupEnabled: true,
	batchBackupKeep: 5
};

interface PresetDef {
	key: string;
	en: string;
	zh: string;
	prefix: string;
}

const PRESET_DEFS: PresetDef[] = [
	{ key: 'platform', en: 'Platform', zh: '平台', prefix: 'PLATFORM' },
	{ key: 'resource', en: 'Resource', zh: '资源', prefix: 'RESOURCE' },
	{ key: 'person', en: 'Person', zh: '人名', prefix: 'PERSON' },
	{ key: 'place', en: 'Place', zh: '地点', prefix: 'PLACE' },
	{ key: 'dept1', en: 'Department L1', zh: '部门(一级)', prefix: 'DEPT1' },
	{ key: 'dept2', en: 'Department L2', zh: '部门(二级)', prefix: 'DEPT2' }
];

const PAGE = 10;

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
		searchPh: 'Search real name, alias or category…',
		batchAdd: 'Batch add',
		delSel: 'Delete selected',
		clearAll: 'Clear all',
		addSave: 'Save',
		cancel: 'Cancel',
		thReal: 'Real name',
		thCode: 'Alias',
		thCat: 'Category',
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
		batchFmt: 'One per line. "real" → auto alias in default category; "real|category" → that category; "real=code" → manual alias (uncategorized). Blank lines ignored.',
		batchSave: 'Add',
		previewWarn: 'Skipped: ',
		dupInBatch: 'duplicate in batch',
		importMergeOk: 'Inserted %d new entries',
		crudNote: 'Tips: search filters live (real/alias/category); use the category dropdown to filter; click a column header to sort; the add form auto-generates the alias from the chosen category; pages of 10.',
		// import
		importTitle: 'Import Mappings (paste JSON)',
		importFormat: 'Format: { "prefix":"[[", "suffix":"]]", "mappings":[{ "real":"...", "code":"PROJ_01", "category":"platform" }] }.',
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
cmdEncrypt: 'AI Alias: Convert real names to aliases (真实名转代号)',
cmdDecrypt: 'AI Alias: Convert aliases to real names (代号转真实名)',
cmdPrefix: 'AI Alias: Copy AI prompt prefix (复制 AI 提示词前缀)',
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
		bareTitleWarn1: 'Restoring the title renames the note file and may affect links from other notes to this note.',
		bareTitleWarn2: 'This rename is a file-level operation and cannot be undone with the in-note Undo (Ctrl/Cmd+Z) — please proceed with caution.',
		bareTitleRenamed: 'Renamed note title',
		bareTitleSkip: 'Skipped %d title entr(y/ies) with invalid file-name characters',
		prefixCopied: 'Copied AI prompt prefix to clipboard',
		copyFail: 'Copy failed: ',
		promptPrefix: 'Note: strings in the form %PXXX%S in the following text are placeholder aliases (e.g. %PPROJ_01%S, %PORG_ABC%S), representing masked real entities. Keep these aliases exactly as-is: do not translate, explain, rewrite, or guess their meaning; if you need to refer to them, keep using the same alias.',
		// category auto-alias (v1.6.0)
		catTitle: 'Categories',
		catAdd: 'Add category',
		catNamePh: 'Name',
		catPrefixPh: 'Prefix',
		catPrefixDesc: 'Letters/digits only; must be globally unique. Changing a prefix keeps existing aliases unchanged; only new aliases use the new prefix.',
		catNameErr: 'Name cannot be empty',
		catPrefixErr: 'Prefix must be letters/digits only',
		catPrefixDup: 'This prefix already exists',
		catPrefixKept: 'Existing aliases keep their old prefix; only new ones use the new prefix.',
		catDel: 'Delete category',
		catDelBlock: 'Category "%n" still has %d mapping(s). Please reassign or delete them before removing this category.',
		catFilterAll: 'All categories',
		addCat: 'Category',
		manualCode: 'Manual alias (optional)',
		autoPreview: 'Will generate: %c',
		needCat: 'Select a category or enter a manual alias',
		noCat: 'Uncategorized',
		allCats: 'All categories',
		uncatNotice: 'Found %d uncategorized mapping(s). You can auto-categorize or keep them (decryption unaffected).',
		smartCat: 'Auto-categorize',
		smartCatDone: 'Categorized %d; %d unrecognized (set manually).',
		ok: 'OK',
		legendTitle: 'Alias legend (prefix = category):',
		realName: 'Real name',
		aliasName: 'Alias',
		realPlaceholder: 'Real name',
		codePlaceholder: 'Alias (letters/digits/_)',
		pagerPrev: 'Prev',
		pagerNext: 'Next',
		catNotFound: 'Category not found',
		batchPerLine: 'Per line: real|category',
		batchCatDefault: 'Default category',
		// ---- v1.7.0 batch operations: settings ----
		batchHeading: 'Batch operations (file explorer)',
		batchIncludeSub: 'Include subfolders',
		batchIncludeSubDesc: 'When running a batch action on a folder, also process notes inside its subfolders.',
		batchBarePolicy: 'Bare alias codes on batch decrypt',
		batchBarePolicyDesc:
			'A bare code is an alias that appears without the wrapper (AI replies often drop it). "Confirm each" lists every bare code, unchecked by default. "Skip" restores only aliases that still have the wrapper.',
		batchBarePolicyConfirm: 'Confirm each (recommended)',
		batchBarePolicySkip: 'Skip bare codes',
		batchRename: 'Also restore note titles on batch decrypt',
		batchRenameDesc:
			'Renames the note files. This affects links from other notes and cannot be undone with Ctrl/Cmd+Z. Off by default.',
		batchSkipFm: 'Skip YAML frontmatter when batch encrypting',
		batchSkipFmDesc: 'Leave the leading --- properties block untouched so it stays valid YAML.',
		batchBackup: 'Create a snapshot before writing',
		batchBackupDesc:
			'Stores the original content of every file about to change so "Undo last batch operation" can roll it back. Snapshots contain real names and live in the plugin folder next to your mapping table.',
		batchBackupKeepName: 'Snapshots to keep',
		batchBackupKeepDesc: 'Older snapshots are removed automatically. Allowed range 1–20.',
		// ---- v1.7.0 batch operations: menu ----
		menuBatchEncFile: 'AI Alias: Real name → Alias',
		menuBatchDecFile: 'AI Alias: Alias → Real name',
		menuBatchEncFolder: 'AI Alias: Batch encrypt (%d notes)',
		menuBatchDecFolder: 'AI Alias: Batch decrypt (%d notes)',
		menuBatchEncSel: 'AI Alias: Batch encrypt (%d selected)',
		menuBatchDecSel: 'AI Alias: Batch decrypt (%d selected)',
		// ---- v1.7.0 batch operations: run-time notices ----
		batchScanning: 'Scanning… %a / %b',
		batchWriting: 'Writing… %a / %b',
		batchNoTargets: 'No markdown notes in the selection',
		batchDone: 'Done: %f note(s) · %n replacement(s)',
		batchDoneFail: ' · %d failed',
		batchDoneConflict: ' · %d skipped (changed since the scan)',
		batchDoneUndoable: ' · undoable',
		backupFail: 'Snapshot failed, nothing was written: ',
		// ---- v1.7.0 batch operations: preview modal ----
		bpEncTitle: 'Batch encrypt preview',
		bpDecTitle: 'Batch decrypt preview',
		bpTarget: 'Target: %s',
		bpRecursive: ' (including subfolders)',
		bpSummary: 'Scanned %s note(s) → will change %c · %n replacement(s)',
		bpBreakdown: 'With alias %w · bare %b · titles %t',
		bpPolicyHint: 'Bare codes are listed one by one for you to confirm; nothing is restored automatically.',
		bpSkipBare: 'Skip bare codes (restore only aliases that have the wrapper)',
		bpRenameTitles: 'Also restore note titles (renames the files)',
		bpRenameWarn: 'Renaming affects links from other notes and cannot be undone with Ctrl/Cmd+Z.',
		bpNoChange: 'no change',
		bpBadgeWrapped: 'contains %d',
		bpBadgeBare: 'bare %d',
		bpBadgeTitle: 'title %d',
		bpBadgeReal: '%d hit(s)',
		bpSecWrapped: 'Aliases with wrapper (always restored)',
		bpSecBare: 'Bare codes (check the ones to restore)',
		bpSecTitle: 'Note title',
		bpSecReal: 'Real names to mask',
		bpWarn: 'This writes straight to disk. In-note undo (Ctrl/Cmd+Z) will not bring it back.',
		bpWarnBackup: 'A snapshot is created automatically — use "Undo last batch operation" to roll back.',
		bpWarnNoBackup: 'Snapshots are turned OFF in settings, so this cannot be rolled back.',
		bpWarnMany: 'More than %d notes will be modified. Review carefully before running.',
		bpSelAll: 'Select all',
		bpSelNone: 'Select none',
		bpRun: 'Run (%d notes)',
		bpConfirmMany: '%d notes will be modified and written to disk. Continue?',
		bpEmpty: 'No mapping hits found in the scanned notes.',
		// ---- v1.7.0 batch operations: undo ----
		cmdUndo: 'AI Alias: Undo last batch operation (撤销上次批量操作)',
		undoNone: 'No batch snapshot found',
		undoConfirm: 'Roll back the batch %d run from %t? %n note(s) will be restored.',
		undoDirEnc: 'encrypt',
		undoDirDec: 'decrypt',
		undoRun: 'Roll back',
		undoDone: 'Rolled back %n note(s)',
		undoSkipped: ' · skipped %n changed since then',
		undoMissing: ' · %n note(s) no longer exist',
		undoFail: 'Undo failed: ',
		// preset category meanings (legend)
		cat_platform: 'Platform',
		cat_resource: 'Resource',
		cat_person: 'Person',
		cat_place: 'Place',
		cat_dept1: 'Department L1',
		cat_dept2: 'Department L2'
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
		searchPh: '搜索原文 / 代号 / 类别…',
		batchAdd: '批量添加',
		delSel: '删除选中',
		clearAll: '清空全部',
		addSave: '保存',
		cancel: '取消',
		thReal: '原文',
		thCode: '代号',
		thCat: '类别',
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
		batchFmt: '每行一条。「原文」→ 用默认类别自动出码；「原文|类别」→ 指定类别自动出码；「原文=代号」→ 手动代号（未分类）。空行忽略。',
		batchSave: '添加',
		previewWarn: '跳过：',
		dupInBatch: '批量内重复',
		importMergeOk: '已插入 %d 条新映射',
		crudNote: '提示：搜索实时筛选（原文/代号/类别）；用类别下拉筛选；点击表头排序；新增时按所选类别自动出码；每页 10 条分页。',
		// import
		importTitle: '导入映射表（粘贴 JSON）',
		importFormat: '格式：{ "prefix":"[[", "suffix":"]]", "mappings":[{ "real":"...", "code":"PROJ_01", "category":"platform" }] }。',
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
cmdEncrypt: 'AI Alias：真实名转代号（Convert real names to aliases）',
cmdDecrypt: 'AI Alias：代号转真实名（Convert aliases to real names）',
cmdPrefix: 'AI Alias：复制 AI 提示词前缀（Copy AI prompt prefix）',
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
		bareTitleWarn1: '还原标题将重命名笔记文件，可能影响其它笔记对该笔记的链接。',
		bareTitleWarn2: '此重命名属于文件级操作，无法用笔记内的「撤销」（Ctrl/Cmd+Z）还原，请慎重操作。',
		bareTitleRenamed: '已重命名笔记标题',
		bareTitleSkip: '已跳过 %d 条含非法文件名字符的标题还原',
		prefixCopied: '已复制 AI 提示词前缀到剪贴板',
		copyFail: '复制失败：',
		promptPrefix: '注意：以下文本中的 %PXXX%S 形式字符串是占位代号（例如 %PPROJ_01%S、%PORG_ABC%S），代表被脱敏的真实实体。请严格原样保留这些代号，不要翻译、解释、改写或猜测其含义；若需提及，请继续使用同一代号。',
		// 分类自动代号 (v1.6.0)
		catTitle: '类别',
		catAdd: '新增类别',
		catNamePh: '名称',
		catPrefixPh: '前缀',
		catPrefixDesc: '仅允许字母数字，全局唯一。修改前缀不影响已有代号，仅新生成代号使用新前缀。',
		catNameErr: '名称不能为空',
		catPrefixErr: '前缀仅允许字母数字',
		catPrefixDup: '该前缀已存在',
		catPrefixKept: '已有代号保持原前缀不变，仅新生成代号使用新前缀。',
		catDel: '删除类别',
		catDelBlock: '「%n」类别下还有 %d 条映射，请先将这些映射改到其他类别或删除数据后，再删除该类别。',
		catFilterAll: '全部类别',
		addCat: '类别',
		manualCode: '手动指定代号（可选）',
		autoPreview: '将生成：%c',
		needCat: '请选择类别或填写手动代号',
		noCat: '未分类',
		allCats: '全部分类',
		uncatNotice: '检测到 %d 条历史映射未分类，可一键智能补类别，或保持未分类（不影响解密）。',
		smartCat: '智能补类别',
		smartCatDone: '已归类 %d 条，%d 条无法识别，请手动处理。',
		ok: '知道了',
		legendTitle: '代号图例（前缀=类别）：',
		realName: '原文',
		aliasName: '代号',
		realPlaceholder: '原文',
		codePlaceholder: '代号（字母/数字/下划线）',
		pagerPrev: '上一页',
		pagerNext: '下一页',
		catNotFound: '未找到该类别',
		batchPerLine: '每行格式：原文|类别',
		batchCatDefault: '默认类别',
		// ---- v1.7.0 批量操作：设置项 ----
		batchHeading: '批量操作（文件列表右键）',
		batchIncludeSub: '包含子文件夹',
		batchIncludeSubDesc: '对文件夹执行批量操作时，是否一并处理其子文件夹内的笔记。',
		batchBarePolicy: '批量解密时的裸代号策略',
		batchBarePolicyDesc:
			'裸代号指没有前后缀包裹的代号（AI 回复经常把包裹弄丢）。「逐条确认」会把所有裸代号列出、默认不勾选；「跳过」则只还原仍带前后缀的代号。',
		batchBarePolicyConfirm: '逐条确认（推荐）',
		batchBarePolicySkip: '跳过裸代号',
		batchRename: '批量解密时一并还原笔记标题',
		batchRenameDesc: '会重命名笔记文件，影响其它笔记指向它的链接，且无法用 Ctrl/Cmd+Z 撤销。默认关闭。',
		batchSkipFm: '批量加密时跳过 YAML frontmatter',
		batchSkipFmDesc: '不改动笔记开头的 --- 属性区，避免产生非法 YAML。',
		batchBackup: '写入前创建快照',
		batchBackupDesc:
			'把所有即将变更文件的原始内容存下来，供「撤销上次批量操作」回滚。快照含真实名，与映射表同在插件目录下，请同等对待。',
		batchBackupKeepName: '快照保留份数',
		batchBackupKeepDesc: '超出份数的旧快照会被自动清理。允许范围 1–20。',
		// ---- v1.7.0 批量操作：右键菜单 ----
		menuBatchEncFile: 'AI Alias：真实名 → 代号',
		menuBatchDecFile: 'AI Alias：代号 → 真实名',
		menuBatchEncFolder: 'AI Alias：批量加密（%d 篇笔记）',
		menuBatchDecFolder: 'AI Alias：批量解密（%d 篇笔记）',
		menuBatchEncSel: 'AI Alias：批量加密（已选 %d 篇）',
		menuBatchDecSel: 'AI Alias：批量解密（已选 %d 篇）',
		// ---- v1.7.0 批量操作：运行提示 ----
		batchScanning: '正在扫描… %a / %b',
		batchWriting: '正在写入… %a / %b',
		batchNoTargets: '所选范围内没有 Markdown 笔记',
		batchDone: '已处理 %f 篇 · 替换 %n 处',
		batchDoneFail: ' · 失败 %d',
		batchDoneConflict: ' · 跳过 %d 篇（扫描后被改动）',
		batchDoneUndoable: ' · 可撤销',
		backupFail: '快照创建失败，未写入任何文件：',
		// ---- v1.7.0 批量操作：预览弹窗 ----
		bpEncTitle: '批量加密预览',
		bpDecTitle: '批量解密预览',
		bpTarget: '目标：%s',
		bpRecursive: '（含子文件夹）',
		bpSummary: '扫描 %s 篇 → 将修改 %c 篇 · 共 %n 处',
		bpBreakdown: '含代号 %w · 裸代号 %b · 标题 %t',
		bpPolicyHint: '裸代号默认全部列出、逐条勾选确认，不会自动还原。',
		bpSkipBare: '跳过裸代号（仅还原带前后缀的代号）',
		bpRenameTitles: '同时还原笔记标题（会重命名文件）',
		bpRenameWarn: '重命名会影响其它笔记指向它的链接，且无法用 Ctrl/Cmd+Z 撤销。',
		bpNoChange: '无变化',
		bpBadgeWrapped: '含 %d',
		bpBadgeBare: '裸 %d',
		bpBadgeTitle: '标题 %d',
		bpBadgeReal: '%d 处',
		bpSecWrapped: '带前后缀的代号（必定还原）',
		bpSecBare: '裸代号（勾选要还原的）',
		bpSecTitle: '笔记标题',
		bpSecReal: '将被替换为代号的真实名',
		bpWarn: '此操作直接写入磁盘，笔记内撤销（Ctrl/Cmd+Z）无效。',
		bpWarnBackup: '已自动创建快照，可用「撤销上次批量操作」回滚。',
		bpWarnNoBackup: '设置中已关闭快照，本次操作无法回滚。',
		bpWarnMany: '将修改超过 %d 篇笔记，执行前请仔细核对。',
		bpSelAll: '全选',
		bpSelNone: '全不选',
		bpRun: '执行（%d 篇）',
		bpConfirmMany: '将修改并写入 %d 篇笔记，确定继续？',
		bpEmpty: '扫描范围内没有任何映射命中。',
		// ---- v1.7.0 批量操作：撤销 ----
		cmdUndo: 'AI Alias：撤销上次批量操作（Undo last batch operation）',
		undoNone: '没有找到批量操作快照',
		undoConfirm: '要回滚 %t 的批量%d吗？将恢复 %n 篇笔记。',
		undoDirEnc: '加密',
		undoDirDec: '解密',
		undoRun: '回滚',
		undoDone: '已回滚 %n 篇笔记',
		undoSkipped: ' · 跳过 %n 篇（之后被手工改动）',
		undoMissing: ' · %n 篇笔记已不存在',
		undoFail: '撤销失败：',
		// 预设类别含义（图例）
		cat_platform: '平台',
		cat_resource: '资源',
		cat_person: '人名',
		cat_place: '地点',
		cat_dept1: '部门(一级)',
		cat_dept2: '部门(二级)'
	}
};

function isValidCode(code: string): boolean {
	return /^[A-Za-z0-9_]+$/.test(code);
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------- v1.7.0 batch: editor-independent helpers ----------------

type BatchDirection = 'encrypt' | 'decrypt';

interface Span {
	start: number;
	end: number;
}

interface CodeHit extends Span {
	code: string;
	real: string;
	category: string | null;
}

interface BatchScan {
	file: TFile;
	path: string;
	original: string;
	// encrypt direction
	realHits: CodeHit[];
	// decrypt direction
	wrappedHits: CodeHit[];
	decrypted: string;
	bareHits: CodeHit[];
	titleHits: CodeHit[];
	// UI state
	selected: boolean;
	expanded: boolean;
	bareChecks: boolean[];
	titleChecks: boolean[];
}

interface BatchPlan {
	file: TFile;
	before: string;
	after: string;
	count: number;
	renameTo?: string;
}

interface SnapshotEntry {
	path: string;
	before: string;
	afterHash: string;
	renameTo?: string;
}

interface Snapshot {
	v: number;
	ts: string;
	direction: BatchDirection;
	label: string;
	entries: SnapshotEntry[];
}

// Keep the earliest match; among matches starting at the same spot keep the longest.
function resolveOverlaps<T extends Span>(hits: T[]): T[] {
	const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
	const out: T[] = [];
	let lastEnd = -1;
	for (const h of sorted) {
		if (h.start >= lastEnd) {
			out.push(h);
			lastEnd = h.end;
		}
	}
	return out;
}

// Rebuild a string, replacing the given spans. repl() returning null keeps the original slice.
function spliceHits(text: string, hits: Span[], repl: (index: number) => string | null): string {
	const order = hits.map((h, i) => ({ h, i })).sort((a, b) => a.h.start - b.h.start);
	let out = '';
	let cursor = 0;
	for (const { h, i } of order) {
		if (h.start < cursor) continue;
		const r = repl(i);
		out += text.slice(cursor, h.start);
		out += r === null ? text.slice(h.start, h.end) : r;
		cursor = h.end;
	}
	return out + text.slice(cursor);
}

// Length of the leading YAML frontmatter block (0 when there is none).
function frontmatterLength(text: string): number {
	if (!text.startsWith('---')) return 0;
	const m = /^---[^\S\n]*\r?\n[\s\S]*?\r?\n---[^\S\n]*(\r?\n|$)/.exec(text);
	return m ? m[0].length : 0;
}

// FNV-1a, used only to detect "this file changed since the snapshot".
function hashStr(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

function stamp(d: Date): string {
	const p = (n: number): string => String(n).padStart(2, '0');
	return (
		String(d.getFullYear()) +
		p(d.getMonth() + 1) +
		p(d.getDate()) +
		'-' +
		p(d.getHours()) +
		p(d.getMinutes()) +
		p(d.getSeconds())
	);
}

function prettyStamp(ts: string): string {
	if (!/^\d{8}-\d{6}$/.test(ts)) return ts;
	return (
		ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8) + ' ' + ts.slice(9, 11) + ':' + ts.slice(11, 13) + ':' + ts.slice(13, 15)
	);
}

function yieldToUi(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

// Make a real name usable as a file name; returns null when nothing usable is left.
function sanitizeFileName(s: string): string | null {
	// drop control characters (code points 0–31) without embedding them literally
	const noCtrl = Array.from(s)
		.filter((ch) => (ch.codePointAt(0) ?? 0) >= 32)
		.join('');
	const cleaned = noCtrl
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/^\.+/, '')
		.replace(/[.\s]+$/, '');
	return cleaned.length > 0 ? cleaned : null;
}

// Lightweight confirm dialog built on Modal (avoids the deprecated browser confirm()).
class ConfirmDialog extends Modal {
	message: string;
	confirmText: string;
	cancelText: string;
	onConfirm: () => void;
	hideCancel: boolean;

	constructor(app: App, message: string, confirmText: string, cancelText: string, onConfirm: () => void, hideCancel = false) {
		super(app);
		this.message = message;
		this.confirmText = confirmText;
		this.cancelText = cancelText;
		this.onConfirm = onConfirm;
		this.hideCancel = hideCancel;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('p', { text: this.message });
		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		if (!this.hideCancel) {
			foot.createEl('button', { text: this.cancelText }).addEventListener('click', () => this.close());
		}
		foot.createEl('button', { text: this.confirmText, cls: 'mod-cta' }).addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});
	}
}

class BatchAddModal extends Modal {
	plugin: AIAliasPlugin;
	tab: AIAliasSettingTab;
	taEl!: HTMLTextAreaElement;
	previewEl!: HTMLElement;
	saveBtn!: HTMLElement;
	perLineEl!: HTMLInputElement;
	catSel!: HTMLSelectElement;
	preview: { valid: { real: string; code: string; manual: boolean; category: string | null }[]; skipped: { line: string; reason: string }[] } | null = null;

	constructor(app: App, plugin: AIAliasPlugin, tab: AIAliasSettingTab) {
		super(app);
		this.plugin = plugin;
		this.tab = tab;
	}

	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		this.titleEl.setText(t('batchTitle'));
		contentEl.createEl('p', { cls: 'ai-sub', text: t('batchFmt') });
		this.taEl = contentEl.createEl('textarea', { cls: 'ai-ta' });

		const fPer = contentEl.createEl('div', { cls: 'ai-fld' });
		const perLabel = fPer.createEl('label', { cls: 'ai-manual-label' });
		this.perLineEl = perLabel.createEl('input', { type: 'checkbox' });
		perLabel.createSpan({ text: ' ' + t('batchPerLine') });

		const fCat = contentEl.createEl('div', { cls: 'ai-fld' });
		fCat.createEl('label', { text: t('batchCatDefault') });
		this.catSel = fCat.createEl('select', { cls: 'ai-cat-sel' });
		const defId = this.plugin.settings.categories.length ? this.plugin.settings.categories[0].id : '';
		this.tab.fillCatSelect(this.catSel, false, defId);

		this.previewEl = contentEl.createEl('div', { cls: 'ai-preview' });
		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		foot.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.close());
		this.saveBtn = foot.createEl('button', { text: t('batchSave'), cls: 'mod-cta' });
		this.saveBtn.addEventListener('click', () => this.doSave());

		this.taEl.addEventListener('input', () => this.parse());
		this.perLineEl.addEventListener('change', () => this.parse());
		this.catSel.addEventListener('change', () => this.parse());
		this.parse();
	}

	parse(): void {
		const t = (k: string): string => this.plugin.t(k);
		const raw = this.taEl.value.split(/\r?\n/);
		const valid: { real: string; code: string; manual: boolean; category: string | null }[] = [];
		const skipped: { line: string; reason: string }[] = [];
		const seen = new Set<string>();
		const perLine = this.perLineEl.checked;
		const defCat = this.catSel.value;
		for (const line of raw) {
			const s = line.trim();
			if (!s) continue;
			const mEq = s.match(/^(.*?)\s*(?:=|→|,|\t)\s*(.+)$/);
			if (mEq) {
				const real = mEq[1].trim();
				const code = mEq[2].trim().toUpperCase();
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
				valid.push({ real, code, manual: true, category: null });
				continue;
			}
			let real = s;
			let catId = defCat;
			if (perLine && s.includes('|')) {
				const parts = s.split('|');
				real = parts[0].trim();
				const cn = parts[1].trim();
				const fc = this.plugin.resolveCategory(cn);
				if (!fc) {
					skipped.push({ line: s, reason: t('catNotFound') });
					continue;
				}
				catId = fc.id;
			}
			if (!real) {
				skipped.push({ line: s, reason: t('errEmpty') });
				continue;
			}
			const cat = this.plugin.categoryById(catId);
			if (!cat) {
				skipped.push({ line: s, reason: t('needCat') });
				continue;
			}
			const code = this.plugin.generateCode(cat);
			valid.push({ real, code, manual: false, category: cat.id });
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
		for (const v of this.preview.valid) {
			this.plugin.settings.mappings.push({ real: v.real, code: v.code, category: v.category, manual: v.manual });
		}
		void this.plugin.save();
		new Notice(this.plugin.t('addedN').replace('%d', String(this.preview.valid.length)));
		this.tab.renderTable();
		this.tab.renderUncatNotice();
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
		this.titleEl.setText(t('importTitle'));
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
			const catRaw = typeof m.category === 'string' ? m.category : null;
			const cat = catRaw && this.plugin.settings.categories.some((c) => c.id === catRaw) ? catRaw : null;
			if (!real || !code) throw new Error(t('errEmptyField'));
			if (!isValidCode(code)) throw new Error(t('errInvalid') + code);
			if (seen.has(code)) throw new Error(t('errDuplicate') + code);
			seen.add(code);
			mappings.push({ real, code, category: cat, manual: false });
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
			this.tab.renderUncatNotice();
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
		this.titleEl.setText(t('bareTitle'));
		const desc = contentEl.createEl('p', { cls: 'ai-sub' });
		desc.setText(
			t('bareDesc')
				.replace('%d', String(total))
				.replace('%p', p)
				.replace('%s', s)
		);
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
			warnEl.createSpan({ text: t('bareTitleWarn1') });
			warnEl.createEl('br');
			warnEl.createSpan({ text: t('bareTitleWarn2') });
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
		return sanitizeFileName(s);
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

// ---------------- v1.7.0 batch preview / confirmation modal ----------------

const DETAIL_CAP = 30; // max hits rendered per section inside one expanded file

class BatchPreviewModal extends Modal {
	plugin: AIAliasPlugin;
	direction: BatchDirection;
	label: string;
	scans: BatchScan[];
	skipBare: boolean;
	renameTitles: boolean;

	private summaryEl!: HTMLElement;
	private breakdownEl!: HTMLElement;
	private listEl!: HTMLElement;
	private warnEl!: HTMLElement;
	private runBtn!: HTMLButtonElement;

	constructor(app: App, plugin: AIAliasPlugin, direction: BatchDirection, label: string, scans: BatchScan[]) {
		super(app);
		this.plugin = plugin;
		this.direction = direction;
		this.label = label;
		this.scans = scans;
		this.skipBare = plugin.settings.batchBareCodePolicy === 'skip';
		this.renameTitles = plugin.settings.batchRenameTitles;
	}

	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		this.modalEl.addClass('ai-bpmodal');
		this.titleEl.setText(this.direction === 'encrypt' ? t('bpEncTitle') : t('bpDecTitle'));
		contentEl.createEl('p', { cls: 'ai-sub', text: t('bpTarget').replace('%s', this.label) });

		const sum = contentEl.createEl('div', { cls: 'ai-bpsum' });
		this.summaryEl = sum.createEl('div', { cls: 'ai-bpsum-main' });
		this.breakdownEl = sum.createEl('div', { cls: 'ai-bpsum-sub' });

		if (this.direction === 'decrypt') {
			const pol = contentEl.createEl('div', { cls: 'ai-bppolicy' });
			pol.createEl('div', { cls: 'ai-bppolicy-hint', text: t('bpPolicyHint') });
			const l1 = pol.createEl('label', { cls: 'ai-bpcheck' });
			const c1 = l1.createEl('input', { type: 'checkbox' });
			c1.checked = this.skipBare;
			l1.createSpan({ text: t('bpSkipBare') });
			c1.addEventListener('change', () => {
				this.skipBare = c1.checked;
				this.renderList();
				this.refresh();
			});
			const l2 = pol.createEl('label', { cls: 'ai-bpcheck' });
			const c2 = l2.createEl('input', { type: 'checkbox' });
			c2.checked = this.renameTitles;
			l2.createSpan({ text: t('bpRenameTitles') });
			c2.addEventListener('change', () => {
				this.renameTitles = c2.checked;
				this.renderList();
				this.refresh();
			});
			pol.createEl('div', { cls: 'ai-bppolicy-warn', text: t('bpRenameWarn') });
		}

		this.listEl = contentEl.createEl('div', { cls: 'ai-bplist' });
		this.warnEl = contentEl.createEl('p', { cls: 'ai-help ai-help-warn' });

		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		foot.createEl('button', { text: t('bpSelAll') }).addEventListener('click', () => this.setAll(true));
		foot.createEl('button', { text: t('bpSelNone') }).addEventListener('click', () => this.setAll(false));
		foot.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.close());
		this.runBtn = foot.createEl('button', { text: '', cls: 'mod-cta' });
		this.runBtn.addEventListener('click', () => this.confirmRun());

		this.renderList();
		this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ---- derived state ----

	private hasPotential(s: BatchScan): boolean {
		if (this.direction === 'encrypt') return s.realHits.length > 0;
		if (s.wrappedHits.length > 0) return true;
		if (!this.skipBare && s.bareHits.length > 0) return true;
		if (this.renameTitles && s.titleHits.length > 0) return true;
		return false;
	}

	private counts(s: BatchScan): { w: number; b: number; ti: number; n: number } {
		if (this.direction === 'encrypt') {
			const n = s.realHits.length;
			return { w: n, b: 0, ti: 0, n };
		}
		const w = s.wrappedHits.length;
		const b = this.skipBare ? 0 : s.bareChecks.filter(Boolean).length;
		const ti = this.renameTitles ? s.titleChecks.filter(Boolean).length : 0;
		return { w, b, ti, n: w + b + ti };
	}

	// ---- rendering ----

	private renderList(): void {
		const t = (k: string): string => this.plugin.t(k);
		this.listEl.empty();
		if (this.scans.length === 0) {
			this.listEl.createEl('div', { cls: 'ai-bpempty', text: t('bpEmpty') });
			return;
		}
		for (const s of this.scans) {
			const active = this.hasPotential(s);
			if (!active) s.selected = false;
			const item = this.listEl.createEl('div', { cls: 'ai-bpitem' });
			item.toggleClass('is-dim', !active);
			const row = item.createEl('div', { cls: 'ai-bprow' });
			const cb = row.createEl('input', { type: 'checkbox' });
			cb.checked = s.selected;
			cb.disabled = !active;
			cb.addEventListener('change', () => {
				s.selected = cb.checked;
				this.refresh();
			});
			const main = row.createEl('div', { cls: 'ai-bpmain' });
			main.createEl('span', { cls: 'ai-bppath', text: s.path });
			const badges = main.createEl('span', { cls: 'ai-bpbadges' });
			this.renderBadges(badges, s, active);
			main.createEl('span', { cls: 'ai-bparrow', text: active ? (s.expanded ? '▾' : '▸') : '' });
			if (active) {
				main.addClass('is-clickable');
				main.addEventListener('click', () => {
					s.expanded = !s.expanded;
					this.renderList();
				});
			}
			if (active && s.expanded) this.renderDetail(item, s);
		}
	}

	private renderBadges(parent: HTMLElement, s: BatchScan, active: boolean): void {
		const t = (k: string): string => this.plugin.t(k);
		if (!active) {
			parent.createEl('span', { cls: 'ai-bpbadge is-none', text: t('bpNoChange') });
			return;
		}
		if (this.direction === 'encrypt') {
			parent.createEl('span', { cls: 'ai-bpbadge', text: t('bpBadgeReal').replace('%d', String(s.realHits.length)) });
			return;
		}
		if (s.wrappedHits.length > 0) {
			parent.createEl('span', { cls: 'ai-bpbadge', text: t('bpBadgeWrapped').replace('%d', String(s.wrappedHits.length)) });
		}
		if (!this.skipBare && s.bareHits.length > 0) {
			parent.createEl('span', { cls: 'ai-bpbadge is-bare', text: t('bpBadgeBare').replace('%d', String(s.bareHits.length)) });
		}
		if (this.renameTitles && s.titleHits.length > 0) {
			parent.createEl('span', { cls: 'ai-bpbadge is-title', text: t('bpBadgeTitle').replace('%d', String(s.titleHits.length)) });
		}
	}

	private renderDetail(parent: HTMLElement, s: BatchScan): void {
		const t = (k: string): string => this.plugin.t(k);
		const box = parent.createEl('div', { cls: 'ai-bpdetail' });
		if (this.direction === 'encrypt') {
			this.renderSection(box, t('bpSecReal'), s.realHits, s.original, null);
			return;
		}
		if (s.wrappedHits.length > 0) {
			this.renderSection(box, t('bpSecWrapped'), s.wrappedHits, s.original, null);
		}
		if (!this.skipBare && s.bareHits.length > 0) {
			this.renderSection(box, t('bpSecBare'), s.bareHits, s.decrypted, s.bareChecks);
		}
		if (this.renameTitles && s.titleHits.length > 0) {
			this.renderSection(box, t('bpSecTitle'), s.titleHits, s.file.basename, s.titleChecks);
		}
	}

	private renderSection(
		box: HTMLElement,
		title: string,
		hits: CodeHit[],
		source: string,
		checks: boolean[] | null
	): void {
		box.createEl('div', { cls: 'ai-bpsec', text: title });
		const list = box.createEl('div', { cls: 'ai-bphits' });
		const shown = Math.min(hits.length, DETAIL_CAP);
		for (let i = 0; i < shown; i++) {
			const h = hits[i];
			const line = list.createEl('div', { cls: 'ai-bphit' });
			if (checks) {
				const cb = line.createEl('input', { type: 'checkbox' });
				cb.checked = checks[i];
				cb.addEventListener('change', () => {
					checks[i] = cb.checked;
					this.refresh();
				});
			} else {
				line.createEl('span', { cls: 'ai-bpfix', text: '•' });
			}
			const body = line.createEl('div', { cls: 'ai-barebody' });
			const head = body.createEl('div', { cls: 'ai-barecode' });
			if (this.direction === 'encrypt') {
				head.createEl('span', { text: h.real, cls: 'ai-real' });
				head.createEl('span', { text: '  →  ', cls: 'ai-arrow' });
				head.createEl('span', { text: this.plugin.wrap(h.code), cls: 'ai-code' });
			} else {
				head.createEl('span', { text: h.code, cls: 'ai-code' });
				head.createEl('span', { text: '  →  ', cls: 'ai-arrow' });
				head.createEl('span', { text: h.real, cls: 'ai-real' });
			}
			head.createEl('span', { text: ' (' + this.catLabel(h.category) + ')', cls: 'ai-bpcat' });
			this.ctxLine(body, source, h);
		}
		if (hits.length > shown) {
			list.createEl('div', { cls: 'ai-bpmore', text: '… +' + String(hits.length - shown) });
		}
	}

	private catLabel(id: string | null): string {
		const cat = this.plugin.categoryById(id);
		return cat ? cat.name : this.plugin.t('noCat');
	}

	private ctxLine(parent: HTMLElement, source: string, h: CodeHit): void {
		const before = source.slice(Math.max(0, h.start - 20), h.start);
		const after = source.slice(h.end, Math.min(source.length, h.end + 20));
		const ctx = parent.createEl('div', { cls: 'ai-barectx' });
		if (h.start > 20) ctx.createSpan({ text: '…' });
		ctx.createSpan({ text: before });
		ctx.createSpan({ text: source.slice(h.start, h.end), cls: 'ai-hl' });
		ctx.createSpan({ text: after });
		if (h.end + 20 < source.length) ctx.createSpan({ text: '…' });
	}

	private refresh(): void {
		const t = (k: string): string => this.plugin.t(k);
		let files = 0;
		let n = 0;
		let w = 0;
		let b = 0;
		let ti = 0;
		for (const s of this.scans) {
			if (!s.selected || !this.hasPotential(s)) continue;
			const c = this.counts(s);
			if (c.n === 0) continue;
			files++;
			n += c.n;
			w += c.w;
			b += c.b;
			ti += c.ti;
		}
		this.summaryEl.setText(
			t('bpSummary')
				.replace('%s', String(this.scans.length))
				.replace('%c', String(files))
				.replace('%n', String(n))
		);
		if (this.direction === 'decrypt') {
			this.breakdownEl.setText(
				t('bpBreakdown').replace('%w', String(w)).replace('%b', String(b)).replace('%t', String(ti))
			);
			this.breakdownEl.toggleClass('is-hidden', false);
		} else {
			this.breakdownEl.toggleClass('is-hidden', true);
		}

		this.warnEl.empty();
		this.warnEl.createSpan({ text: t('bpWarn') });
		this.warnEl.createEl('br');
		this.warnEl.createSpan({
			text: this.plugin.settings.batchBackupEnabled ? t('bpWarnBackup') : t('bpWarnNoBackup')
		});
		const many = files > BATCH_MANY;
		if (many) {
			this.warnEl.createEl('br');
			this.warnEl.createSpan({ text: t('bpWarnMany').replace('%d', String(BATCH_MANY)), cls: 'ai-bpdanger' });
		}
		this.warnEl.toggleClass('ai-help-danger', many);

		this.runBtn.setText(t('bpRun').replace('%d', String(files)));
		this.runBtn.disabled = files === 0;
	}

	private setAll(v: boolean): void {
		for (const s of this.scans) if (this.hasPotential(s)) s.selected = v;
		this.renderList();
		this.refresh();
	}

	// ---- run ----

	private buildPlans(): BatchPlan[] {
		const plans: BatchPlan[] = [];
		for (const s of this.scans) {
			if (!s.selected || !this.hasPotential(s)) continue;
			const c = this.counts(s);
			if (c.n === 0) continue;
			let after: string;
			let renameTo: string | undefined;
			if (this.direction === 'encrypt') {
				after = spliceHits(s.original, s.realHits, (i) => this.plugin.wrap(s.realHits[i].code));
			} else {
				after = s.decrypted;
				if (!this.skipBare && s.bareHits.length > 0) {
					after = spliceHits(s.decrypted, s.bareHits, (i) => (s.bareChecks[i] ? s.bareHits[i].real : null));
				}
				if (this.renameTitles && s.titleHits.some((_h, i) => s.titleChecks[i])) {
					const built = spliceHits(s.file.basename, s.titleHits, (i) =>
						s.titleChecks[i] ? sanitizeFileName(s.titleHits[i].real) : null
					);
					if (built.length > 0 && built !== s.file.basename) {
						const dir = s.file.parent && s.file.parent.path !== '/' ? s.file.parent.path : '';
						const ext = s.file.extension ? '.' + s.file.extension : '';
						renameTo = (dir ? dir + '/' : '') + built + ext;
					}
				}
			}
			if (after === s.original && renameTo === undefined) continue;
			plans.push({ file: s.file, before: s.original, after, count: c.n, renameTo });
		}
		return plans;
	}

	private confirmRun(): void {
		const t = (k: string): string => this.plugin.t(k);
		const plans = this.buildPlans();
		if (plans.length === 0) return;
		const go = (): void => {
			this.close();
			void this.plugin.executeBatch(this.direction, plans, this.label);
		};
		if (plans.length > BATCH_MANY) {
			new ConfirmDialog(
				this.app,
				t('bpConfirmMany').replace('%d', String(plans.length)),
				t('bpRun').replace('%d', String(plans.length)),
				t('cancel'),
				go
			).open();
			return;
		}
		go();
	}
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
	private page = 0;
	private filterCat = FILTER_ALL;

	// DOM refs
	private searchEl!: HTMLInputElement;
	private countEl!: HTMLElement;
	private tableEl!: HTMLElement;
	private pagerEl!: HTMLElement;
	private addFormEl!: HTMLElement;
	private addRealEl!: HTMLInputElement;
	private addCodeEl!: HTMLInputElement;
	private addCatEl!: HTMLSelectElement;
	private addManualEl!: HTMLInputElement;
	private addHintEl!: HTMLElement;
	private filterSel!: HTMLSelectElement;
	private catBarEl!: HTMLElement;
	private uncatEl!: HTMLElement;
	private delSelBtn!: HTMLElement;

	constructor(app: App, plugin: AIAliasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const t = (k: string): string => this.plugin.t(k);

		new Setting(containerEl).setName(t('title')).setHeading();

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

		// ---- Batch operations (v1.7.0) ----
		new Setting(containerEl).setName(t('batchHeading')).setHeading();

		new Setting(containerEl)
			.setName(t('batchIncludeSub'))
			.setDesc(t('batchIncludeSubDesc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.batchIncludeSubfolders).onChange((v) => {
					this.plugin.settings.batchIncludeSubfolders = v;
					void this.plugin.save();
				})
			);

		new Setting(containerEl)
			.setName(t('batchBarePolicy'))
			.setDesc(t('batchBarePolicyDesc'))
			.addDropdown((d) =>
				d
					.addOption('confirmAll', t('batchBarePolicyConfirm'))
					.addOption('skip', t('batchBarePolicySkip'))
					.setValue(this.plugin.settings.batchBareCodePolicy)
					.onChange((v) => {
						this.plugin.settings.batchBareCodePolicy = v === 'skip' ? 'skip' : 'confirmAll';
						void this.plugin.save();
					})
			);

		new Setting(containerEl)
			.setName(t('batchRename'))
			.setDesc(t('batchRenameDesc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.batchRenameTitles).onChange((v) => {
					this.plugin.settings.batchRenameTitles = v;
					void this.plugin.save();
				})
			);

		new Setting(containerEl)
			.setName(t('batchSkipFm'))
			.setDesc(t('batchSkipFmDesc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.batchSkipFrontmatter).onChange((v) => {
					this.plugin.settings.batchSkipFrontmatter = v;
					void this.plugin.save();
				})
			);

		new Setting(containerEl)
			.setName(t('batchBackup'))
			.setDesc(t('batchBackupDesc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.batchBackupEnabled).onChange((v) => {
					this.plugin.settings.batchBackupEnabled = v;
					void this.plugin.save();
				})
			);

		new Setting(containerEl)
			.setName(t('batchBackupKeepName'))
			.setDesc(t('batchBackupKeepDesc'))
			.addText((tc) =>
				tc.setValue(String(this.plugin.settings.batchBackupKeep)).onChange((v) => {
					const n = Number(v);
					if (!Number.isFinite(n)) return;
					this.plugin.settings.batchBackupKeep = Math.min(20, Math.max(1, Math.floor(n)));
					void this.plugin.save();
				})
			);

		// ---- Category manager (lightweight) ----
		new Setting(containerEl).setName(t('catTitle')).setHeading();
		this.catBarEl = containerEl.createEl('div', { cls: 'ai-catbar' });
		this.uncatEl = containerEl.createEl('div', { cls: 'ai-uncat is-hidden' });
		containerEl.createEl('div', { cls: 'ai-note', text: t('catPrefixDesc') });

		// ---- Mapping manager (main view) ----
		new Setting(containerEl).setName(t('mappingTitle')).setHeading();

		const toolbar = containerEl.createEl('div', { cls: 'ai-toolbar' });
		const searchWrap = toolbar.createEl('div', { cls: 'ai-search' });
		this.searchEl = searchWrap.createEl('input', { type: 'text', placeholder: t('searchPh') });
		this.searchEl.value = this.searchTerm;
		this.searchEl.addEventListener('input', (e) => {
			this.searchTerm = (e.target as HTMLInputElement).value;
			this.page = 0;
			this.renderTable();
		});
		this.filterSel = toolbar.createEl('select', { cls: 'ai-catfilter' });
		this.fillCatSelect(this.filterSel, true, this.filterCat, true);
		this.filterSel.addEventListener('change', () => {
			this.filterCat = this.filterSel.value;
			this.page = 0;
			this.renderTable();
		});
		this.countEl = toolbar.createEl('span', { cls: 'ai-count' });

		const btnBar = containerEl.createEl('div', { cls: 'ai-btns' });
		const addB = btnBar.createEl('button', { text: t('add'), cls: 'mod-cta' });
		addB.addEventListener('click', () => this.toggleAddForm());
		const batchB = btnBar.createEl('button', { text: t('batchAdd') });
		batchB.addEventListener('click', () => new BatchAddModal(this.app, this.plugin, this).open());
		this.delSelBtn = btnBar.createEl('button', { text: t('delSel'), cls: 'mod-warning' });
		this.delSelBtn.addEventListener('click', () => this.deleteSelected());
		const clearB = btnBar.createEl('button', { text: t('clearAll'), cls: 'mod-warning' });
		clearB.addEventListener('click', () => this.clearAll());

		this.addFormEl = containerEl.createEl('div', { cls: 'ai-addform is-hidden' });
		const f1 = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		f1.createEl('label', { text: t('realName') });
		this.addRealEl = f1.createEl('input', { type: 'text', placeholder: t('realPlaceholder') });
		this.addRealEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.addCatEl.focus();
			}
		});
		const fCat = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		fCat.createEl('label', { text: t('addCat') });
		this.addCatEl = fCat.createEl('select', { cls: 'ai-cat-sel' });
		this.fillCatSelect(this.addCatEl, true, this.plugin.settings.categories[0]?.id ?? FILTER_UNCAT);
		this.addCatEl.addEventListener('change', () => this.updateAutoPreview());
		const fMan = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		const manLabel = fMan.createEl('label', { cls: 'ai-manual-label' });
		this.addManualEl = manLabel.createEl('input', { type: 'checkbox' });
		manLabel.createSpan({ text: ' ' + t('manualCode') });
		this.addCodeEl = fMan.createEl('input', { type: 'text', placeholder: t('codePlaceholder'), cls: 'ai-code-in is-hidden' });
		this.addCodeEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.saveInlineAdd();
			}
		});
		this.addManualEl.addEventListener('change', () => {
			this.addCodeEl.toggleClass('is-hidden', !this.addManualEl.checked);
			this.updateAutoPreview();
		});
		const f3 = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		f3.createEl('label', { text: ' ' });
		f3.createEl('button', { text: t('addSave'), cls: 'mod-cta' }).addEventListener('click', () => this.saveInlineAdd());
		const f4 = this.addFormEl.createEl('div', { cls: 'ai-fld' });
		f4.createEl('label', { text: ' ' });
		f4.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.toggleAddForm(true));
		this.addHintEl = this.addFormEl.createEl('div', { cls: 'ai-hint' });

		this.tableEl = containerEl.createEl('div', { cls: 'ai-table' });
		this.pagerEl = containerEl.createEl('div', { cls: 'ai-pager' });

		containerEl.createEl('div', { cls: 'ai-note', text: t('crudNote') });

		this.renderCategoryBar();
		this.renderUncatNotice();
		this.renderTable();
	}

	// ---------- category manager ----------

	fillCatSelect(sel: HTMLSelectElement, includeUncat: boolean, selectedId: string, includeAll = false): void {
		const t = (k: string): string => this.plugin.t(k);
		sel.empty();
		if (includeAll) {
			const o = sel.createEl('option');
			o.textContent = t('allCats');
			o.value = FILTER_ALL;
			sel.appendChild(o);
		}
		if (includeUncat) {
			const o = sel.createEl('option');
			o.textContent = t('noCat');
			o.value = FILTER_UNCAT;
			sel.appendChild(o);
		}
		for (const c of this.plugin.settings.categories) {
			const o = sel.createEl('option');
			o.textContent = c.name + ' (' + c.prefix + ')';
			o.value = c.id;
			sel.appendChild(o);
		}
		const vals = Array.from(sel.options).map((o) => o.value);
		sel.value = vals.includes(selectedId) ? selectedId : includeAll ? FILTER_ALL : (this.plugin.settings.categories[0]?.id ?? FILTER_UNCAT);
	}

	private normCat(v: string): string | null {
		return v === FILTER_UNCAT || v === FILTER_ALL || !v ? null : v;
	}

	private renderCategoryBar(): void {
		if (!this.catBarEl) return;
		const t = (k: string): string => this.plugin.t(k);
		this.catBarEl.empty();
		const chips = this.catBarEl.createEl('div', { cls: 'ai-chips' });
		for (const c of this.plugin.settings.categories) {
			const chip = chips.createEl('div', { cls: 'ai-chip' });
			const nameIn = chip.createEl('input', { type: 'text', value: c.name, cls: 'ai-chip-name' });
			nameIn.addEventListener('change', () => {
				const v = nameIn.value.trim();
				if (!v) {
					nameIn.value = c.name;
					return;
				}
				c.name = v;
				void this.plugin.save();
				this.refreshFilterOptions();
			});
			const preIn = chip.createEl('input', { type: 'text', value: c.prefix, cls: 'ai-chip-prefix' });
			preIn.addEventListener('change', () => this.onPrefixChange(c, preIn));
			const del = chip.createEl('button', { cls: 'ai-chip-del' });
			setIcon(del, 'x');
			del.setAttribute('aria-label', t('catDel'));
			del.addEventListener('click', () => this.deleteCategory(c));
		}
		const addRow = this.catBarEl.createEl('div', { cls: 'ai-addcat' });
		const nIn = addRow.createEl('input', { type: 'text', placeholder: t('catNamePh') });
		const pIn = addRow.createEl('input', { type: 'text', placeholder: t('catPrefixPh') });
		const addBtn = addRow.createEl('button', { text: '+ ' + t('catAdd'), cls: 'mod-cta' });
		addBtn.addEventListener('click', () => this.addCategory(nIn, pIn));
	}

	private onPrefixChange(c: Category, inp: HTMLInputElement): void {
		const t = (k: string): string => this.plugin.t(k);
		const v = inp.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
		if (!v) {
			inp.value = c.prefix;
			return;
		}
		if (this.plugin.settings.categories.some((x) => x.id !== c.id && x.prefix === v)) {
			new Notice(t('catPrefixDup'));
			inp.value = c.prefix;
			return;
		}
		c.prefix = v;
		inp.value = v;
		void this.plugin.save();
		new Notice(t('catPrefixKept'));
		this.refreshFilterOptions();
		this.renderTable();
	}

	private addCategory(nIn: HTMLInputElement, pIn: HTMLInputElement): void {
		const t = (k: string): string => this.plugin.t(k);
		const name = nIn.value.trim();
		let prefix = pIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
		if (!name) {
			new Notice(t('catNameErr'));
			return;
		}
		if (!prefix) prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
		if (!prefix) {
			new Notice(t('catPrefixErr'));
			return;
		}
		if (this.plugin.settings.categories.some((cc) => cc.prefix === prefix)) {
			new Notice(t('catPrefixDup'));
			return;
		}
		this.plugin.settings.categories.push({ id: 'cat_' + Date.now().toString(36), name, prefix, seq: 0 });
		void this.plugin.save();
		nIn.value = '';
		pIn.value = '';
		this.renderCategoryBar();
		this.refreshFilterOptions();
		this.renderTable();
	}

	private deleteCategory(c: Category): void {
		const t = (k: string): string => this.plugin.t(k);
		const n = this.plugin.settings.mappings.filter((m) => m.category === c.id).length;
		if (n > 0) {
			new ConfirmDialog(
				this.app,
				t('catDelBlock').replace('%n', c.name).replace('%d', String(n)),
				t('ok'),
				'',
				() => {},
				true
			).open();
			return;
		}
		this.plugin.settings.categories = this.plugin.settings.categories.filter((x) => x.id !== c.id);
		void this.plugin.save();
		this.renderCategoryBar();
		this.refreshFilterOptions();
		this.renderTable();
	}

	private refreshFilterOptions(): void {
		if (this.filterSel) {
			const cur = this.filterSel.value;
			this.fillCatSelect(this.filterSel, true, cur, true);
		}
		// Keep the inline "add mapping" category dropdown in sync with
		// the live categories (otherwise newly added categories are missing).
		if (this.addCatEl) {
			const cur = this.addCatEl.value;
			this.fillCatSelect(this.addCatEl, true, cur);
		}
	}

	// ---------- uncategorized notice ----------

	renderUncatNotice(): void {
		if (!this.uncatEl) return;
		const t = (k: string): string => this.plugin.t(k);
		const n = this.plugin.settings.mappings.filter((m) => m.category == null).length;
		this.uncatEl.empty();
		if (n === 0) {
			this.uncatEl.toggleClass('is-hidden', true);
			return;
		}
		this.uncatEl.toggleClass('is-hidden', false);
		this.uncatEl.createEl('span', { text: t('uncatNotice').replace('%d', String(n)) });
		const btn = this.uncatEl.createEl('button', { text: t('smartCat'), cls: 'mod-cta' });
		btn.addEventListener('click', () => this.smartCategorize());
	}

	private smartCategorize(): void {
		const r = this.plugin.categorizeSmart();
		void this.plugin.save();
		new Notice(
			this.plugin
				.t('smartCatDone')
				.replace('%d', String(r.done))
				.replace('%t', String(r.remain))
		);
		this.renderUncatNotice();
		this.renderTable();
	}

	// ---------- mapping table ----------

	private toggleAddForm(forceClose = false): void {
		this.addOpen = forceClose ? false : !this.addOpen;
		this.addFormEl.toggleClass('is-hidden', !this.addOpen);
		this.addHintEl.setText('');
		if (this.addOpen) {
			this.addRealEl.focus();
			this.updateAutoPreview();
		} else {
			this.addRealEl.value = '';
			this.addCodeEl.value = '';
			this.addManualEl.checked = false;
			this.addCodeEl.toggleClass('is-hidden', true);
			this.addCatEl.value = this.plugin.settings.categories[0]?.id ?? FILTER_UNCAT;
			this.updateAutoPreview();
		}
	}

	private updateAutoPreview(): void {
		const t = (k: string): string => this.plugin.t(k);
		const cat = this.plugin.categoryById(this.addCatEl.value);
		if (cat && !this.addManualEl.checked) {
			const preview = cat.prefix + String(cat.seq + 1).padStart(3, '0');
			this.addHintEl.setText(t('autoPreview').replace('%c', this.plugin.wrap(preview)));
			this.addHintEl.className = 'ai-hint';
		} else if (this.addManualEl.checked) {
			this.addHintEl.setText('');
		} else {
			this.addHintEl.setText(t('needCat'));
			this.addHintEl.className = 'ai-hint ai-err';
		}
	}

	private filteredMappings(): { real: string; code: string; category?: string | null; manual?: boolean; i: number }[] {
		let list = this.plugin.settings.mappings.map((m, i) => ({
			real: m.real,
			code: m.code,
			category: m.category,
			manual: m.manual,
			i
		}));
		const q = this.searchTerm.trim().toLowerCase();
		if (q) {
			list = list.filter((m) => {
				const cat = this.plugin.categoryById(m.category);
				return (
					m.real.toLowerCase().includes(q) ||
					m.code.toLowerCase().includes(q) ||
					(!!cat && cat.name.toLowerCase().includes(q))
				);
			});
		}
		if (this.filterCat === FILTER_UNCAT) {
			list = list.filter((m) => !m.category);
		} else if (this.filterCat && this.filterCat !== FILTER_ALL) {
			list = list.filter((m) => (m.category || '') === this.filterCat);
		}
		if (this.sortKey) {
			const key = this.sortKey;
			list.sort((a, b) => {
				const va = (a[key] || '').toLowerCase();
				const vb = (b[key] || '').toLowerCase();
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
		const pages = Math.max(1, Math.ceil(list.length / PAGE));
		if (this.page >= pages) this.page = pages - 1;
		if (this.page < 0) this.page = 0;
		this.countEl.setText(`共 ${this.plugin.settings.mappings.length} 条 · 显示 ${list.length} 条`);

		const table = tableEl.createEl('table', { cls: 'ai-alias-tbl' });
		const thead = table.createEl('thead');
		const htr = thead.createEl('tr');
		htr.createEl('th', { text: '' });
		const thReal = htr.createEl('th', { text: t('thReal') + this.sortIndicator('real') });
		thReal.addEventListener('click', () => this.toggleSort('real'));
		const thCat = htr.createEl('th', { text: t('thCat') });
		const thCode = htr.createEl('th', { text: t('thCode') + this.sortIndicator('code') });
		thCode.addEventListener('click', () => this.toggleSort('code'));
		thCode.addClass('ai-right');
		htr.createEl('th', { text: t('actions') }).addClass('ai-right');

		const tbody = table.createEl('tbody');
		if (this.plugin.settings.mappings.length === 0) {
			const tr = tbody.createEl('tr');
			const td = tr.createEl('td', { text: t('empty') });
			td.setAttribute('colspan', '5');
			td.addClass('ai-empty');
			this.renderPager(pages);
			return;
		}
		const start = this.page * PAGE;
		const items = list.slice(start, start + PAGE);
		if (items.length === 0) {
			const tr = tbody.createEl('tr');
			const td = tr.createEl('td', { text: t('filteredEmpty') });
			td.setAttribute('colspan', '5');
			td.addClass('ai-empty');
			this.renderPager(pages);
			return;
		}
		for (const m of items) {
			const tr = tbody.createEl('tr');
			if (this.selected.has(m.i)) tr.addClass('ai-sel');
			const tdCb = tr.createEl('td');
			if (this.editing === m.i) {
				// leave checkbox cell empty while editing
			} else {
				const cb = tdCb.createEl('input', { type: 'checkbox' });
				cb.checked = this.selected.has(m.i);
				cb.addEventListener('change', (e) => {
					const checked = (e.target as HTMLInputElement).checked;
					if (checked) this.selected.add(m.i);
					else this.selected.delete(m.i);
					tr.toggleClass('ai-sel', checked);
					this.updateBulk();
				});
			}
			if (this.editing === m.i) {
				const tdR = tr.createEl('td');
				const inR = tdR.createEl('input', { type: 'text', cls: 'ai-edit-in' });
				inR.value = m.real;
				const tdCat = tr.createEl('td');
				const sel = tdCat.createEl('select', { cls: 'ai-cat-sel' });
				this.fillCatSelect(sel, true, m.category || FILTER_UNCAT);
				const tdC = tr.createEl('td');
				tdC.createEl('span', { text: this.plugin.wrap(m.code), cls: 'ai-code' });
				const tdA = tr.createEl('td');
				tdA.addClass('ai-right');
				tdA.createEl('button', { text: t('addSave'), cls: 'mod-cta' }).addEventListener('click', () =>
					this.saveEdit(m.i, inR.value, sel.value)
				);
				tdA.createEl('button', { text: t('cancel') }).addEventListener('click', () => {
					this.editing = null;
					this.renderTable();
				});
			} else {
				tr.createEl('td', { text: m.real });
				const cat = this.plugin.categoryById(m.category);
				tr.createEl('td', { text: cat ? cat.name : t('noCat') });
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
		this.renderPager(pages);
	}

	private sortIndicator(key: 'real' | 'code'): string {
		if (this.sortKey !== key) return '';
		return this.sortDir > 0 ? ' ▲' : ' ▼';
	}

	private renderPager(pages: number): void {
		const t = (k: string): string => this.plugin.t(k);
		this.pagerEl.empty();
		if (pages <= 1) return;
		const prev = this.pagerEl.createEl('button', { text: t('pagerPrev') });
		prev.addEventListener('click', () => {
			if (this.page > 0) {
				this.page--;
				this.renderTable();
			}
		});
		for (let i = 0; i < pages; i++) {
			const b = this.pagerEl.createEl('button', { text: String(i + 1) });
			if (i === this.page) b.addClass('mod-cta');
			b.addEventListener('click', () => {
				this.page = i;
				this.renderTable();
			});
		}
		const next = this.pagerEl.createEl('button', { text: t('pagerNext') });
		next.addEventListener('click', () => {
			if (this.page < pages - 1) {
				this.page++;
				this.renderTable();
			}
		});
	}

	private updateBulk(): void {
		if (this.delSelBtn) this.delSelBtn.setText(this.plugin.t('delSel') + ' (' + this.selected.size + ')');
	}

	private toggleSort(k: 'real' | 'code'): void {
		if (this.sortKey === k) this.sortDir *= -1;
		else {
			this.sortKey = k;
			this.sortDir = 1;
		}
		this.renderTable();
	}

	private hint(msg: string): void {
		this.addHintEl.setText(msg);
		this.addHintEl.className = 'ai-hint ai-err';
	}

	private saveInlineAdd(): void {
		const t = (k: string): string => this.plugin.t(k);
		const real = this.addRealEl.value.trim();
		const catId = this.addCatEl.value;
		const manual = this.addManualEl.checked;
		const codeVal = this.addCodeEl.value.trim().toUpperCase();
		if (!real) {
			this.hint(t('errEmpty'));
			return;
		}
		if (manual) {
			if (!isValidCode(codeVal)) {
				this.hint(t('errChars'));
				return;
			}
			if (this.plugin.settings.mappings.some((m) => m.code === codeVal)) {
				this.hint(t('errDup'));
				return;
			}
			this.plugin.settings.mappings.push({ real, code: codeVal, category: this.normCat(catId), manual: true });
			void this.plugin.save();
			this.afterAdd(codeVal);
		} else {
			const cat = this.plugin.categoryById(catId);
			if (!cat) {
				this.hint(t('needCat'));
				return;
			}
			const code = this.plugin.generateCode(cat);
			this.plugin.settings.mappings.push({ real, code, category: cat.id, manual: false });
			void this.plugin.save();
			this.afterAdd(code);
		}
	}

	private afterAdd(code: string): void {
		this.plugin.t('added');
		new Notice(this.plugin.t('added') + this.plugin.wrap(code));
		this.addRealEl.value = '';
		this.addCodeEl.value = '';
		this.addManualEl.checked = false;
		this.addCodeEl.toggleClass('is-hidden', true);
		this.addCatEl.value = '';
		this.updateAutoPreview();
		this.renderTable();
		this.renderUncatNotice();
	}

	private saveEdit(i: number, realRaw: string, catId: string): void {
		const t = (k: string): string => this.plugin.t(k);
		const real = realRaw.trim();
		if (!real) {
			new Notice(t('errEmpty'));
			return;
		}
		const old = this.plugin.settings.mappings[i];
		let code = old.code;
		const manual = !!old.manual;
		if (!manual && catId !== (old.category || '')) {
			const cat = this.plugin.categoryById(catId);
			if (cat) code = this.plugin.generateCode(cat);
		}
		this.plugin.settings.mappings[i] = { real, code, category: this.normCat(catId), manual };
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
		this.renderUncatNotice();
	}

	private deleteSelected(): void {
		if (this.selected.size === 0) {
			new Notice(this.plugin.t('cancelClear'));
			return;
		}
		const n = this.selected.size;
		new ConfirmDialog(
			this.app,
			this.plugin.t('confirmDelSel').replace('%d', String(n)),
			this.plugin.t('delSel'),
			this.plugin.t('cancel'),
			() => {
				const idxs = [...this.selected].sort((a, b) => b - a);
				idxs.forEach((i) => this.plugin.settings.mappings.splice(i, 1));
				this.selected.clear();
				void this.plugin.save();
				new Notice(this.plugin.t('delN').replace('%d', String(n)));
				this.renderTable();
				this.renderUncatNotice();
			}
		).open();
	}

	private clearAll(): void {
		if (this.plugin.settings.mappings.length === 0) return;
		const n = this.plugin.settings.mappings.length;
		new ConfirmDialog(
			this.app,
			this.plugin.t('confirmClear').replace('%d', String(n)),
			this.plugin.t('clearAll'),
			this.plugin.t('cancel'),
			() => {
				this.plugin.settings.mappings = [];
				this.selected.clear();
				this.editing = null;
				void this.plugin.save();
				new Notice(this.plugin.t('delN').replace('%d', String(n)));
				this.renderTable();
				this.renderUncatNotice();
			}
		).open();
	}
}

export default class AIAliasPlugin extends Plugin {
	settings!: AIAliasSettings;
	settingsTab!: AIAliasSettingTab;

	t(key: string): string {
		const lang = this.settings.language || 'en';
		return STR[lang] && STR[lang][key] !== undefined ? STR[lang][key] : STR.en[key];
	}

	defaultCategories(): Category[] {
		const lang = this.settings.language === 'zh' ? 'zh' : 'en';
		return PRESET_DEFS.map((d) => ({
			id: d.key,
			key: d.key,
			name: d[lang],
			prefix: d.prefix,
			seq: 0
		}));
	}

	categoryById(id: string | null | undefined): Category | undefined {
		if (!id) return undefined;
		return this.settings.categories.find((c) => c.id === id);
	}

	categoryMeaning(cat: Category): string {
		if (cat.key) {
			const v = this.t('cat_' + cat.key);
			if (v) return v;
		}
		return cat.name;
	}

	resolveCategory(token: string): Category | undefined {
		const t = token.trim().toLowerCase();
		if (!t) return undefined;
		return this.settings.categories.find(
			(c) => c.name.toLowerCase() === t || c.prefix.toLowerCase() === t || (c.key && c.key.toLowerCase() === t)
		);
	}

	generateCode(cat: Category): string {
		const existing = new Set(this.settings.mappings.map((m) => m.code));
		let seq = cat.seq;
		let code: string;
		do {
			seq += 1;
			code = cat.prefix + String(seq).padStart(3, '0');
		} while (existing.has(code));
		cat.seq = seq;
		return code;
	}

	bumpCategorySeqs(): void {
		for (const cat of this.settings.categories) {
			const re = new RegExp('^' + escapeRegex(cat.prefix) + '(\\d+)$');
			let max = 0;
			for (const m of this.settings.mappings) {
				const mm = m.code.match(re);
				if (mm) {
					const n = parseInt(mm[1], 10);
					if (n > max) max = n;
				}
			}
			if (max > cat.seq) cat.seq = max;
		}
	}

	categorizeSmart(): { done: number; remain: number } {
		let done = 0;
		for (const m of this.settings.mappings) {
			if (m.category != null) continue;
			const re = new RegExp(
				'^(' +
					this.settings.categories.map((c) => '(' + escapeRegex(c.prefix) + ')').join('|') +
					')(\\d+)$'
			);
			const mm = m.code.match(re);
			if (mm) {
				const cat = this.settings.categories.find((c) => c.prefix === mm[1]);
				if (cat) {
					m.category = cat.id;
					const n = parseInt(mm[2], 10);
					if (n > cat.seq) cat.seq = n;
					done++;
				}
			}
		}
		return { done, remain: this.settings.mappings.filter((m) => m.category == null).length };
	}

	buildLegend(): string {
		const lines = ['# ' + this.t('legendTitle')];
		for (const cat of this.settings.categories) {
			lines.push('# ' + cat.prefix + ' = ' + this.categoryMeaning(cat));
		}
		return lines.join('\n');
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

		// ---- v1.7.0: file explorer batch entries ----
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				this.addBatchMenu(menu, [file], false);
			})
		);
		// 'files-menu' (multi-select) reached the public d.ts later than 'file-menu';
		// register defensively so older API surfaces just degrade silently.
		try {
			this.registerEvent(
				this.app.workspace.on('files-menu', (menu, files) => {
					this.addBatchMenu(menu, files, true);
				})
			);
		} catch {
			// multi-select entry unavailable on this Obsidian build — single file / folder still works
		}
	}

	registerCommands(): void {
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
				const text =
					this.t('promptPrefix').split('%P').join(p).split('%S').join(s) + '\n\n' + this.buildLegend();
				void navigator.clipboard
					.writeText(text)
					.then(() => new Notice(this.t('prefixCopied')))
					.catch((e) => new Notice(this.t('copyFail') + (e instanceof Error ? e.message : String(e))));
			}
		});
		this.addCommand({
			id: 'undo-last-batch',
			name: this.t('cmdUndo'),
			callback: () => {
				void this.undoLastBatch();
			}
		});
	}

	// ================= v1.7.0 batch operations =================

	private isBatchTarget(f: TFile): boolean {
		if (f.extension !== 'md') return false;
		const p = f.path;
		return !p.startsWith('.obsidian/') && !p.startsWith('.trash/');
	}

	private mdFilesUnder(folder: TFolder): TFile[] {
		const out: TFile[] = [];
		if (this.settings.batchIncludeSubfolders) {
			Vault.recurseChildren(folder, (af) => {
				if (af instanceof TFile && this.isBatchTarget(af)) out.push(af);
			});
		} else {
			for (const c of folder.children) {
				if (c instanceof TFile && this.isBatchTarget(c)) out.push(c);
			}
		}
		return out;
	}

	private collectTargets(items: TAbstractFile[]): TFile[] {
		const map = new Map<string, TFile>();
		for (const it of items) {
			if (it instanceof TFile) {
				if (this.isBatchTarget(it)) map.set(it.path, it);
			} else if (it instanceof TFolder) {
				for (const f of this.mdFilesUnder(it)) map.set(f.path, f);
			}
		}
		return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
	}

	private addBatchMenu(menu: Menu, items: TAbstractFile[], multi: boolean): void {
		const singleFile = !multi && items.length === 1 && items[0] instanceof TFile;
		// a right-click on a single non-markdown file shows nothing at all
		if (singleFile && !this.isBatchTarget(items[0] as TFile)) return;
		const targets = this.collectTargets(items);
		const n = targets.length;
		if (multi && n === 0) return;

		let encName: string;
		let decName: string;
		let label: string;
		if (singleFile) {
			encName = this.t('menuBatchEncFile');
			decName = this.t('menuBatchDecFile');
			label = items[0].path;
		} else if (multi) {
			encName = this.t('menuBatchEncSel').replace('%d', String(n));
			decName = this.t('menuBatchDecSel').replace('%d', String(n));
			label = items.map((f) => f.name).slice(0, 3).join(', ') + (items.length > 3 ? ' …' : '');
		} else {
			encName = this.t('menuBatchEncFolder').replace('%d', String(n));
			decName = this.t('menuBatchDecFolder').replace('%d', String(n));
			const fp = items[0].path === '/' ? this.app.vault.getName() : items[0].path + '/';
			label = fp + (this.settings.batchIncludeSubfolders ? this.t('bpRecursive') : '');
		}

		const add = (title: string, icon: string, dir: BatchDirection): void => {
			menu.addItem((item) => {
				item.setTitle(title).setIcon(icon).setSection('ai-alias');
				if (n === 0) {
					item.setDisabled(true);
					return;
				}
				item.onClick(() => {
					void this.startBatch(targets, dir, label);
				});
			});
		};
		add(encName, 'lock', 'encrypt');
		add(decName, 'unlock', 'decrypt');
	}

	// ---- scanning (read only) ----

	private scanRealHits(text: string, base: number): CodeHit[] {
		const hits: CodeHit[] = [];
		for (const m of this.settings.mappings) {
			if (!m.real) continue;
			let idx = text.indexOf(m.real);
			while (idx !== -1) {
				hits.push({
					start: base + idx,
					end: base + idx + m.real.length,
					code: m.code,
					real: m.real,
					category: m.category ?? null
				});
				idx = text.indexOf(m.real, idx + m.real.length);
			}
		}
		return resolveOverlaps(hits);
	}

	private scanWrappedHits(text: string): CodeHit[] {
		const hits: CodeHit[] = [];
		for (const m of this.settings.mappings) {
			const token = this.wrap(m.code);
			if (!token) continue;
			let idx = text.indexOf(token);
			while (idx !== -1) {
				hits.push({
					start: idx,
					end: idx + token.length,
					code: m.code,
					real: m.real,
					category: m.category ?? null
				});
				idx = text.indexOf(token, idx + token.length);
			}
		}
		return resolveOverlaps(hits);
	}

	private toCodeHits(hits: BareHit[]): CodeHit[] {
		const byCode = new Map<string, Mapping>();
		for (const m of this.settings.mappings) byCode.set(m.code, m);
		return hits.map((h) => ({
			start: h.start,
			end: h.end,
			code: h.code,
			real: h.real,
			category: byCode.get(h.code)?.category ?? null
		}));
	}

	private scanOne(file: TFile, content: string, direction: BatchDirection): BatchScan {
		const scan: BatchScan = {
			file,
			path: file.path,
			original: content,
			realHits: [],
			wrappedHits: [],
			decrypted: content,
			bareHits: [],
			titleHits: [],
			selected: true,
			expanded: false,
			bareChecks: [],
			titleChecks: []
		};
		if (direction === 'encrypt') {
			const skip = this.settings.batchSkipFrontmatter ? frontmatterLength(content) : 0;
			scan.realHits = this.scanRealHits(content.slice(skip), skip);
		} else {
			scan.wrappedHits = this.scanWrappedHits(content);
			scan.decrypted = this.decrypt(content);
			scan.bareHits = this.toCodeHits(this.scanBareCodes(scan.decrypted));
			scan.titleHits = this.toCodeHits(this.scanBareCodes(file.basename));
			// bare codes are never restored automatically — user ticks them one by one
			scan.bareChecks = scan.bareHits.map(() => false);
			scan.titleChecks = scan.titleHits.map(() => false);
		}
		return scan;
	}

	async startBatch(files: TFile[], direction: BatchDirection, label: string): Promise<void> {
		if (this.settings.mappings.length === 0) {
			new Notice(this.t(direction === 'encrypt' ? 'emptyEncrypt' : 'emptyDecrypt'));
			return;
		}
		if (files.length === 0) {
			new Notice(this.t('batchNoTargets'));
			return;
		}
		const notice = new Notice(this.progressText('batchScanning', 0, files.length), 0);
		const scans: BatchScan[] = [];
		try {
			for (let i = 0; i < files.length; i++) {
				const content = await this.app.vault.cachedRead(files[i]);
				scans.push(this.scanOne(files[i], content, direction));
				if ((i + 1) % BATCH_YIELD === 0) {
					notice.setMessage(this.progressText('batchScanning', i + 1, files.length));
					await yieldToUi();
				}
			}
		} finally {
			notice.hide();
		}
		new BatchPreviewModal(this.app, this, direction, label, scans).open();
	}

	private progressText(key: string, a: number, b: number): string {
		return this.t(key).replace('%a', String(a)).replace('%b', String(b));
	}

	// ---- snapshot / backup ----

	private backupDir(): string {
		const base = this.manifest.dir ?? this.app.vault.configDir + '/plugins/' + this.manifest.id;
		return base + '/backups';
	}

	private async writeSnapshot(direction: BatchDirection, label: string, plans: BatchPlan[]): Promise<void> {
		const ad = this.app.vault.adapter;
		const dir = this.backupDir();
		if (!(await ad.exists(dir))) await ad.mkdir(dir);
		const ts = stamp(new Date());
		const snap: Snapshot = {
			v: SNAPSHOT_VERSION,
			ts,
			direction,
			label,
			entries: plans.map((p) => ({
				path: p.file.path,
				before: p.before,
				afterHash: hashStr(p.after),
				renameTo: p.renameTo
			}))
		};
		await ad.write(dir + '/' + ts + '.json', JSON.stringify(snap));
		await this.pruneSnapshots();
	}

	private async pruneSnapshots(): Promise<void> {
		const ad = this.app.vault.adapter;
		const dir = this.backupDir();
		if (!(await ad.exists(dir))) return;
		const listed = await ad.list(dir);
		const keep = this.settings.batchBackupKeep;
		const files = listed.files.filter((f) => f.endsWith('.json')).sort();
		const extra = files.length - keep;
		for (let i = 0; i < extra; i++) {
			try {
				await ad.remove(files[i]);
			} catch {
				// a locked/removed snapshot must never break the main flow
			}
		}
	}

	// ---- execution ----

	async executeBatch(direction: BatchDirection, plans: BatchPlan[], label: string): Promise<void> {
		if (this.settings.batchBackupEnabled) {
			try {
				await this.writeSnapshot(direction, label, plans);
			} catch (e) {
				new Notice(this.t('backupFail') + (e instanceof Error ? e.message : String(e)));
				return;
			}
		}

		const notice = new Notice(this.progressText('batchWriting', 0, plans.length), 0);
		let ok = 0;
		let repl = 0;
		let failed = 0;
		let conflicted = 0;
		const renames: BatchPlan[] = [];
		try {
			for (let i = 0; i < plans.length; i++) {
				const p = plans[i];
				try {
					if (p.after !== p.before) {
						let clash = false;
						await this.app.vault.process(p.file, (data) => {
							if (data !== p.before) {
								clash = true;
								return data;
							}
							return p.after;
						});
						if (clash) {
							conflicted++;
						} else {
							ok++;
							repl += p.count;
						}
					} else {
						ok++;
						repl += p.count;
					}
					if (p.renameTo) renames.push(p);
				} catch {
					failed++;
				}
				if ((i + 1) % 10 === 0) {
					notice.setMessage(this.progressText('batchWriting', i + 1, plans.length));
					await yieldToUi();
				}
			}
			// renames run last so link updates see the final content
			for (const p of renames) {
				try {
					if (p.renameTo) await this.app.fileManager.renameFile(p.file, p.renameTo);
				} catch {
					failed++;
				}
			}
		} finally {
			notice.hide();
		}

		let msg = this.t('batchDone').replace('%f', String(ok)).replace('%n', String(repl));
		if (failed > 0) msg += this.t('batchDoneFail').replace('%d', String(failed));
		if (conflicted > 0) msg += this.t('batchDoneConflict').replace('%d', String(conflicted));
		if (this.settings.batchBackupEnabled) msg += this.t('batchDoneUndoable');
		new Notice(msg, 8000);
	}

	// ---- undo ----

	async undoLastBatch(): Promise<void> {
		const ad = this.app.vault.adapter;
		const dir = this.backupDir();
		try {
			if (!(await ad.exists(dir))) {
				new Notice(this.t('undoNone'));
				return;
			}
			const listed = await ad.list(dir);
			const cands = listed.files.filter((f) => f.endsWith('.json') && !f.endsWith('.undone.json')).sort();
			if (cands.length === 0) {
				new Notice(this.t('undoNone'));
				return;
			}
			const path = cands[cands.length - 1];
			const snap = JSON.parse(await ad.read(path)) as Snapshot;
			const msg = this.t('undoConfirm')
				.replace('%d', this.t(snap.direction === 'encrypt' ? 'undoDirEnc' : 'undoDirDec'))
				.replace('%t', prettyStamp(snap.ts))
				.replace('%n', String(snap.entries.length));
			new ConfirmDialog(this.app, msg, this.t('undoRun'), this.t('cancel'), () => {
				void this.applyUndo(path, snap);
			}).open();
		} catch (e) {
			new Notice(this.t('undoFail') + (e instanceof Error ? e.message : String(e)));
		}
	}

	private async applyUndo(path: string, snap: Snapshot): Promise<void> {
		let done = 0;
		let skipped = 0;
		let missing = 0;
		try {
			// reverse renames first, so the content restore can find files by original path
			for (const e of snap.entries) {
				if (!e.renameTo) continue;
				const af = this.app.vault.getAbstractFileByPath(e.renameTo);
				if (af instanceof TFile) {
					try {
						await this.app.fileManager.renameFile(af, e.path);
					} catch {
						// keep going; the content restore below reports what it cannot find
					}
				}
			}
			for (const e of snap.entries) {
				const af = this.app.vault.getAbstractFileByPath(e.path);
				if (!(af instanceof TFile)) {
					missing++;
					continue;
				}
				const cur = await this.app.vault.read(af);
				if (hashStr(cur) !== e.afterHash) {
					skipped++;
					continue;
				}
				await this.app.vault.process(af, () => e.before);
				done++;
			}
			await this.app.vault.adapter.rename(path, path.replace(/\.json$/, '.undone.json'));
		} catch (e) {
			new Notice(this.t('undoFail') + (e instanceof Error ? e.message : String(e)));
			return;
		}
		let msg = this.t('undoDone').replace('%n', String(done));
		if (skipped > 0) msg += this.t('undoSkipped').replace('%n', String(skipped));
		if (missing > 0) msg += this.t('undoMissing').replace('%n', String(missing));
		new Notice(msg, 8000);
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
		// trailing word-boundary only; the leading boundary is checked manually below
		// (lookbehind is unsupported on iOS < 16.4, so we avoid it)
		return new RegExp(esc + '(?![A-Za-z0-9_])', 'g');
	}

	// Scan for alias codes that appear WITHOUT the prefix/suffix wrapper.
	// Called after decrypt(), so wrapped codes are already converted to real names.
	scanBareCodes(text: string): BareHit[] {
		const hits: BareHit[] = [];
		for (const m of this.settings.mappings) {
			const re = this.buildBareRegex(m.code);
			let mm: RegExpExecArray | null;
			while ((mm = re.exec(text)) !== null) {
				// manual leading word-boundary check (replaces unsupported lookbehind)
				const prev = mm.index > 0 ? text[mm.index - 1] : '';
				const prevIsWord = prev !== '' && /[A-Za-z0-9_]/.test(prev);
				if (!prevIsWord) {
					hits.push({ start: mm.index, end: mm.index + mm[0].length, code: m.code, real: m.real });
				}
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
		if (!Array.isArray(this.settings.mappings)) this.settings.mappings = [];
		if (!Array.isArray(this.settings.categories)) this.settings.categories = [];
		if (this.settings.language !== 'zh') this.settings.language = 'en';

		// ---- v1.7.0 batch settings sanity (new keys merge from DEFAULT_SETTINGS, no schema bump) ----
		this.settings.batchIncludeSubfolders = this.settings.batchIncludeSubfolders !== false;
		this.settings.batchSkipFrontmatter = this.settings.batchSkipFrontmatter !== false;
		this.settings.batchBackupEnabled = this.settings.batchBackupEnabled !== false;
		this.settings.batchRenameTitles = this.settings.batchRenameTitles === true;
		if (this.settings.batchBareCodePolicy !== 'skip') this.settings.batchBareCodePolicy = 'confirmAll';
		const keep = Number(this.settings.batchBackupKeep);
		this.settings.batchBackupKeep = Number.isFinite(keep) ? Math.min(20, Math.max(1, Math.floor(keep))) : 5;

		// ---- v1.6.0 migration (idempotent) ----
		let migrated = false;
		if (this.settings.categories.length === 0 && this.settings.schemaVersion !== SCHEMA_VERSION) {
			this.settings.categories = this.defaultCategories();
			migrated = true;
		}
		for (const m of this.settings.mappings) {
			if (m.category === undefined) m.category = null;
			if (m.manual === undefined) m.manual = false;
		}
		this.bumpCategorySeqs();
		if (migrated) {
			this.settings.schemaVersion = SCHEMA_VERSION;
			await this.save();
		}
	}
}

interface BareHit {
	start: number;
	end: number;
	code: string;
	real: string;
}
