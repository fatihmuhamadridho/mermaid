import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import plugin from "../plugin.json";

type PreviewFile = ReturnType<typeof acode.newEditorFile> | null;

type MermaidApi = {
	initialize: (options: {
		startOnLoad: boolean;
		securityLevel: string;
		theme: string;
	}) => void;
	render: (id: string, definition: string) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

type MermaidModule = {
	default: MermaidApi;
};

class MermaidPreviewPlugin {
	public baseUrl: string | undefined;

	private previewFile: PreviewFile = null;
	private previewContentEl: HTMLElement | null = null;
	private mermaid: MermaidApi | null = null;
	private activeMarkdownFile: any = null;
	private previewScale = 1;
	private readonly markdown = new MarkdownIt({
		html: false,
		linkify: true,
		breaks: true,
	});

	async init(
		$page: Acode.WCPage,
		cacheFile: Acode.FileSystem,
		cacheFileUrl: string,
	): Promise<void> {
		const mermaidModule = (await import("mermaid")) as unknown as MermaidModule;
		this.mermaid = mermaidModule.default;
		this.mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: "default",
		});

		editorManager.on("save-file", this.syncActiveMarkdown);
		editorManager.on("file-content-changed", this.syncActiveMarkdown);
		editorManager.on("switch-file", this.syncActiveMarkdown);
		this.syncActiveMarkdown();
	}

	async destroy() {
		editorManager.off("save-file", this.syncActiveMarkdown);
		editorManager.off("file-content-changed", this.syncActiveMarkdown);
		editorManager.off("switch-file", this.syncActiveMarkdown);
		this.detachRunHandler();
		await this.closePreview();
	}

	private syncActiveMarkdown = () => {
		const file = editorManager.activeFile;
		const name = file?.filename ?? file?.name ?? "";

		if (!file || !this.isMarkdownFile(name)) {
			this.detachRunHandler();
			return;
		}

		if (this.activeMarkdownFile !== file) {
			this.detachRunHandler();
			this.activeMarkdownFile = file;
			this.attachRunHandler(file);
		}
	};

	private attachRunHandler(file: any) {
		file.writeCanRun?.(() => true);
		file.on?.("run", this.handleRun);
	}

	private detachRunHandler() {
		if (!this.activeMarkdownFile) {
			return;
		}

		this.activeMarkdownFile.off?.("run", this.handleRun);
		this.activeMarkdownFile = null;
	}

	private handleRun = () => {
		void this.openPreviewFromActiveFile();
	};

	private async openPreviewFromActiveFile() {
		const activeFile = editorManager.activeFile;

		if (!activeFile) {
			acode.alert("Mermaid Preview", "Open a Markdown file first.");
			return;
		}

		const activeName = activeFile.filename ?? activeFile.name ?? "";
		if (!this.isMarkdownFile(activeName)) {
			acode.alert("Mermaid Preview", "This preview only works on .md files.");
			return;
		}

		const source = this.getMarkdownSource(activeFile);
		const html = this.buildPreviewHtml(activeName, source);

		if (!this.previewFile) {
			this.previewFile = acode.newEditorFile(`${activeName} · Mermaid`, {
				render: true,
				editable: false,
				type: "custom",
				tabIcon: "file file_type_markdown",
				hideQuickTools: true,
				content: this.createPreviewElement(html),
			}) as unknown as PreviewFile;
		} else {
			(this.previewFile as any).content = this.createPreviewElement(html);
			(this.previewFile as any).makeActive?.();
		}

		await this.renderMermaidBlocks();
	}

	private buildPreviewHtml(activeName: string, source: string) {
		if (!source.trim()) {
			return this.wrapPreviewHtml(
				`<div class="mermaid-empty">Markdown source is empty for ${this.escapeHtml(activeName)}.</div>`,
			);
		}

		return this.wrapPreviewHtml(this.renderMarkdown(source));
	}

	private wrapPreviewHtml(innerHtml: string) {
		return `
			<style>
				:root {
					--preview-bg: #0f172a;
					--preview-panel: #111827;
					--preview-text: #e5e7eb;
					--preview-muted: #cbd5e1;
					--preview-border: rgba(148, 163, 184, 0.42);
					--preview-code-bg: #0b1220;
					--diagram-card-bg: #fffde7;
					--diagram-card-border: rgba(148, 163, 184, 0.55);
				}
				.mermaid-preview-shell {
					padding: 16px;
					font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
					color: var(--preview-text);
					background: var(--preview-bg);
					min-height: 100%;
				}
				.mermaid-preview {
					max-width: 960px;
					margin: 0 auto;
					line-height: 1.7;
				}
				.mermaid-preview h1,
				.mermaid-preview h2,
				.mermaid-preview h3,
				.mermaid-preview h4,
				.mermaid-preview h5,
				.mermaid-preview h6 {
					color: var(--preview-text);
					margin: 22px 0 12px;
					line-height: 1.25;
				}
				.mermaid-preview p,
				.mermaid-preview li {
					color: var(--preview-muted);
				}
				.mermaid-preview p {
					margin: 0 0 14px;
				}
				.mermaid-preview ul,
				.mermaid-preview ol {
					padding-left: 24px;
					margin: 10px 0 16px;
				}
				.mermaid-preview ul {
					list-style: disc;
				}
				.mermaid-preview ul ul {
					list-style: circle;
				}
				.mermaid-preview ol {
					list-style: decimal;
				}
				.mermaid-preview li {
					margin: 8px 0;
				}
				.mermaid-preview li > p {
					margin: 0;
				}
				.mermaid-preview code:not(pre code) {
					font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
					background: rgba(148, 163, 184, 0.14);
					padding: 1px 6px;
					border-radius: 6px;
					color: #f8fafc;
				}
				.mermaid-preview pre {
					margin: 14px 0 20px;
					padding: 16px 18px;
					border-radius: 16px;
					border: 2px solid rgba(148, 163, 184, 0.5);
					background: linear-gradient(180deg, #111827 0%, #0b1220 100%);
					box-shadow:
						0 10px 24px rgba(2, 6, 23, 0.28),
						inset 0 1px 0 rgba(255, 255, 255, 0.04);
					overflow: auto;
				}
				.mermaid-preview pre code {
					display: block;
					color: #e5e7eb;
					white-space: pre;
					font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
					font-size: 13px;
					line-height: 1.65;
				}
				.mermaid-preview pre code.hljs {
					background: transparent;
					padding: 0;
				}
				.mermaid-preview .hljs {
					color: #e5e7eb;
				}
				.mermaid-preview .hljs-keyword,
				.mermaid-preview .hljs-literal,
				.mermaid-preview .hljs-title,
				.mermaid-preview .hljs-type,
				.mermaid-preview .hljs-attribute {
					color: #60a5fa;
				}
				.mermaid-preview .hljs-string,
				.mermaid-preview .hljs-regexp,
				.mermaid-preview .hljs-symbol,
				.mermaid-preview .hljs-bullet {
					color: #86efac;
				}
				.mermaid-preview .hljs-number,
				.mermaid-preview .hljs-built_in,
				.mermaid-preview .hljs-constant {
					color: #f59e0b;
				}
				.mermaid-preview .hljs-attr,
				.mermaid-preview .hljs-name {
					color: #93c5fd;
				}
				.mermaid-preview .hljs-punctuation,
				.mermaid-preview .hljs-operator {
					color: #cbd5e1;
				}
				.mermaid-preview .hljs-comment {
					color: #64748b;
				}
				.mermaid-preview table {
					width: 100%;
					border-collapse: collapse;
					margin: 14px 0 20px;
					border: 2px solid rgba(148, 163, 184, 0.6);
					background: #1b1f28;
					border-radius: 10px;
					overflow: hidden;
					box-shadow: 0 8px 18px rgba(2, 6, 23, 0.18);
				}
				.mermaid-preview th,
				.mermaid-preview td {
					border: 1.5px solid rgba(148, 163, 184, 0.34);
					padding: 10px 12px;
					vertical-align: top;
					color: var(--preview-text);
					background: #1f2430;
				}
				.mermaid-preview th {
					background: #2a2f3a;
					font-weight: 600;
					color: #f8fafc;
				}
				.mermaid-preview tbody tr:nth-child(2n) td {
					background: #212734;
				}
				.mermaid-preview tbody tr:hover td {
					background: #262c39;
				}
				.mermaid-block {
					padding: 0;
					border: 0;
					background: transparent;
				}
				.mermaid-card svg {
					display: block;
					max-width: none;
					height: auto;
				}
				.mermaid-card svg text,
				.mermaid-card svg tspan,
				.mermaid-card svg .label text,
				.mermaid-card svg .label tspan,
				.mermaid-card svg .nodeLabel,
				.mermaid-card svg .nodeLabel *,
				.mermaid-card svg .edgeLabel,
				.mermaid-card svg .edgeLabel *,
				.mermaid-card svg .messageText,
				.mermaid-card svg foreignObject,
				.mermaid-card svg foreignObject * {
					color: #111827 !important;
					fill: #111827 !important;
					stroke: none !important;
					opacity: 1 !important;
					font-size: 16px !important;
					font-weight: 700 !important;
					letter-spacing: 0 !important;
					text-rendering: geometricPrecision;
				}
				.mermaid-card svg rect.basic,
				.mermaid-card svg rect.labelBox,
				.mermaid-card svg .labelBox,
				.mermaid-card svg .node rect,
				.mermaid-card svg .node polygon,
				.mermaid-card svg .node circle,
				.mermaid-card svg .node ellipse {
					fill: #ffffff !important;
					stroke: #94a3b8 !important;
					stroke-width: 1.5px !important;
				}
				.mermaid-card svg .cluster rect,
				.mermaid-card svg .cluster polygon {
					fill: #fffde7 !important;
					stroke: #94a3b8 !important;
				}
				.mermaid-empty {
					opacity: 0.7;
					white-space: pre-wrap;
				}
				.mermaid-toolbar {
					display: flex;
					gap: 8px;
					align-items: center;
					justify-content: flex-end;
					margin: 0 0 12px;
				}
				.mermaid-toolbar button {
					border: 1px solid rgba(148, 163, 184, 0.22);
					background: rgba(15, 23, 42, 0.48);
					color: var(--preview-text);
					border-radius: 10px;
					padding: 6px 10px;
					font-size: 12px;
				}
				.mermaid-zoom-wrap {
					overflow: auto;
					cursor: grab;
				}
				.mermaid-zoom-wrap.is-panning {
					cursor: grabbing;
				}
				.mermaid-zoom-stage {
					transform-origin: top left;
					touch-action: pan-x pan-y pinch-zoom;
					transform: scale(var(--zoom-scale, 1));
				}
			</style>
			<div class="mermaid-preview">
				<div class="mermaid-toolbar">
					<button data-zoom-out type="button">-</button>
					<button data-zoom-reset type="button">100%</button>
					<button data-zoom-in type="button">+</button>
				</div>
				<div class="mermaid-zoom-wrap">
					<div class="mermaid-zoom-stage">${innerHtml}</div>
				</div>
			</div>
		`;
	}

	private createPreviewElement(html: string) {
		const wrapper = document.createElement("div");
		wrapper.className = "mermaid-preview-shell";
		wrapper.innerHTML = html;
		this.previewContentEl = wrapper.querySelector(".mermaid-preview") as HTMLElement | null;
		this.bindZoomControls(wrapper);
		return wrapper;
	}

	private bindZoomControls(wrapper: HTMLElement) {
		const zoomStage = wrapper.querySelector(".mermaid-zoom-stage") as HTMLElement | null;
		const zoomWrap = wrapper.querySelector(".mermaid-zoom-wrap") as HTMLElement | null;
		const zoomIn = wrapper.querySelector("[data-zoom-in]") as HTMLButtonElement | null;
		const zoomOut = wrapper.querySelector("[data-zoom-out]") as HTMLButtonElement | null;
		const zoomReset = wrapper.querySelector("[data-zoom-reset]") as HTMLButtonElement | null;
		if (!zoomStage || !zoomWrap) {
			return;
		}

		const applyScale = () => {
			zoomStage.style.setProperty("--zoom-scale", String(this.previewScale));
		};

		let pinchStartDistance = 0;
		let pinchStartScale = this.previewScale;
		let isPointerDown = false;
		let lastPointerX = 0;
		let lastPointerY = 0;
		const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

		zoomWrap.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length === 2) {
					pinchStartDistance = distance(event.touches[0], event.touches[1]);
					pinchStartScale = this.previewScale;
				}
			},
			{ passive: true },
		);

		zoomWrap.addEventListener(
			"touchmove",
			(event) => {
				if (event.touches.length !== 2 || !pinchStartDistance) {
					return;
				}

				event.preventDefault();
				const nextDistance = distance(event.touches[0], event.touches[1]);
				const nextScale = pinchStartScale * (nextDistance / pinchStartDistance);
				this.previewScale = Math.min(3, Math.max(0.35, nextScale));
				applyScale();
			},
			{ passive: false },
		);

		zoomWrap.addEventListener("touchend", () => {
			pinchStartDistance = 0;
		});

		zoomWrap.addEventListener("pointerdown", (event) => {
			if (this.previewScale <= 1) {
				return;
			}
			isPointerDown = true;
			lastPointerX = event.clientX;
			lastPointerY = event.clientY;
			zoomWrap.classList.add("is-panning");
		});

		zoomWrap.addEventListener("pointermove", (event) => {
			if (!isPointerDown || this.previewScale <= 1) {
				return;
			}
			const dx = event.clientX - lastPointerX;
			const dy = event.clientY - lastPointerY;
			zoomWrap.scrollLeft -= dx;
			zoomWrap.scrollTop -= dy;
			lastPointerX = event.clientX;
			lastPointerY = event.clientY;
		});

		const stopPan = () => {
			isPointerDown = false;
			zoomWrap.classList.remove("is-panning");
		};

		zoomWrap.addEventListener("pointerup", stopPan);
		zoomWrap.addEventListener("pointercancel", stopPan);
		zoomWrap.addEventListener("pointerleave", stopPan);

		zoomIn?.addEventListener("click", () => {
			this.previewScale = Math.min(2.5, this.previewScale + 0.1);
			applyScale();
		});
		zoomOut?.addEventListener("click", () => {
			this.previewScale = Math.max(0.5, this.previewScale - 0.1);
			applyScale();
		});
		zoomReset?.addEventListener("click", () => {
			this.previewScale = 1;
			applyScale();
		});

		applyScale();
	}

	private renderMarkdown(source: string) {
		const fence = this.markdown.renderer.rules.fence;
		const defaultCode = this.markdown.renderer.rules.code_block;

		this.markdown.renderer.rules.fence = (
			tokens: Parameters<NonNullable<typeof fence>>[0],
			idx: Parameters<NonNullable<typeof fence>>[1],
			options: Parameters<NonNullable<typeof fence>>[2],
			env: Parameters<NonNullable<typeof fence>>[3],
			self: Parameters<NonNullable<typeof fence>>[4],
		) => {
			const token = tokens[idx];
			const lang = (token.info || "").trim().toLowerCase();
			const content = token.content.trim();

			if (lang === "mermaid") {
				return `<pre class="mermaid-block"><div class="mermaid">${this.escapeHtml(content)}</div></pre>`;
			}

			const highlighted = this.highlightCode(content, lang);
			if (highlighted) {
				return highlighted;
			}

			if (fence) {
				return fence(tokens, idx, options, env, self);
			}

			return self.renderToken(tokens, idx, options);
		};

		const body = this.markdown.render(source);

		if (fence) {
			this.markdown.renderer.rules.fence = fence;
		} else {
			delete this.markdown.renderer.rules.fence;
		}
		if (defaultCode) {
			this.markdown.renderer.rules.code_block = defaultCode;
		}

		return body;
	}

	private highlightCode(code: string, language: string) {
		try {
			if (language && hljs.getLanguage(language)) {
				const result = hljs.highlight(code, { language, ignoreIllegals: true });
				return `<pre><code class="hljs language-${language}">${result.value}</code></pre>`;
			}

			const result = hljs.highlightAuto(code);
			return `<pre><code class="hljs">${result.value}</code></pre>`;
		} catch {
			return null;
		}
	}

	private async renderMermaidBlocks() {
		if (!this.mermaid || !this.previewContentEl) {
			return;
		}

		const blocks = Array.from(this.previewContentEl.querySelectorAll("div.mermaid"));
		for (let index = 0; index < blocks.length; index += 1) {
			const block = blocks[index] as HTMLElement;
			const definition = block.textContent ?? "";
			const id = `mermaid-${Date.now()}-${index}`;

			try {
				const result = await this.mermaid.render(id, definition);
				block.innerHTML = result.svg;
				const svg = block.querySelector("svg");
				if (svg) {
					svg.removeAttribute("width");
					svg.style.maxWidth = "none";
				}
				result.bindFunctions?.(block);
			} catch (error) {
				block.outerHTML = `<pre class="mermaid-empty">Mermaid render error:\n${this.escapeHtml(
					error instanceof Error ? error.message : String(error),
				)}</pre>`;
				console.error("Mermaid render failed:", error);
			}
		}
	}

	private isMarkdownFile(filename: string) {
		return /\.md$/i.test(filename);
	}

	private escapeHtml(value: string) {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	private getMarkdownSource(activeFile: any) {
		const editor = editorManager.editor as any;
		return (
			activeFile?.session?.getValue?.() ??
			activeFile?.session?.toString?.() ??
			editor?.state?.doc?.toString?.() ??
			editor?.getValue?.() ??
			activeFile?.text ??
			""
		);
	}

	private async closePreview() {
		if (!this.previewFile) {
			return;
		}

		await (this.previewFile as any).remove(true);
		this.previewFile = null;
		this.previewContentEl = null;
	}
}

if (window.acode) {
	const acodePlugin = new MermaidPreviewPlugin();
	acode.setPluginInit(
		plugin.id,
		async (
			baseUrl: string,
			$page: Acode.WCPage,
			{ cacheFileUrl, cacheFile }: Acode.PluginInitOptions,
		) => {
			if (!baseUrl.endsWith("/")) {
				baseUrl += "/";
			}
			acodePlugin.baseUrl = baseUrl;
			await acodePlugin.init($page, cacheFile, cacheFileUrl);
		},
	);
	acode.setPluginUnmount(plugin.id, () => {
		acodePlugin.destroy();
	});
}
