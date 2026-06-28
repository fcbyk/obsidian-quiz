import { Plugin, WorkspaceLeaf, TextFileView, MarkdownRenderer } from 'obsidian';

const VIEW_TYPE_QUIZ = 'quiz-view';

interface SelectOption {
	index: number;
	label: string;
	text: string;
	selected: boolean;
	lineNumber: number;
}

interface SelectBlock {
	number: number;
	question: string;
	options: SelectOption[];
	max: number; // 1 = 单选, N = 最多选 N 项, -1 = 不限 (all)
	headingLevel: number; // 0 = 无#号默认, 1~6 = heading级别
}

interface TrueFalseItem {
	number: number;
	question: string;
	userAnswer: boolean | null; // true = 选了正确, false = 选了错误, null = 未作答
	lineNumber: number;
	headingLevel: number; // 0 = 无#号默认, 1~6 = heading级别
}

interface TrueFalseBlock {
	items: TrueFalseItem[];
}

function parseSelectBlock(lines: string[], max: number): SelectBlock | null {
	let number = 0;
	let question = '';
	let headingLevel = 0;
	const options: SelectOption[] = [];
	let optionIndex = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const trimmed = line.trimStart();

		if (trimmed.startsWith('#') || trimmed.startsWith('Q')) {
			// 尝试匹配带 # 号的标题格式: #### Q1: text
			const headingMatch = trimmed.match(/^(#{1,6})\s+Q(\d+):\s*(.*)/);
			if (headingMatch) {
				headingLevel = (headingMatch[1] ?? '').length;
				number = parseInt(headingMatch[2] ?? '0', 10);
				question = (headingMatch[3] ?? '').trim();
			} else {
				// 兜底匹配无 # 号的普通格式: Q1: text
				const match = trimmed.match(/^Q(\d+):\s*(.*)/);
				if (match) {
					number = parseInt(match[1] ?? '0', 10);
					question = (match[2] ?? '').trim();
				}
			}
		} else if (trimmed.startsWith('[')) {
			const match = trimmed.match(/^\[([A-Z])(#?)\]\s*(.*)/);
			if (match) {
				const label = match[1] ?? '';
				const selected = match[2] === '#';
				const optionText = (match[3] ?? '').trim();
				options.push({
					index: optionIndex++,
					label,
					text: optionText,
					selected,
					lineNumber: i,
				});
			}
		}
	}

	if (!question && options.length === 0) return null;
	return { number, question, options, max, headingLevel };
}

function parseTrueFalseBlock(lines: string[]): TrueFalseBlock | null {
	const items: TrueFalseItem[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const trimmed = line.trimStart();

		// 匹配带 # 号的标题格式 或 普通格式
		// #### Q1: question text [T]  或  Q1: question text [T]
		let match = trimmed.match(/^(#{1,6})\s+Q(\d+):\s*(.*?)\s*(?:\[([TF])\])?\s*$/);
		let headingLevel = 0;

		if (!match) {
			match = trimmed.match(/^Q(\d+):\s*(.*?)\s*(?:\[([TF])\])?\s*$/);
		} else {
			headingLevel = (match[1] ?? '').length;
		}

		if (match) {
			// 括号索引需要根据是否匹配了 # 组而偏移
			const numIdx = headingLevel > 0 ? 2 : 1;
			const textIdx = headingLevel > 0 ? 3 : 2;
			const markIdx = headingLevel > 0 ? 4 : 3;

			const number = parseInt(match[numIdx] ?? '0', 10);
			const question = (match[textIdx] ?? '').trim();
			const userMark = match[markIdx] ?? null;
			const userAnswer = userMark === 'T' ? true : userMark === 'F' ? false : null;

			items.push({
				number,
				question,
				userAnswer,
				lineNumber: i,
				headingLevel,
			});
		}
	}

	if (items.length === 0) return null;
	return { items };
}

function parseBlockParams(
	paramsStr: string,
): { max: number } {
	const maxMatch = paramsStr.match(/max=(\w+)/);
	if (!maxMatch) return { max: 1 };

	const val = maxMatch[1] ?? '1';
	if (val === 'all') return { max: -1 };

	const num = parseInt(val, 10);
	return { max: Number.isNaN(num) || num < 1 ? 1 : num };
}

class QuizView extends TextFileView {
	private isSourceMode = false;
	private sourceActionEl?: HTMLElement;

	private toggleSourceMode(): void {
		this.isSourceMode = !this.isSourceMode;
		if (this.sourceActionEl) {
			// Try to update the icon element inside the action
			const iconEl = this.sourceActionEl.querySelector('.clickable-icon');
			if (iconEl) {
				iconEl.setAttribute(
					'aria-label',
					this.isSourceMode ? '切换为测验模式' : '切换源码模式',
				);
			}
		}
		this.render();
	}

	getViewType(): string {
		return VIEW_TYPE_QUIZ;
	}

	getDisplayText(): string {
		return this.file?.basename ?? 'Quiz';
	}

	getViewData(): string {
		return this.data;
	}

	setViewData(data: string, _clear: boolean): void {
		this.data = data;
		this.render();
	}

	clear(): void {
		this.data = '';
		this.contentEl.empty();
	}

	async onOpen(): Promise<void> {
		this.sourceActionEl = this.addAction(
			'file-code',
			'切换源码模式',
			() => this.toggleSourceMode(),
		);
	}

	private async render(): Promise<void> {
		const container = this.contentEl;
		container.empty();

		if (this.isSourceMode) {
			this.renderSourceMode(container);
			return;
		}

		container.addClass('quiz-view-container');

		const lines = this.data.split('\n');
		let i = 0;
		const mdBuffer: string[] = [];

		const flushBuffer = async () => {
			if (mdBuffer.length > 0) {
				const mdText = mdBuffer.join('\n');
				mdBuffer.length = 0;
				const mdDiv = container.createDiv({ cls: 'quiz-md-content' });
				await MarkdownRenderer.renderMarkdown(
					mdText,
					mdDiv,
					this.file?.path ?? '',
					this,
				);
			}
		};

		while (i < lines.length) {
			const line = lines[i] ?? '';
			const trimmed = line.trim();

			const selectMatch = trimmed.match(/^:::select(?:\{([^}]*)\})?$/);
			if (selectMatch) {
				await flushBuffer();
				const params = parseBlockParams(selectMatch[1] ?? '');

				const blockLines: string[] = [];
				let blockEnd = -1;

				for (let j = i + 1; j < lines.length; j++) {
					const inner = lines[j] ?? '';
					if (inner.trim() === ':::') {
						blockEnd = j;
						break;
					}
					blockLines.push(inner);
				}

				if (blockEnd >= 0) {
					const block = parseSelectBlock(blockLines, params.max);
					if (block) {
						this.renderSelectBlock(container, block, i);
					}
					i = blockEnd + 1;
					continue;
				}
			}

			const tfMatch = trimmed.match(/^:::true-false$/);
			if (tfMatch) {
				await flushBuffer();

				const blockLines: string[] = [];
				let blockEnd = -1;

				for (let j = i + 1; j < lines.length; j++) {
					const inner = lines[j] ?? '';
					if (inner.trim() === ':::') {
						blockEnd = j;
						break;
					}
					blockLines.push(inner);
				}

				if (blockEnd >= 0) {
					const block = parseTrueFalseBlock(blockLines);
					if (block) {
						this.renderTrueFalseBlock(container, block, i);
					}
					i = blockEnd + 1;
					continue;
				}
			}

			mdBuffer.push(line);
			i++;
		}

		await flushBuffer();
	}

	private renderSourceMode(container: HTMLElement): void {
		container.addClass('quiz-source-container');
		const textarea = container.createEl('textarea');
		textarea.addClass('quiz-source-textarea');
		textarea.value = this.data;
		textarea.addEventListener('input', () => {
			this.data = textarea.value;
			this.requestSave();
		});
	}

	private renderSelectBlock(
		container: HTMLElement,
		block: SelectBlock,
		startLine: number,
	): void {
		const blockEl = container.createDiv({ cls: 'quiz-select-container' });

		if (block.question) {
			const qEl = blockEl.createDiv({ cls: 'quiz-select-question' });

			if (block.number > 0) {
				const numEl = qEl.createSpan({ cls: 'quiz-select-number' });
				numEl.setText(String(block.number));
			}

			const textCls = ['quiz-select-question-text'];
			if (block.headingLevel > 0) {
				textCls.push(`quiz-q-heading-${block.headingLevel}`);
			}
			const textEl = qEl.createSpan({ cls: textCls.join(' ') });
			textEl.setText(block.question);
		}

		const optsContainer = blockEl.createDiv({ cls: 'quiz-select-options' });

		for (const option of block.options) {
			const row = optsContainer.createDiv({ cls: 'quiz-select-option' });
			if (option.selected) {
				row.addClass('quiz-option-selected');
			}

			const indicator = row.createSpan({ cls: 'quiz-select-indicator' });
			indicator.setText(option.label + '.');

			const label = row.createSpan({ cls: 'quiz-select-label' });
			label.setText(option.text);

			row.addEventListener('click', () => {
				this.handleOptionClick(block, option, startLine);
			});

			optsContainer.appendChild(row);
		}
	}

	private renderTrueFalseBlock(
		container: HTMLElement,
		block: TrueFalseBlock,
		startLine: number,
	): void {
		const blockEl = container.createDiv({ cls: 'quiz-tf-container' });

		for (const item of block.items) {
			const row = blockEl.createDiv({ cls: 'quiz-tf-item' });

			// 题号 + 题干
			const qEl = row.createDiv({ cls: 'quiz-tf-question' });

			if (item.number > 0) {
				const numEl = qEl.createSpan({ cls: 'quiz-tf-number' });
				numEl.setText(String(item.number));
			}

			const textCls = ['quiz-tf-question-text'];
			if (item.headingLevel > 0) {
				textCls.push(`quiz-q-heading-${item.headingLevel}`);
			}
			const textEl = qEl.createSpan({ cls: textCls.join(' ') });
			textEl.setText(item.question);

			// 按钮组
			const btnGroup = row.createDiv({ cls: 'quiz-tf-buttons' });

			const falseBtn = btnGroup.createDiv({ cls: 'quiz-tf-btn' });
			falseBtn.setText('错误');
			if (item.userAnswer === false) {
				falseBtn.addClass('quiz-tf-btn-selected');
			}
			falseBtn.addEventListener('click', () => {
				this.handleTrueFalseClick(item, false, startLine);
			});

			const trueBtn = btnGroup.createDiv({ cls: 'quiz-tf-btn' });
			trueBtn.setText('正确');
			if (item.userAnswer === true) {
				trueBtn.addClass('quiz-tf-btn-selected');
			}
			trueBtn.addEventListener('click', () => {
				this.handleTrueFalseClick(item, true, startLine);
			});

			btnGroup.appendChild(falseBtn);
			btnGroup.appendChild(trueBtn);
		}
	}

	private handleTrueFalseClick(
		item: TrueFalseItem,
		wantsTrue: boolean,
		startLine: number,
	): void {
		// 已选中同一项 → 无反应（单选逻辑）
		if (item.userAnswer === wantsTrue) return;

		const lines = this.data.split('\n');
		const absLine = startLine + 1 + item.lineNumber;
		const line = lines[absLine];
		if (line === undefined) return;

		const userMark = wantsTrue ? '[T]' : '[F]';

		if (item.userAnswer === null) {
			// 从未作答 → 追加 [T]/[F]
			lines[absLine] = line.replace(/\s*$/, ' ' + userMark);
		} else {
			// 切换答案 → 替换已有标记
			lines[absLine] = line.replace(/\[[TF]\]/, userMark);
		}

		this.data = lines.join('\n');
		this.requestSave();
		this.render();
	}

	private handleOptionClick(
		block: SelectBlock,
		clickedOption: SelectOption,
		startLine: number,
	): void {
		const lines = this.data.split('\n');

		const toggleOption = (
			absLine: number,
			opt: SelectOption,
			select: boolean,
		) => {
			const line = lines[absLine];
			if (line === undefined) return;
			if (select) {
				lines[absLine] = line.replace(
					new RegExp(`(\\[)${opt.label}(\\])`),
					`$1${opt.label}#$2`,
				);
			} else {
				lines[absLine] = line.replace(
					new RegExp(`(\\[)${opt.label}#(\\])`),
					`$1${opt.label}$2`,
				);
			}
		};

		if (block.max === 1) {
			// 单选模式: 选中项不可反选，点新项先清旧项再选新项
			if (clickedOption.selected) return;

			for (const opt of block.options) {
				if (opt.selected) {
					toggleOption(startLine + 1 + opt.lineNumber, opt, false);
				}
			}

			toggleOption(
				startLine + 1 + clickedOption.lineNumber,
				clickedOption,
				true,
			);
		} else {
			// 多选模式: 可反选，有上限
			if (clickedOption.selected) {
				toggleOption(
					startLine + 1 + clickedOption.lineNumber,
					clickedOption,
					false,
				);
			} else {
				const selectedCount = block.options.filter(
					(o) => o.selected,
				).length;

				if (block.max === -1 || selectedCount < block.max) {
					toggleOption(
						startLine + 1 + clickedOption.lineNumber,
						clickedOption,
						true,
					);
				} else {
					return; // 已达上限，忽略点击
				}
			}
		}

		this.data = lines.join('\n');
		this.requestSave();
		this.render();
	}
}

export default class QuizPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerExtensions(['mdq'], VIEW_TYPE_QUIZ);
		this.registerView(VIEW_TYPE_QUIZ, (leaf: WorkspaceLeaf) => new QuizView(leaf));
	}

	onunload(): void {}
}