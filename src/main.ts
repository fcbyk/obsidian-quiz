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

		container.style.cssText =
			'padding:16px;max-width:800px;margin:0 auto;';

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
		container.style.cssText =
			'padding:16px;max-width:800px;margin:0 auto;height:100%;';
		const textarea = container.createEl('textarea');
		textarea.style.cssText =
			'width:100%;height:100%;min-height:500px;' +
			'font-family:var(--font-monospace);font-size:14px;' +
			'line-height:1.6;padding:0;' +
			'border:none;outline:none;' +
			'background:transparent;' +
			'color:var(--text-normal);resize:none;box-sizing:border-box;';
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
				'font-weight:600;font-size:1.2em;color:var(--text-normal);line-height:1.6;';
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

		// inject custom markdown styles for quiz view content
		const styleEl = document.createElement('style');
		styleEl.setAttribute('data-quiz-styles', '');
		styleEl.textContent = `
.quiz-md-content { line-height: 1.6; color: var(--text-normal); }
.quiz-md-content p { margin: 0.5em 0; }
.quiz-md-content h1 { font-size: 1.6em; font-weight: 700; margin: 0.8em 0 0.4em; }
.quiz-md-content h2 { font-size: 1.4em; font-weight: 700; margin: 0.7em 0 0.3em; }
.quiz-md-content h3 { font-size: 1.2em; font-weight: 600; margin: 0.6em 0 0.3em; }
.quiz-md-content h4 { font-size: 1.1em; font-weight: 600; margin: 0.5em 0 0.2em; }
.quiz-md-content h5 { font-size: 1em; font-weight: 600; margin: 0.4em 0 0.2em; }
.quiz-md-content h6 { font-size: 0.9em; font-weight: 600; color: var(--text-muted); margin: 0.3em 0 0.2em; }
.quiz-md-content blockquote {
	border-left: 3px solid var(--text-accent);
	padding: 0.3em 1em;
	margin: 0.6em 0;
	color: var(--text-muted);
	background: var(--background-secondary);
	border-radius: 0 4px 4px 0;
}
.quiz-md-content blockquote p { margin: 0.2em 0; }
.quiz-md-content ul, .quiz-md-content ol { padding-left: 1.5em; margin: 0.4em 0; }
.quiz-md-content li { margin: 0.15em 0; }
.quiz-md-content strong { font-weight: 700; color: var(--text-normal); }
.quiz-md-content em { font-style: italic; }
.quiz-md-content del { text-decoration: line-through; color: var(--text-muted); }
.quiz-md-content a { color: var(--text-accent); text-decoration: none; }
.quiz-md-content a:hover { text-decoration: underline; }
.quiz-md-content code {
	font-family: var(--font-monospace);
	background: var(--background-primary-alt);
	padding: 0.1em 0.3em;
	border-radius: 3px;
	font-size: 0.9em;
}
.quiz-md-content pre {
	background: var(--background-primary-alt);
	padding: 0.8em 1em;
	border-radius: 6px;
	overflow-x: auto;
	margin: 0.6em 0;
}
.quiz-md-content pre code { background: none; padding: 0; border-radius: 0; font-size: 0.85em; }
.quiz-md-content hr { border: none; border-top: 1px solid var(--background-modifier-border); margin: 1em 0; }
.quiz-md-content img { max-width: 100%; }
.quiz-md-content table { border-collapse: collapse; margin: 0.6em 0; width: 100%; }
.quiz-md-content th, .quiz-md-content td {
	border: 1px solid var(--background-modifier-border);
	padding: 0.4em 0.8em;
	text-align: left;
}
.quiz-md-content th { background: var(--background-secondary); font-weight: 600; }
`;
		document.head.appendChild(styleEl);

		this.register(() => styleEl.remove());
	}

	onunload(): void {}
}