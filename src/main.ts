import { Notice, Plugin } from 'obsidian';

export default class HelloPlugin extends Plugin {
	async onload() {
		new Notice('Hello World!');
	}

	onunload() {}
}