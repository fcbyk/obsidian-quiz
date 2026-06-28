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
}

function parseSelectBlock(lines: string[]): SelectBlock | null {
	let number = 0;
	let question = '';
	const options: SelectOption[] = [];
	let optionIndex = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const trimmed = line.trimStart();

		if (trimmed.startsWith('Q')) {
			const match = trimmed.match(/^Q(\d+):\s*(.*)/);
			if (match) {
				number = parseInt(match[1] ?? '0', 10);
				question = (match[2] ?? '').trim();
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
	return { number, question, options };
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

			if (line.trim() === '::select') {
				await flushBuffer();
				const blockLines: string[] = [];
				let blockEnd = -1;

				for (let j = i + 1; j < lines.length; j++) {
					const inner = lines[j] ?? '';
					if (inner.trim() === '::') {
						blockEnd = j;
						break;
					}
					blockLines.push(inner);
				}

				if (blockEnd >= 0) {
					const block = parseSelectBlock(blockLines);
					if (block) {
						this.renderSelectBlock(container, block, i);
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

			const textEl = qEl.createSpan({ cls: 'quiz-select-question-text' });
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

	private handleOptionClick(
		block: SelectBlock,
		clickedOption: SelectOption,
		startLine: number,
	): void {
		if (clickedOption.selected) return;

		const lines = this.data.split('\n');

		for (const opt of block.options) {
			if (opt.selected) {
				const absLine = startLine + 1 + opt.lineNumber;
				const line = lines[absLine];
				if (line !== undefined) {
					lines[absLine] = line.replace(
						new RegExp(`(\\[)${opt.label}#(\\])`),
						`$1${opt.label}$2`,
					);
				}
			}
		}

		const clickedAbsLine = startLine + 1 + clickedOption.lineNumber;
		const clickedLine = lines[clickedAbsLine];
		if (clickedLine !== undefined) {
			lines[clickedAbsLine] = clickedLine.replace(
				new RegExp(`(\\[)${clickedOption.label}(\\])`),
				`$1${clickedOption.label}#$2`,
			);
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