import { Plugin, WorkspaceLeaf, TextFileView } from 'obsidian';

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

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.style.cssText =
			'padding:16px;max-width:800px;margin:0 auto;';

		const lines = this.data.split('\n');
		let i = 0;

		while (i < lines.length) {
			const line = lines[i] ?? '';

			if (line.trim() === '::select') {
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

			const textDiv = container.createDiv({ cls: 'quiz-plain-text' });
			textDiv.style.cssText =
				'white-space:pre-wrap;color:var(--text-normal);line-height:1.6;margin:2px 0;';
			textDiv.setText(line);
			i++;
		}
	}

	private renderSelectBlock(
		container: HTMLElement,
		block: SelectBlock,
		startLine: number,
	): void {
		const blockEl = container.createDiv({ cls: 'quiz-select-container' });
		blockEl.style.cssText = 'padding:8px 0;margin:4px 0;';

		if (block.question) {
			const qEl = blockEl.createDiv({ cls: 'quiz-select-question' });
			qEl.style.cssText =
				'display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;';

			if (block.number > 0) {
				const numEl = qEl.createSpan({ cls: 'quiz-select-number' });
				numEl.style.cssText =
					'display:inline-flex;align-items:center;justify-content:center;' +
					'width:26px;height:26px;border-radius:50%;' +
					'background:var(--text-accent);color:#fff;' +
					'font-size:13px;font-weight:700;flex-shrink:0;';
				numEl.setText(String(block.number));
			}

			const textEl = qEl.createSpan({ cls: 'quiz-select-question-text' });
			textEl.style.cssText =
				'font-weight:600;color:var(--text-normal);line-height:26px;';
			textEl.setText(block.question);
		}

		const optsContainer = blockEl.createDiv({ cls: 'quiz-select-options' });

		for (const option of block.options) {
			const row = optsContainer.createDiv({ cls: 'quiz-select-option' });
			row.style.cssText =
				'padding:6px 10px;margin:2px 0;border-radius:4px;cursor:pointer;display:flex;align-items:baseline;gap:8px;transition:background 0.15s;';

			const indicator = row.createSpan({ cls: 'quiz-select-indicator' });
			indicator.style.cssText =
				'font-weight:600;font-size:14px;min-width:24px;flex-shrink:0;';

			const label = row.createSpan({ cls: 'quiz-select-label' });
			label.style.cssText = 'color:var(--text-normal);';

			const applyStyle = (sel: boolean) => {
				indicator.setText(option.label + '.');
				if (sel) {
					row.style.backgroundColor = 'var(--background-modifier-hover)';
					indicator.style.color = 'var(--text-accent)';
					label.style.color = 'var(--text-accent)';
					label.style.fontWeight = '600';
				} else {
					row.style.backgroundColor = '';
					indicator.style.color = 'var(--text-muted)';
					label.style.color = 'var(--text-normal)';
					label.style.fontWeight = '';
				}
			};

			label.setText(option.text);
			applyStyle(option.selected);

			row.addEventListener('click', () => {
				this.handleOptionClick(block, option, startLine);
			});

			row.addEventListener('mouseenter', () => {
				if (!option.selected) {
					row.style.backgroundColor = 'var(--background-modifier-hover)';
				}
			});

			row.addEventListener('mouseleave', () => {
				if (!option.selected) {
					row.style.backgroundColor = '';
				}
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