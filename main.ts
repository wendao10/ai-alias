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
	batchBareCodePolicy: 'skip' | 'confirmAll' | 'restoreAll';
	batchRenameTitles: boolean;
	batchSkipFrontmatter: boolean;
	batchBackupEnabled: boolean;
	batchBackupKeep: number;
	// ---- v1.8.0 UI refactor: paste auto-unmask ----
	pasteUnmask: boolean;
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
	batchBackupKeep: 5,
	pasteUnmask: false
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
		headerTitle: 'AI Alias',
		headerSub: 'AI Encryption Computing Assistant',
		navGeneral: 'General',
		navCatMap: 'Categories & mappings',
		navBatch: 'Batch operations',
		navData: 'Data management',
		closeAria: 'Close settings',
		secGeneral: 'General',
		secCategory: 'Categories',
		secMapping: 'Mapping table',
		secBatch: 'Batch operations',
		language: 'Language',
		languageDesc: 'Interface language for this plugin.',
		prefix: 'Alias wrap prefix',
		prefixDesc: 'Left wrapper around the alias. Default [[ renders as an Obsidian link; change to 【 or « to avoid that.',
		suffix: 'Alias wrap suffix',
		suffixDesc: 'Right wrapper around the alias.',
		pasteUnmask: 'Paste & auto-unmask',
		pasteUnmaskDesc: 'When you paste text that contains aliases (e.g. from an AI reply), automatically restore the real names in the pasted text. Only the pasted text is affected.',
		pasteUnmasked: 'Auto-restored aliases in pasted text',
		add: 'Single',
		importExport: 'Import / Export mappings',
		importExportDesc: 'Export: copy JSON to clipboard (safe, not written to any note). Import: paste JSON from clipboard; choose Clear & insert or Insert.',
		exportBtn: 'Export to clipboard',
		importBtn: 'Import from clipboard',
		// CRUD manager
		mappingTitle: 'Mapping table',
		openMappingDesc: 'Open in a wider full-screen window (recommended to avoid the narrow right-side panel).',
		mappingInlineDesc: 'Search, add, edit and delete mappings here. Entries are shown 10 per page; use the category dropdown to filter.',
		searchPh: 'Search real name / alias…',
		batchAdd: 'Batch',
		delSel: 'Delete selected',
		clearAll: 'Clear all',
		toolImport: 'Import',
		toolExport: 'Export',
		addSave: 'Add',
		save: 'Save',
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
		crudNote: 'Tips: search filters live (real/alias/category); use the category dropdown to filter; the add form auto-generates the alias from the chosen category; pages of 10.',
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
		cmdOpenMappings: 'AI Alias: Open mappings (打开映射表管理)',
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
		custom: 'Custom',
		catAddTitle: 'Add category',
		catEditTitle: 'Edit category',
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
		noCat: '—',
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
		codeName: 'Alias',
		codePlaceholderAuto: 'Leave empty to auto-generate',
		pagerPrev: 'Prev',
		pagerNext: 'Next',
		catNotFound: 'Category not found',
		batchPerLine: 'Per line: real|category',
		batchCatDefault: 'Default category',
		// ---- v1.7.0 batch operations: settings ----
		batchHeading: 'Batch operations (file explorer)',
		batchNote: 'Batch operations settings',
		batchIncludeSub: 'Include subfolders',
		batchIncludeSubDesc: 'When running a batch action on a folder, also process notes inside its subfolders.',
		batchBarePolicy: 'Bare alias codes on batch decrypt',
		batchBarePolicyDesc:
			'A bare code is an alias that appears without the wrapper (AI replies often drop it). "Confirm each" lists every bare code, unchecked by default. "Restore all" pre-checks them all. "Skip" restores only aliases that still have the wrapper.',
		batchBarePolicyConfirm: 'Confirm each (recommended)',
		batchBarePolicySkip: 'Skip bare codes',
		batchBarePolicyRestore: 'Restore all bare codes',
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
		bpPolicyRestoreAll: 'Bare codes are pre-selected below (restore all); uncheck any you want to keep as aliases.',
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
		// ---- v1.8.0 batch preview & import modals (new i18n keys) ----
		bpSubEnc: 'Batch encrypt preview · a snapshot is auto-created for undo.',
		bpSubDec: 'Batch decrypt preview · a snapshot is auto-created for undo.',
		bpStatFiles: 'Files',
		bpStatHits: 'Hits',
		bpStatBare: 'Bare',
		bpSkipFmLabel: 'Skip frontmatter when encrypting',
		bpBareLabel: 'Bare codes (unwrapped) handling',
		bpFileListTitle: 'File list',
		bpInfoBar: 'Operation will modify files; a snapshot was auto-created and can be undone anytime.',
		bpInfoBarFmt: 'Operation will modify %d file(s); a snapshot was auto-created and can be undone anytime.',
		bpSelected: 'Selected %d / %d',
		bpRunEnc: 'Run encryption (%d notes)',
		bpRunDec: 'Run decryption (%d notes)',
		importTitleV2: 'Batch import mappings',
		importSubV2: 'One per line: real name = alias. Preview, then insert into the mapping table.',
		importInputLabel: 'Mapping content (each line: original = alias)',
		importModeLabel: 'Import mode',
		importMergeV2: 'Append insert',
		importOverwriteV2: 'Clear & insert',
		importPreviewEmpty: 'Preview: enter mappings to import',
		importPreviewHead: '%v valid · %s duplicates skipped',
		importWillInsert: 'Will insert %d entries',
		importDoBtn: 'Import %d entries',
		importJsonHead: 'Export file detected · %v mappings',
		importJsonCats: ' · %c categories',
		importCatApplied: ' · %c categories applied',
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
		headerTitle: 'AI Alias 设置',
		headerSub: 'AI加密计算助手',
		navGeneral: '通用',
		navCatMap: '分类与映射',
		navBatch: '批量操作',
		navData: '数据管理',
		closeAria: '关闭设置',
		secGeneral: '通用',
		secCategory: '分类管理',
		secMapping: '映射表',
		secBatch: '批量操作',
		language: '语言',
		languageDesc: '本插件的界面语言。',
		prefix: '代号包裹前缀',
		prefixDesc: '包裹代号的左符号。默认 [[ 会被 Obsidian 渲染成链接，可改为 【 或 « 避免。',
		suffix: '代号包裹后缀',
		suffixDesc: '包裹代号的右符号。',
		pasteUnmask: '粘贴即还原',
		pasteUnmaskDesc: '粘贴包含代号的内容（如 AI 回复）时，自动把代号还原为真实名称。仅影响粘贴进来的文本。',
		pasteUnmasked: '已自动还原粘贴文本中的代号',
		add: '单条',
		importExport: '导入 / 导出映射',
		importExportDesc: '导出：复制 JSON 到剪贴板（安全，不写入任何笔记）。导入：从剪贴板粘贴 JSON，可选择清空后插入或插入。',
		exportBtn: '导出到剪贴板',
		importBtn: '从剪贴板导入',
		// CRUD manager
		mappingTitle: '映射表',
		openMappingDesc: '在更宽的全屏窗口中管理映射表（推荐，避免右侧设置面板过窄）。',
		mappingInlineDesc: '在此搜索、新增、编辑、删除映射。每页显示 10 条，可用类别下拉筛选。',
		searchPh: '搜索真实名 / 代号…',
		batchAdd: '批量',
		delSel: '删除选中',
		clearAll: '清空全部',
		toolImport: '导入',
		toolExport: '导出',
		addSave: '新增',
		save: '保存',
		cancel: '取消',
		thReal: '真实名',
		thCode: '代号',
		thCat: '分类',
		actions: '操作',
		edit: '编辑',
		del: '删除',
		empty: '（空）请先新增条目。',
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
		batchTitle: '批量新增映射',
		batchFmt: '每行一条。「原文」→ 用默认类别自动出码；「原文|类别」→ 指定类别自动出码；「原文=代号」→ 手动代号（未分类）。空行忽略。',
		batchSave: '新增',
		previewWarn: '跳过：',
		dupInBatch: '批量内重复',
		importMergeOk: '已插入 %d 条新映射',
		crudNote: '提示：搜索实时筛选（真实名/代号/分类）；用分类下拉筛选；新增时按所选分类自动出码；每页 10 条分页。',
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
		cmdOpenMappings: 'AI Alias：打开映射表管理（Open mappings）',
		menuEncrypt: 'AI Alias：真实名 → 代号',
		menuDecrypt: 'AI Alias：代号 → 真实名',
		emptyEncrypt: '映射表为空，请先在设置中新增条目',
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
		custom: '自定义',
		catAddTitle: '新增类别',
		catEditTitle: '编辑类别',
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
		noCat: '—',
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
		codeName: '代号',
		codePlaceholderAuto: '留空自动生成',
		pagerPrev: '上一页',
		pagerNext: '下一页',
		catNotFound: '未找到该类别',
		batchPerLine: '每行格式：原文|类别',
		batchCatDefault: '默认类别',
		// ---- v1.7.0 批量操作：设置项 ----
		batchHeading: '批量操作（文件列表右键）',
		batchNote: '批量操作设置',
		batchIncludeSub: '包含子文件夹',
		batchIncludeSubDesc: '对文件夹执行批量操作时，是否一并处理其子文件夹内的笔记。',
		batchBarePolicy: '批量解密时的裸代号策略',
		batchBarePolicyDesc:
			'裸代号指没有前后缀包裹的代号（AI 回复经常把包裹弄丢）。「逐条确认」会把所有裸代号列出、默认不勾选；「全部还原」默认全部勾选；「跳过」则只还原仍带前后缀的代号。',
		batchBarePolicyConfirm: '逐条确认（推荐）',
		batchBarePolicySkip: '跳过裸代号',
		batchBarePolicyRestore: '全部还原裸代号',
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
		bpPolicyRestoreAll: '裸代号已默认全部勾选（全部还原），如需保留为代号可取消勾选。',
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
		// ---- v1.8.0 批量预览与导入弹窗（新增 i18n 键） ----
		bpSubEnc: '将自动创建快照，可随时撤销。',
		bpSubDec: '将自动创建快照，可随时撤销。',
		bpStatFiles: '文件',
		bpStatHits: '命中',
		bpStatBare: '裸代号',
		bpSkipFmLabel: '加密时跳过 frontmatter',
		bpBareLabel: '裸代号（未包裹）处理',
		bpFileListTitle: '文件清单',
		bpInfoBar: '操作将修改文件，已自动创建快照，可随时撤销。',
		bpInfoBarFmt: '操作将修改 %d 个文件，已自动创建快照，可随时撤销。',
		bpSelected: '已选 %d / %d 个文件',
		bpRunEnc: '执行加密（%d 篇）',
		bpRunDec: '执行解密（%d 篇）',
		importTitleV2: '批量导入映射',
		importSubV2: '每行一条：真实名=代号，预览后插入映射表',
		importInputLabel: '映射内容（每行 原文=代号）',
		importModeLabel: '导入方式',
		importMergeV2: '追加插入',
		importOverwriteV2: '清空后插入',
		importPreviewEmpty: '预览：请输入要导入的映射',
		importPreviewHead: '%v 条有效 · %s 条重复已跳过',
		importWillInsert: '将插入 %d 条',
		importDoBtn: '导入 %d 条',
		importJsonHead: '已识别导出文件 · %v 条映射',
		importJsonCats: ' · %c 个分类',
		importCatApplied: ' · 已应用 %c 个分类',
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
		const used = new Set<string>(this.plugin.settings.mappings.map((mm) => mm.code));
		const localSeq = new Map<string, number>();
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
				if (used.has(code)) {
					skipped.push({ line: s, reason: t('dupInBatch') });
					continue;
				}
				used.add(code);
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
			let seq = localSeq.get(cat.id) ?? cat.seq;
			let code: string;
			do {
				seq += 1;
				code = cat.prefix + String(seq).padStart(3, '0');
			} while (used.has(code));
			localSeq.set(cat.id, seq);
			used.add(code);
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
			let code = v.code;
			if (!v.manual) {
				const cat = this.plugin.categoryById(v.category);
				if (cat) code = this.plugin.generateCode(cat);
			}
			this.plugin.settings.mappings.push({ real: v.real, code, category: v.category, manual: v.manual });
		}
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
	mode: 'merge' | 'overwrite' = 'merge';
	preview: { valid: { real: string; code: string; category: string | null; manual: boolean }[]; skipped: { line: string; reason: string }[] } | null = null;
	isJson = false;
	importCategories: Category[] | null = null;
	importBtn!: HTMLButtonElement;
	importLabel!: HTMLElement;
	previewEl!: HTMLElement;
	previewHeader!: HTMLElement;

	constructor(app: App, plugin: AIAliasPlugin, tab: AIAliasSettingTab) {
		super(app);
		this.plugin = plugin;
		this.tab = tab;
	}

	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		this.modalEl.addClass('ai-importmodal');
		this.titleEl.setText(t('importTitleV2') || '\u6279\u91cf\u5bfc\u5165\u6620\u5c04');
		contentEl.createEl('p', { cls: 'ai-sub', text: t('importSubV2') || '\u6bcf\u884c\u4e00\u6761\uff1a\u771f\u5b9e\u540d=\u4ee3\u53f7\uff0c\u9884\u89c8\u540e\u63d2\u5165\u6620\u5c04\u8868' });

		const inputWrap = contentEl.createDiv('ai-import-input');
		inputWrap.createDiv('ai-import-label').setText(t('importInputLabel') || '\u6620\u5c04\u5185\u5bb9\uff08\u6bcf\u884c \u539f\u6587=\u4ee3\u53f7\uff09');
		this.taEl = inputWrap.createEl('textarea', { cls: 'ai-ta ai-import-ta' });
		this.taEl.rows = 5;
		this.taEl.addEventListener('input', () => this.parse());

		const modeWrap = contentEl.createDiv('ai-import-mode');
		modeWrap.createDiv('ai-import-label').setText(t('importModeLabel') || '\u5bfc\u5165\u65b9\u5f0f');
		const modeBtns = modeWrap.createDiv('ai-import-modebtns');
		const mergeBtn = modeBtns.createEl('button', { text: t('importMergeV2') || '\u9012\u52a0\u63d2\u5165', type: 'button', cls: 'ai-import-modebtn is-active' });
		const overBtn = modeBtns.createEl('button', { text: t('importOverwriteV2') || '\u6e05\u7a7a\u540e\u63d2\u5165', type: 'button', cls: 'ai-import-modebtn' });
		mergeBtn.addEventListener('click', () => {
			this.mode = 'merge';
			mergeBtn.addClass('is-active');
			overBtn.removeClass('is-active');
		});
		overBtn.addEventListener('click', () => {
			this.mode = 'overwrite';
			overBtn.addClass('is-active');
			mergeBtn.removeClass('is-active');
		});

		this.previewEl = contentEl.createDiv('ai-import-preview');
		this.previewHeader = this.previewEl.createDiv('ai-import-previewhead');
		const previewBody = this.previewEl.createDiv('ai-import-previewbody');

		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		this.importLabel = foot.createSpan({ text: '', cls: 'ai-import-footlabel' });
		const cancelBtn = foot.createEl('button', { text: t('cancel') });
		cancelBtn.addEventListener('click', () => this.close());
		this.importBtn = foot.createEl('button', { text: '', cls: 'mod-cta' });
		this.importBtn.addEventListener('click', () => this.doImport());

		this.parse();
		void previewBody;
	}

	parse(): void {
		const t = (k: string): string => this.plugin.t(k);
		const text = this.taEl.value.trim();
		// ---- JSON export format (from exportMappings) ----
		if (text) {
			const json = this.tryParseJSON(text);
			if (json) {
				const valid: { real: string; code: string; category: string | null; manual: boolean }[] = [];
				const skipped: { line: string; reason: string }[] = [];
				const used = new Set(this.mode === 'overwrite' ? [] : this.plugin.settings.mappings.map((mm) => mm.code));
				for (const m of json.mappings) {
					const real = (m.real ?? '').trim();
					const code = (m.code ?? '').trim().toUpperCase();
					if (!real || !code) {
						skipped.push({ line: JSON.stringify(m), reason: t('errEmptyField') });
						continue;
					}
					if (!isValidCode(code)) {
						skipped.push({ line: code, reason: t('errInvalid') + code });
						continue;
					}
					if (used.has(code)) {
						skipped.push({ line: code, reason: t('errDuplicate') + code });
						continue;
					}
					used.add(code);
					valid.push({ real, code, category: m.category, manual: m.manual === true });
				}
				this.isJson = true;
				this.importCategories = json.categories;
				this.preview = { valid, skipped };
				this.renderPreview();
				return;
			}
		}
		// ---- legacy line-based format: real=code ----
		this.isJson = false;
		this.importCategories = null;
		const raw = this.taEl.value.split(/\r?\n/);
		const valid: { real: string; code: string; category: string | null; manual: boolean }[] = [];
		const skipped: { line: string; reason: string }[] = [];
		const used = new Set(this.plugin.settings.mappings.map((mm) => mm.code));
		for (const line of raw) {
			const s = line.trim();
			if (!s) continue;
			const mEq = s.match(/^(.*?)\s*(?:=|→)\s*(.+)$/);
			if (!mEq) {
				skipped.push({ line: s, reason: t('errEmpty') });
				continue;
			}
			const real = mEq[1].trim();
			const code = mEq[2].trim().toUpperCase();
			if (!real || !code) {
				skipped.push({ line: s, reason: t('errEmptyField') });
				continue;
			}
			if (!isValidCode(code)) {
				skipped.push({ line: s, reason: t('errInvalid') + code });
				continue;
			}
			if (used.has(code)) {
				skipped.push({ line: s, reason: t('errDuplicate') + code });
				continue;
			}
			used.add(code);
			valid.push({ real, code, category: null, manual: true });
		}
		this.preview = { valid, skipped };
		this.renderPreview();
	}

	// Recognize the exportMappings() JSON output (full AIAliasSettings or a
	// bare mappings array) and normalize it into import-ready rows.
	private tryParseJSON(text: string): { mappings: { real: string; code: string; category: string | null; manual: boolean }[]; categories: Category[] | null } | null {
		let obj: unknown;
		try {
			obj = JSON.parse(text);
		} catch {
			return null;
		}
		if (obj == null || typeof obj !== 'object') return null;
		let arr: any[] | null = null;
		if (Array.isArray(obj)) {
			arr = obj as any[];
		} else if (Array.isArray((obj as any).mappings)) {
			arr = (obj as any).mappings as any[];
		} else {
			return null;
		}
		const cats: Category[] | null =
			!Array.isArray(obj) && Array.isArray((obj as any).categories) ? ((obj as any).categories as Category[]) : null;
		const norm = (v: string | null): string | null =>
			v === FILTER_UNCAT || v === FILTER_ALL || !v ? null : v;
		const mappings: { real: string; code: string; category: string | null; manual: boolean }[] = [];
		for (const it of arr) {
			if (it == null || typeof it !== 'object') {
				if (Array.isArray(it) && it.length >= 2) {
					const real = String(it[0]).trim();
					const code = String(it[1]).trim().toUpperCase();
					if (real && code && isValidCode(code)) {
						mappings.push({ real, code, category: null, manual: true });
					}
				}
				continue;
			}
			const real = typeof it.real === 'string' ? it.real.trim() : '';
			const codeRaw =
				typeof it.code === 'string'
					? it.code.trim().toUpperCase()
					: typeof it.code === 'number'
					? String(it.code)
					: '';
			if (!real || !codeRaw || !isValidCode(codeRaw)) continue;
			const catRaw = it.category === undefined || it.category === null ? null : String(it.category);
			const manual = typeof it.manual === 'boolean' ? it.manual : catRaw === null;
			mappings.push({ real, code: codeRaw, category: norm(catRaw), manual });
		}
		return { mappings, categories: cats };
	}

	private renderPreview(): void {
		const t = (k: string): string => this.plugin.t(k);
		if (!this.preview) return;
		const { valid, skipped } = this.preview;
		const total = valid.length + skipped.length;
		this.previewHeader.empty();
		if (total === 0) {
			this.previewHeader.setText(t('importPreviewEmpty') || '\u9884\u89c8\uff1a\u8bf7\u8f93\u5165\u8981\u5bfc\u5165\u7684\u6620\u5c04');
			this.previewEl.createDiv('ai-import-previewempty').setText('');
		} else if (this.isJson) {
			let head = t('importJsonHead').replace('%v', String(valid.length));
			if (this.importCategories) head += t('importJsonCats').replace('%c', String(this.importCategories.length));
			this.previewHeader.setText(head);
		} else {
			const headText = t('importPreviewHead') || '%v \u6761\u6709\u6548 \u00b7 %s \u6761\u91cd\u590d\u5df2\u8df3\u8fc7';
			this.previewHeader.setText(headText.replace('%v', String(valid.length)).replace('%s', String(skipped.length)));
		}
		const body = this.previewEl.querySelector('.ai-import-previewbody') as HTMLElement | null;
		if (body) {
			body.empty();
			for (const v of valid) {
				const row = body.createDiv('ai-import-previewrow');
				row.createSpan({ text: v.real, cls: 'ai-import-prevreal' });
				row.createSpan({ text: ' → ', cls: 'ai-import-prevarrow' });
				row.createSpan({ text: '[[' + v.code + ']]', cls: 'ai-import-prevcode' });
			}
			for (const sk of skipped) {
				const row = body.createDiv('ai-import-previewrow is-skip');
				row.createSpan({ text: sk.line, cls: 'ai-import-prevreal' });
				row.createSpan({ text: ' ' + sk.reason, cls: 'ai-import-prevreason' });
			}
		}
		const willInsert = valid.length;
		const footText = t('importWillInsert') || '\u5c06\u63d2\u5165 %d \u6761';
		this.importLabel.setText(footText.replace('%d', String(willInsert)));
		this.importBtn.setText((t('importDoBtn') || '\u5bfc\u5165 %d \u6761').replace('%d', String(willInsert)));
		this.importBtn.disabled = willInsert === 0;
	}

	doImport(): void {
		const t = (k: string): string => this.plugin.t(k);
		if (!this.preview) return;
		const { valid } = this.preview;
		const hasCats = !!this.importCategories && this.importCategories.length > 0;
		if (valid.length === 0 && !hasCats) return;
		if (this.mode === 'overwrite') {
			this.plugin.settings.mappings = [];
			if (this.importCategories) this.plugin.settings.categories = this.importCategories.slice();
		} else if (hasCats) {
			const existIds = new Set(this.plugin.settings.categories.map((c) => c.id));
			for (const c of this.importCategories!) {
				if (!existIds.has(c.id)) this.plugin.settings.categories.push(c);
			}
		}
		for (const v of valid) {
			this.plugin.settings.mappings.push(v);
		}
		void this.plugin.save();
		const n = valid.length;
		let msg: string = this.mode === 'overwrite' ? t('imported').replace('%d', String(n)) : t('importMergeOk').replace('%d', String(n));
		if (hasCats) msg += t('importCatApplied').replace('%c', String(this.importCategories!.length));
		new Notice(msg);
		this.tab.renderTable();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class MappingTableModal extends Modal {
	plugin: AIAliasPlugin;
	private tab: AIAliasSettingTab;

	constructor(app: App, plugin: AIAliasPlugin) {
		super(app);
		this.plugin = plugin;
		this.tab = new AIAliasSettingTab(app, plugin);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		const modalRoot = contentEl.closest('.modal') as HTMLElement | null;
		if (modalRoot) modalRoot.addClass('ai-mapping-modal');
		const t = (k: string): string => this.plugin.t(k);
		this.titleEl.setText(t('mappingTitle'));
		this.tab.buildMappingUI(contentEl);
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

	private listEl!: HTMLElement;
	private infoEl!: HTMLElement;
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
		const subText = (this.direction === 'encrypt' ? (t('bpSubEnc') || '3 \u4e2a\u6587\u4ef6 \u00b7 \u547d\u4e2d 14 \u5904 \u00b7 \u5c06\u81ea\u52a8\u521b\u5efa\u5feb\u7167') : (t('bpSubDec') || '3 \u4e2a\u6587\u4ef6 \u00b7 \u547d\u4e2d 14 \u5904 \u00b7 \u5c06\u81ea\u52a8\u521b\u5efa\u5feb\u7167'));
		contentEl.createEl('p', { cls: 'ai-sub', text: subText });

		// Stats bar: 3 large numbers
		const stats = contentEl.createDiv('ai-bpstats');
		const statFiles = stats.createDiv('ai-bpstat');
		statFiles.createDiv('ai-bpstat-num').setText(String(this.scans.length));
		statFiles.createDiv('ai-bpstat-lbl').setText(t('bpStatFiles') || '\u6587\u4ef6');
		const statHits = stats.createDiv('ai-bpstat');
		let totalHits = 0;
		for (const s of this.scans) {
			if (this.direction === 'encrypt') totalHits += s.realHits.length;
			else totalHits += s.wrappedHits.length + s.bareHits.length + s.titleHits.length;
		}
		statHits.createDiv('ai-bpstat-num').setText(String(totalHits));
		statHits.createDiv('ai-bpstat-lbl').setText(t('bpStatHits') || '\u547d\u4e2d');
		const statBare = stats.createDiv('ai-bpstat');
		let totalBare = 0;
		for (const s of this.scans) totalBare += s.bareHits.length;
		statBare.createDiv('ai-bpstat-num is-bare').setText(String(totalBare));
		statBare.createDiv('ai-bpstat-lbl').setText(t('bpStatBare') || '\u88f8\u4ee3\u53f7');

		// Settings section
		const settingsBox = contentEl.createDiv('ai-bpsettings');
		if (this.direction === 'encrypt') {
			const l1 = settingsBox.createEl('label', { cls: 'ai-bpcheckrow' });
			const c1 = l1.createEl('input', { type: 'checkbox' });
			c1.checked = this.plugin.settings.batchSkipFrontmatter;
			l1.createSpan({ text: t('bpSkipFmLabel') || '\u52a0\u5bc6\u65f6\u8df3\u8fc7 frontmatter' });
			c1.addEventListener('change', () => {
				this.plugin.settings.batchSkipFrontmatter = c1.checked;
				void this.plugin.save();
			});
		} else {
			const pol = settingsBox.createDiv('ai-bppolicy');
			const policy = this.plugin.settings.batchBareCodePolicy;
			pol.createDiv('ai-bppolicy-hint').setText(policy === 'restoreAll' ? t('bpPolicyRestoreAll') : t('bpPolicyHint'));
			const bareRow = pol.createDiv('ai-bpcheckrow');
			bareRow.createSpan({ text: t('bpBareLabel') || '\u88f8\u4ee3\u53f7\uff08\u672a\u5305\u88f9\uff09\u5904\u7406' });
			const sel = bareRow.createEl('select', { cls: 'ai-bpsel' });
			sel.createEl('option', { text: t('batchBarePolicyConfirm'), value: 'confirmAll' });
			sel.createEl('option', { text: t('batchBarePolicySkip'), value: 'skip' });
			sel.createEl('option', { text: t('batchBarePolicyRestore'), value: 'restoreAll' });
			sel.value = this.plugin.settings.batchBareCodePolicy;
			sel.addEventListener('change', () => {
				this.plugin.settings.batchBareCodePolicy = sel.value as 'skip' | 'confirmAll' | 'restoreAll';
				void this.plugin.save();
				this.skipBare = this.plugin.settings.batchBareCodePolicy === 'skip';
				this.renderList();
				this.refresh();
			});
			const l2 = pol.createEl('label', { cls: 'ai-bpcheckrow' });
			const c2 = l2.createEl('input', { type: 'checkbox' });
			c2.checked = this.renameTitles;
			l2.createSpan({ text: t('bpRenameTitles') });
			c2.addEventListener('change', () => {
				this.renameTitles = c2.checked;
				this.renderList();
				this.refresh();
			});
			pol.createDiv('ai-bppolicy-warn').setText(t('bpRenameWarn'));
		}

		// File list section
		const listWrap = contentEl.createDiv('ai-bplistwrap');
		listWrap.createDiv('ai-bpsectitle').setText(t('bpFileListTitle') || '\u6587\u4ef6\u6e05\u5355');
		this.listEl = listWrap.createDiv('ai-bplist');

		// Info bar (purple)
		this.infoEl = contentEl.createDiv('ai-bpinfo');
		this.infoEl.setText(t('bpInfoBar') || '\u64cd\u4f5c\u5c06\u4fee\u6539 N \u4e2a\u6587\u4ef6\uff0c\u5df2\u81ea\u52a8\u521b\u5efa\u5feb\u7167\uff0c\u53ef\u968f\u65f6\u64a4\u9500\u3002');

		// Footer
		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		foot.createSpan({ text: '', cls: 'ai-bpfoodsel' });
		foot.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.close());
		foot.createEl('button', { text: t('bpSelAll') }).addEventListener('click', () => this.setAll(true));
		foot.createEl('button', { text: t('bpSelNone') }).addEventListener('click', () => this.setAll(false));
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
		for (const s of this.scans) {
			if (!s.selected || !this.hasPotential(s)) continue;
			const c = this.counts(s);
			if (c.n === 0) continue;
			files++;
			n += c.n;
		}
		const selTotal = this.scans.filter((s) => s.selected).length;
		const totalScans = this.scans.length;
		const infoText = (t('bpInfoBarFmt') || '\u64cd\u4f5c\u5c06\u4fee\u6539 %d \u4e2a\u6587\u4ef6\uff0c\u5df2\u81ea\u52a8\u521b\u5efa\u5feb\u7167\uff0c\u53ef\u968f\u65f6\u64a4\u9500\u3002').replace('%d', String(files));
		if (this.infoEl) this.infoEl.setText(infoText);
		const selLabel = this.modalEl.querySelector('.ai-bpfoodsel') as HTMLElement | null;
		if (selLabel) selLabel.setText((t('bpSelected') || '\u5df2\u9009 %d / %d \u4e2a\u6587\u4ef6').replace('%d', String(selTotal)).replace('%d', String(totalScans)));
		const runLabel = this.direction === 'encrypt'
			? (t('bpRunEnc') || '\u6267\u884c\u52a0\u5bc6\uff08%d \u7bc7\uff09')
			: (t('bpRunDec') || '\u6267\u884c\u89e3\u5bc6\uff08%d \u7bc7\uff09');
		this.runBtn.setText(runLabel.replace('%d', String(files)));
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

class CategoryModal extends Modal {
	plugin: AIAliasPlugin;
	tab: AIAliasSettingTab;
	mode: 'add' | 'edit';
	cat?: Category;

	private nameEl!: HTMLInputElement;
	private prefixEl!: HTMLInputElement;
	private errEl!: HTMLElement;

	constructor(app: App, plugin: AIAliasPlugin, tab: AIAliasSettingTab, mode: 'add' | 'edit', cat?: Category) {
		super(app);
		this.plugin = plugin;
		this.tab = tab;
		this.mode = mode;
		this.cat = cat;
	}

	onOpen(): void {
		const { contentEl } = this;
		const t = (k: string): string => this.plugin.t(k);
		this.titleEl.setText(this.mode === 'add' ? t('catAddTitle') : t('catEditTitle'));

		const box = contentEl.createEl('div', { cls: 'ai-cat-form' });
		const nf = box.createEl('div', { cls: 'ai-fld' });
		nf.createEl('label', { text: t('catNamePh') });
		this.nameEl = nf.createEl('input', { type: 'text', placeholder: t('catNamePh') });
		const pf = box.createEl('div', { cls: 'ai-fld' });
		pf.createEl('label', { text: t('catPrefixPh') });
		this.prefixEl = pf.createEl('input', { type: 'text', placeholder: t('catPrefixPh') });
		this.errEl = box.createEl('div', { cls: 'ai-hint' });

		if (this.mode === 'edit' && this.cat) {
			this.nameEl.value = this.cat.name;
			this.prefixEl.value = this.cat.prefix;
		}
		this.prefixEl.addEventListener('input', () => {
			this.prefixEl.value = this.prefixEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
		});
		this.nameEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.doSave();
			}
		});
		this.prefixEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.doSave();
			}
		});

		const foot = contentEl.createEl('div', { cls: 'ai-foot' });
		if (this.mode === 'edit' && this.cat) {
			const delBtn = foot.createEl('button', { text: t('catDel'), cls: 'mod-warning' });
			delBtn.addEventListener('click', () => {
				const c = this.cat;
				if (c) {
					this.tab.deleteCategory(c);
					this.close();
				}
			});
		}
		foot.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.close());
		const saveBtn = foot.createEl('button', { text: t('save'), cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => this.doSave());
	}

	private setErr(msg: string): void {
		this.errEl.setText(msg);
		this.errEl.className = 'ai-hint ai-err';
	}

	private doSave(): void {
		const t = (k: string): string => this.plugin.t(k);
		const name = this.nameEl.value.trim();
		let prefix = this.prefixEl.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
		const cats = this.plugin.settings.categories;
		if (!name) {
			this.setErr(t('catNameErr'));
			return;
		}
		if (this.mode === 'edit' && this.cat) {
			const c = this.cat;
			if (!prefix) prefix = c.prefix;
			if (cats.some((x) => x.id !== c.id && x.prefix === prefix)) {
				this.setErr(t('catPrefixDup'));
				return;
			}
			c.name = name;
			c.prefix = prefix;
			void this.plugin.save();
			new Notice(t('catPrefixKept'));
		} else {
			if (!prefix) prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
			if (!prefix) {
				this.setErr(t('catPrefixErr'));
				return;
			}
			if (cats.some((cc) => cc.prefix === prefix)) {
				this.setErr(t('catPrefixDup'));
				return;
			}
			this.plugin.settings.categories.push({ id: 'cat_' + Date.now().toString(36), name, prefix, seq: 0 });
			void this.plugin.save();
		}
		this.tab.renderCategoryBadges();
		this.tab.refreshFilterOptions();
		this.tab.renderTable();
		this.close();
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
	private codeTouched = false;
	private page = 0;
	private filterCat = FILTER_ALL;

	// DOM refs
	private searchEl!: HTMLInputElement;
	private tableEl!: HTMLElement;
	private pagerEl!: HTMLElement;
	private addFormEl!: HTMLElement;
	private addRealEl!: HTMLInputElement;
	private addCodeEl!: HTMLInputElement;
	private addCatEl!: HTMLSelectElement;
	private addHintEl!: HTMLElement;
	private filterSel!: HTMLSelectElement;
	private catBarEl!: HTMLElement;

	constructor(app: App, plugin: AIAliasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const t = (k: string): string => this.plugin.t(k);
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('ai-settings-v2');

		// ===== Header =====
		const header = containerEl.createDiv('ai-v2-header');
		const titleGrp = header.createDiv('ai-v2-title');
		titleGrp.createDiv('ai-v2-h2').setText(t('headerTitle'));
		titleGrp.createDiv('ai-v2-sub').setText(t('headerSub'));
		const headerRight = header.createDiv('ai-v2-headerright');
		const langWrap = headerRight.createDiv('ai-v2-lang');
		const langEn = langWrap.createEl('button', { text: 'English', type: 'button' });
		const langZh = langWrap.createEl('button', { text: '中文', type: 'button' });
		const syncLang = (): void => {
			langEn.toggleClass('is-active', this.plugin.settings.language === 'en');
			langZh.toggleClass('is-active', this.plugin.settings.language === 'zh');
		};
		syncLang();
		langEn.addEventListener('click', () => {
			this.plugin.settings.language = 'en';
			void this.plugin.save();
			syncLang();
			this.display();
		});
		langZh.addEventListener('click', () => {
			this.plugin.settings.language = 'zh';
			void this.plugin.save();
			syncLang();
			this.display();
		});
		// ===== Body (single column) =====
		const body = containerEl.createDiv('ai-v2-body');

		// ===== Sec_通用 (General) =====
		const secGeneral = body.createDiv('ai-v2-section');
		secGeneral.id = 'sec-general';
		new Setting(secGeneral).setName(t('secGeneral')).setHeading();
		new Setting(secGeneral).setName(t('language')).setDesc(t('languageDesc')).addDropdown((dd) => {
			dd.addOption('en', 'English').addOption('zh', '中文').setValue(this.plugin.settings.language).onChange(async (v) => {
				this.plugin.settings.language = v as 'en' | 'zh';
				await this.plugin.save();
				this.display();
			});
		});
		new Setting(secGeneral)
			.setName(t('pasteUnmask'))
			.setDesc(t('pasteUnmaskDesc'))
			.addToggle((tg) => tg.setValue(this.plugin.settings.pasteUnmask).onChange(async (v) => {
				this.plugin.settings.pasteUnmask = v;
				await this.plugin.save();
			}));
		const wrapRow = secGeneral.createDiv('ai-v2-wraprow');
		wrapRow.createDiv('ai-v2-wraplabel').setText(t('prefix') + ' / ' + t('suffix'));
		const wrapInputs = wrapRow.createDiv('ai-v2-wrapinputs');
		const preInp = wrapInputs.createEl('input', { type: 'text', value: this.plugin.settings.prefix, cls: 'ai-v2-pre' });
		preInp.addEventListener('change', () => {
			this.plugin.settings.prefix = preInp.value || '[[';
			void this.plugin.save();
		});
		wrapInputs.createSpan({ text: ' ' + t('realName') + ' ', cls: 'ai-v2-wrapmid' });
		const sufInp = wrapInputs.createEl('input', { type: 'text', value: this.plugin.settings.suffix, cls: 'ai-v2-suf' });
		sufInp.addEventListener('change', () => {
			this.plugin.settings.suffix = sufInp.value || ']]';
			void this.plugin.save();
		});

		// ===== Sec_分类与映射 (Categories & Mappings combined) =====
		const secCatMap = body.createDiv('ai-v2-section');
		secCatMap.id = 'sec-catmap';

		// Category sub-section
		const secCat = secCatMap.createDiv('ai-v2-subsection');
		new Setting(secCat).setName(t('secCategory')).setHeading();
		secCat.createDiv('ai-v2-note').setText(t('catPrefixDesc'));
		this.catBarEl = secCat.createDiv('ai-v2-catbar');
		this.renderCategoryBadges();

		// Mapping sub-section
		const secMap = secCatMap.createDiv('ai-v2-subsection');
		secMap.id = 'sec-mapping';
		new Setting(secMap).setName(t('secMapping')).setHeading();
		this.buildMappingUI(secMap);

		// ===== Sec_批量操作 (Batch operations) =====
		const secBatch = body.createDiv('ai-v2-section');
		secBatch.id = 'sec-batch';
		new Setting(secBatch).setName(t('secBatch')).setHeading();
		secBatch.createDiv('ai-v2-note').setText(t('batchNote'));
		new Setting(secBatch).setName(t('batchIncludeSub')).setDesc(t('batchIncludeSubDesc')).addToggle((tg) => tg.setValue(this.plugin.settings.batchIncludeSubfolders).onChange(async (v) => {
			this.plugin.settings.batchIncludeSubfolders = v;
			await this.plugin.save();
		}));
		new Setting(secBatch).setName(t('batchBarePolicy')).setDesc(t('batchBarePolicyDesc')).addDropdown((dd) => {
			dd.addOption('confirmAll', t('batchBarePolicyConfirm'))
				.addOption('skip', t('batchBarePolicySkip'))
				.addOption('restoreAll', t('batchBarePolicyRestore'))
				.setValue(this.plugin.settings.batchBareCodePolicy)
				.onChange(async (v) => {
					this.plugin.settings.batchBareCodePolicy = v as 'skip' | 'confirmAll' | 'restoreAll';
					await this.plugin.save();
				});
		});
		new Setting(secBatch).setName(t('batchRename')).setDesc(t('batchRenameDesc')).addToggle((tg) => tg.setValue(this.plugin.settings.batchRenameTitles).onChange(async (v) => {
			this.plugin.settings.batchRenameTitles = v;
			await this.plugin.save();
		}));
		new Setting(secBatch).setName(t('batchSkipFm')).setDesc(t('batchSkipFmDesc')).addToggle((tg) => tg.setValue(this.plugin.settings.batchSkipFrontmatter).onChange(async (v) => {
			this.plugin.settings.batchSkipFrontmatter = v;
			await this.plugin.save();
		}));
		new Setting(secBatch).setName(t('batchBackup')).setDesc(t('batchBackupDesc')).addToggle((tg) => tg.setValue(this.plugin.settings.batchBackupEnabled).onChange(async (v) => {
			this.plugin.settings.batchBackupEnabled = v;
			await this.plugin.save();
		}));
		new Setting(secBatch).setName(t('batchBackupKeepName')).setDesc(t('batchBackupKeepDesc')).addText((tx) => {
			tx.setValue(String(this.plugin.settings.batchBackupKeep));
			tx.inputEl.type = 'number';
			tx.inputEl.min = '1';
			tx.inputEl.max = '20';
			tx.onChange(async (v) => {
				const n = parseInt(v, 10);
				if (!isNaN(n) && n >= 1 && n <= 20) {
					this.plugin.settings.batchBackupKeep = n;
					await this.plugin.save();
				}
			});
		});

		// ===== Sec_数据管理 (Data management) - import/export =====
		const secData = body.createDiv('ai-v2-section');
		secData.id = 'sec-data';
		new Setting(secData).setName(t('navData')).setHeading();
		new Setting(secData).setName(t('exportBtn')).setDesc(t('importExportDesc')).addButton((b) => b.setButtonText(t('exportBtn')).onClick(() => this.exportMappings()));
		new Setting(secData).setName(t('importBtn')).setDesc(t('importExportDesc')).addButton((b) => b.setButtonText(t('importBtn')).onClick(() => new ImportModal(this.app, this.plugin, this).open()));
	}

	private exportMappings(): void {
		const t = (k: string): string => this.plugin.t(k);
		void navigator.clipboard
			.writeText(JSON.stringify(this.plugin.settings, null, 2))
			.then(() => new Notice(t('prefixCopied')))
			.catch((e) => new Notice(t('copyFail') + (e instanceof Error ? e.message : String(e))));
	}

	buildMappingUI(container: HTMLElement): void {
		const t = (k: string): string => this.plugin.t(k);

		const toolbar = container.createEl('div', { cls: 'ai-toolbar' });
		const searchWrap = toolbar.createEl('div', { cls: 'ai-search' });
		this.searchEl = searchWrap.createEl('input', { type: 'text', placeholder: t('searchPh') });
		this.searchEl.value = this.searchTerm;
		this.searchEl.addEventListener('input', (e) => {
			this.searchTerm = (e.target as HTMLInputElement).value;
			this.page = 0;
			this.renderTable();
		});
		this.filterSel = toolbar.createEl('select', { cls: 'ai-catfilter' });
		this.fillCatSelect(this.filterSel, false, this.filterCat, true);
		this.filterSel.addEventListener('change', () => {
			this.filterCat = this.filterSel.value;
			this.page = 0;
			this.renderTable();
		});

		const btnBar = container.createEl('div', { cls: 'ai-btns' });
		const leftGrp = btnBar.createEl('div', { cls: 'ai-btns-left' });
		const addB = leftGrp.createEl('button', { text: '+ ' + t('add'), cls: 'mod-cta' });
		addB.addEventListener('click', () => this.toggleAddForm());
		const batchB = leftGrp.createEl('button', { text: '+ ' + t('batchAdd') });
		batchB.addEventListener('click', () => new BatchAddModal(this.app, this.plugin, this).open());
		const rightGrp = btnBar.createEl('div', { cls: 'ai-btns-right' });
		const importB = rightGrp.createEl('button', { text: t('toolImport') });
		importB.addEventListener('click', () => new ImportModal(this.app, this.plugin, this).open());
		const exportB = rightGrp.createEl('button', { text: t('toolExport') });
		exportB.addEventListener('click', () => this.exportMappings());

		this.addFormEl = container.createEl('div', { cls: 'ai-addform is-hidden' });
		const r1 = this.addFormEl.createEl('div', { cls: 'ai-frow' });
		r1.createEl('label', { text: t('realName') });
		this.addRealEl = r1.createEl('input', { type: 'text', placeholder: t('realPlaceholder') });
		this.addRealEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.addCatEl.focus();
			}
		});
		const rCat = this.addFormEl.createEl('div', { cls: 'ai-frow' });
		rCat.createEl('label', { text: t('addCat') });
		this.addCatEl = rCat.createEl('select', { cls: 'ai-cat-sel' });
		this.fillCatSelect(this.addCatEl, false, this.plugin.settings.categories[0]?.id ?? '');
		this.addCatEl.addEventListener('change', () => this.updateAutoPreview());
		const rCode = this.addFormEl.createEl('div', { cls: 'ai-frow' });
		rCode.createEl('label', { text: t('codeName') });
		this.addCodeEl = rCode.createEl('input', { type: 'text', placeholder: t('codePlaceholderAuto') });
		this.addCodeEl.addEventListener('input', () => { this.codeTouched = true; this.updateAutoPreview(); });
		this.addCodeEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.saveInlineAdd();
			}
		});
		const rAct = this.addFormEl.createEl('div', { cls: 'ai-frow ai-frow-act' });
		rAct.createEl('button', { text: t('addSave'), cls: 'mod-cta' }).addEventListener('click', () => this.saveInlineAdd());
		rAct.createEl('button', { text: t('cancel') }).addEventListener('click', () => this.toggleAddForm(true));
		this.addHintEl = this.addFormEl.createEl('div', { cls: 'ai-hint' });

		this.tableEl = container.createEl('div', { cls: 'ai-table' });
		this.pagerEl = container.createEl('div', { cls: 'ai-pager' });

		container.createEl('div', { cls: 'ai-note', text: t('crudNote') });

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

	renderCategoryBadges(): void {
		if (!this.catBarEl) return;
		const t = (k: string): string => this.plugin.t(k);
		this.catBarEl.empty();
		const badges = this.catBarEl.createEl('div', { cls: 'ai-cat-badges' });
		for (const c of this.plugin.settings.categories) {
			const b = badges.createEl('button', { type: 'button', cls: 'ai-cat-badge ' + this.pillClass(c) });
			b.setAttribute('aria-label', t('catEditTitle') + ': ' + c.name);
			b.createSpan({ text: c.name });
			b.createSpan({ text: ' ' + c.prefix, cls: 'ai-cat-badge-prefix' });
			b.addEventListener('click', () => new CategoryModal(this.app, this.plugin, this, 'edit', c).open());
		}
		const addBtn = this.catBarEl.createEl('button', { text: t('custom'), cls: 'ai-cat-add' });
		addBtn.addEventListener('click', () => new CategoryModal(this.app, this.plugin, this, 'add').open());
	}

	deleteCategory(c: Category): void {
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
		this.renderCategoryBadges();
		this.refreshFilterOptions();
		this.renderTable();
	}

	refreshFilterOptions(): void {
		if (this.filterSel) {
			const cur = this.filterSel.value;
			this.fillCatSelect(this.filterSel, false, cur, true);
		}
		// Keep the inline "add mapping" category dropdown in sync with
		// the live categories (otherwise newly added categories are missing).
		if (this.addCatEl) {
			const cur = this.addCatEl.value;
			this.fillCatSelect(this.addCatEl, false, cur);
		}
	}

	// ---------- mapping table ----------

	private toggleAddForm(forceClose = false): void {
		this.addOpen = forceClose ? false : !this.addOpen;
		this.addFormEl.toggleClass('is-hidden', !this.addOpen);
		this.addHintEl.setText('');
		this.codeTouched = false;
		if (this.addOpen) {
			this.addRealEl.focus();
			this.addCodeEl.value = '';
			this.updateAutoPreview();
		} else {
			this.addRealEl.value = '';
			this.addCodeEl.value = '';
			this.addCatEl.value = this.plugin.settings.categories[0]?.id ?? '';
			this.updateAutoPreview();
		}
	}

	private updateAutoPreview(): void {
		const t = (k: string): string => this.plugin.t(k);
		const cat = this.plugin.categoryById(this.addCatEl.value);
		const codeVal = this.addCodeEl.value.trim();
		if (cat && !this.codeTouched) {
			// Auto-fill the code field with the next generated code
			// (kept in sync with the selected category until the user edits it).
			const preview = cat.prefix + String(cat.seq + 1).padStart(3, '0');
			this.addCodeEl.value = preview;
			this.addHintEl.setText('');
		} else if (this.codeTouched) {
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

		const table = tableEl.createEl('table', { cls: 'ai-alias-tbl' });
		const thead = table.createEl('thead');
		const htr = thead.createEl('tr');
		const cbTh = htr.createEl('th', { cls: 'ai-col-cb' });
		const selAll = cbTh.createEl('input', { type: 'checkbox', cls: 'ai-cbx' });
		selAll.addEventListener('change', () => {
			const pageItems = list.slice(this.page * PAGE, this.page * PAGE + PAGE);
			if (selAll.checked) pageItems.forEach((m) => this.selected.add(m.i));
			else pageItems.forEach((m) => this.selected.delete(m.i));
			this.renderTable();
		});
		htr.createEl('th', { text: t('thReal') });
		htr.createEl('th', { text: t('thCode'), cls: 'ai-col-code' });
		htr.createEl('th', { text: t('thCat'), cls: 'ai-col-cat' });
		htr.createEl('th', { text: t('actions'), cls: 'ai-col-act' });

		const tbody = table.createEl('tbody');
		if (this.plugin.settings.mappings.length === 0) {
			const tr = tbody.createEl('tr');
			const td = tr.createEl('td', { text: t('empty') });
			td.setAttribute('colspan', '5');
			td.addClass('ai-empty');
			this.renderPager(this.plugin.settings.mappings.length, pages);
			return;
		}
		const start = this.page * PAGE;
		const items = list.slice(start, start + PAGE);
		if (items.length === 0) {
			const tr = tbody.createEl('tr');
			const td = tr.createEl('td', { text: t('filteredEmpty') });
			td.setAttribute('colspan', '5');
			td.addClass('ai-empty');
			this.renderPager(this.plugin.settings.mappings.length, pages);
			return;
		}
		for (const m of items) {
			const tr = tbody.createEl('tr');
			if (this.selected.has(m.i)) tr.addClass('ai-sel');
			const tdCb = tr.createEl('td', { cls: 'ai-col-cb' });
			const cb = tdCb.createEl('input', { type: 'checkbox', cls: 'ai-cbx' });
			cb.checked = this.selected.has(m.i);
			cb.addEventListener('change', (e) => {
				const checked = (e.target as HTMLInputElement).checked;
				if (checked) this.selected.add(m.i);
				else this.selected.delete(m.i);
				tr.toggleClass('ai-sel', checked);
			});
			if (this.editing === m.i) {
				const tdReal = tr.createEl('td', { cls: 'ai-col-real' });
				const inR = tdReal.createEl('input', { type: 'text', cls: 'ai-mreal-edit', value: m.real });
				const tdCode = tr.createEl('td', { cls: 'ai-col-code' });
				const fullCodeE = this.plugin.wrap(m.code);
				tdCode.createEl('code', { text: fullCodeE, cls: 'ai-mcode', title: fullCodeE });
				const tdCat = tr.createEl('td', { cls: 'ai-col-cat' });
				const sel = tdCat.createEl('select', { cls: 'ai-cat-sel' });
				this.fillCatSelect(sel, false, m.category || '');
				const tdAct = tr.createEl('td', { cls: 'ai-col-act' });
				const saveBtn = tdAct.createEl('button', { cls: 'ai-act ai-act-edit', text: t('addSave') });
				saveBtn.addEventListener('click', () => this.saveEdit(m.i, inR.value, sel.value));
				const cancelBtn = tdAct.createEl('button', { cls: 'ai-act ai-act-cancel', text: t('cancel') });
				cancelBtn.addEventListener('click', () => {
					this.editing = null;
					this.renderTable();
				});
			} else {
				const tdReal = tr.createEl('td', { cls: 'ai-col-real', text: m.real });
				tdReal.setAttribute('title', m.real);
				const tdCode = tr.createEl('td', { cls: 'ai-col-code' });
				const fullCode = this.plugin.wrap(m.code);
				tdCode.createEl('code', { text: fullCode, cls: 'ai-mcode', title: fullCode });
				const tdCat = tr.createEl('td', { cls: 'ai-col-cat' });
				const cat = this.plugin.categoryById(m.category);
				tdCat.createEl('span', {
					text: cat ? cat.name : '—',
					cls: 'ai-pill ' + this.pillClass(cat)
				});
				const tdAct = tr.createEl('td', { cls: 'ai-col-act' });
				const editBtn = tdAct.createEl('button', { cls: 'ai-act ai-act-edit', text: t('edit') });
				editBtn.addEventListener('click', () => {
					this.editing = m.i;
					this.selected.clear();
					this.renderTable();
				});
				const delBtn = tdAct.createEl('button', { cls: 'ai-act ai-act-del', text: t('del') });
				delBtn.addEventListener('click', () => this.deleteOne(m.i));
			}
		}
		selAll.checked = items.length > 0 && items.every((m) => this.selected.has(m.i));
		this.renderPager(this.plugin.settings.mappings.length, pages);
	}

	private pillClass(cat: { id?: string; prefix?: string; key?: string } | null | undefined): string {
		if (!cat) return 'ai-pill-gray';
		// Preset semantic categories keep their fixed prototype colours.
		if (cat.key) {
			const prefix = (cat.prefix || '').toUpperCase();
			if (prefix.includes('PLATFORM')) return 'ai-pill-blue';
			if (prefix.includes('RESOURCE')) return 'ai-pill-green';
			if (prefix.includes('PERSON')) return 'ai-pill-orange';
			if (prefix.includes('PLACE')) return 'ai-pill-pink';
			if (prefix.includes('DEPT') || prefix.includes('LEVEL') || prefix.includes('DEPARTMENT')) return 'ai-pill-purple';
			return 'ai-pill-gray';
		}
		// Custom categories: assign from a 20-colour palette by creation order,
		// each distinct within 20, then cycling through the same palette.
		const customs = this.plugin.settings.categories.filter((c) => !c.key);
		let idx = customs.findIndex((c) => c.id === cat.id);
		if (idx < 0) idx = customs.length;
		return 'ai-pill-c' + (idx % 20);
	}

	private sortIndicator(key: 'real' | 'code'): string {
		if (this.sortKey !== key) return '';
		return this.sortDir > 0 ? ' ▲' : ' ▼';
	}

	private renderPager(total: number, pages: number): void {
		const t = (k: string): string => this.plugin.t(k);
		this.pagerEl.empty();
		this.pagerEl.createEl('span', { cls: 'ai-pager-text', text: `共 ${total} 条 · 第 ${this.page + 1} / ${pages} 页` });
		const prev = this.pagerEl.createEl('button', { text: '‹' });
		prev.disabled = this.page <= 0;
		prev.addEventListener('click', () => {
			if (this.page > 0) {
				this.page--;
				this.renderTable();
			}
		});
		const next = this.pagerEl.createEl('button', { text: '›' });
		next.disabled = this.page >= pages - 1;
		next.addEventListener('click', () => {
			if (this.page < pages - 1) {
				this.page++;
				this.renderTable();
			}
		});
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
		const codeVal = this.addCodeEl.value.trim().toUpperCase();
		if (!real) {
			this.hint(t('errEmpty'));
			return;
		}
		if (codeVal) {
			if (!isValidCode(codeVal)) {
				this.hint(t('errChars'));
				return;
			}
			if (this.plugin.settings.mappings.some((m) => m.code === codeVal)) {
				this.hint(t('errDup'));
				return;
			}
			this.plugin.settings.mappings.push({ real, code: codeVal, category: this.normCat(catId), manual: this.codeTouched });
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
		new Notice(this.plugin.t('added') + this.plugin.wrap(code));
		this.addRealEl.value = '';
		this.addCodeEl.value = '';
		this.addCatEl.value = this.plugin.settings.categories[0]?.id ?? '';
		this.codeTouched = false;
		this.updateAutoPreview();
		this.renderTable();
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

		// ---- v1.8.0: paste auto-unmask ----
		this.registerEvent(
			this.app.workspace.on('editor-paste', (evt, editor) => this.onEditorPaste(evt, editor))
		);
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
			id: 'open-mappings',
			name: this.t('cmdOpenMappings'),
			callback: () => new MappingTableModal(this.app, this).open()
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
		const cfg = this.app.vault.configDir;
		return !p.startsWith(cfg + '/') && !p.startsWith('.trash/');
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
		if (singleFile && items[0] instanceof TFile && !this.isBatchTarget(items[0])) return;
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
			// bare codes: default unchecked ("confirm each") unless "restore all" is selected
			const barePolicy = this.settings.batchBareCodePolicy;
			scan.bareChecks = scan.bareHits.map(() => barePolicy === 'restoreAll');
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

	// v1.8.0: paste auto-unmask — restores real names in pasted text when the
	// toggle is on. We take over the paste only when the clipboard actually
	// contains wrapped aliases, so normal pastes are untouched.
	private onEditorPaste(evt: ClipboardEvent, editor: Editor): void {
		if (!this.settings.pasteUnmask) return;
		if (evt.defaultPrevented) return;
		if (this.settings.mappings.length === 0) return;
		const data = evt.clipboardData ? evt.clipboardData.getData('text/plain') : '';
		if (!data) return;
		const out = this.decrypt(data);
		if (out === data) return;
		evt.preventDefault();
		editor.replaceSelection(out);
		new Notice(this.t('pasteUnmasked'));
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
		if (this.settings.batchBareCodePolicy !== 'skip' && this.settings.batchBareCodePolicy !== 'restoreAll') {
			this.settings.batchBareCodePolicy = 'confirmAll';
		}
		this.settings.pasteUnmask = this.settings.pasteUnmask === true;
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
