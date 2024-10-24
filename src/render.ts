import { App, Component, FrontMatterCache, MarkdownRenderer, MarkdownView, Notice, TFile } from "obsidian";
import { TConfig } from "./modal";
import { copyAttributes, fixAnchors, modifyDest } from "./utils";

export function getAllStyles() {
  const cssTexts: string[] = [];

  Array.from(document.styleSheets).forEach((sheet) => {
    // @ts-ignore
    const id = sheet.ownerNode?.id;

    // <style id="svelte-xxx" ignore
    if (id?.startsWith("svelte-")) {
      return;
    }
    // @ts-ignore
    const href = sheet.ownerNode?.href;

    const division = `/* ----------${id ? `id:${id}` : href ? `href:${href}` : ""}---------- */`;

    cssTexts.push(division);

    try {
      Array.from(sheet?.cssRules ?? []).forEach((rule) => {
        cssTexts.push(rule.cssText);
      });
    } catch (error) {
      console.error(error);
    }
  });

  cssTexts.push(...getPatchStyle());
  return cssTexts;
}

const CSS_PATCH = `
/* ---------- css patch ---------- */

body {
  overflow: auto !important;
}
@media print {
  .print .markdown-preview-view {
    height: auto !important;
  }
  .md-print-anchor, .blockid {
    white-space: pre !important;
    border-left: none !important;
    border-right: none !important;
    border-top: none !important;
    border-bottom: none !important;
    display: inline-block !important;
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    right: 0 !important;
    outline: 0 !important;
    background: 0 0 !important;
    text-decoration: initial !important;
    text-shadow: initial !important;
  }
}
@media print {
  table {
    break-inside: auto;
  }
  tr {
    break-inside: avoid;
    break-after: auto;
  }
  .pagedjs_page_break { 
  page-break-before: always;
    border-top: none!important; 
    background-image: none!important
}
}

/* Paged.js styles for page breaks */
.pagedjs_page_break { 
  page-break-before: always;
  height: 20px;
  width: 100%;
background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 20' width='100%25' height='20' preserveAspectRatio='none'%3E%3Cdefs%3E%3ClinearGradient id='wave-1729574810686' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='0' y2='20'%3E%3Cstop offset='100%25' stop-color='%23ff6c00'/%3E%3Cstop offset='100%25' stop-color='%23ffffff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M -98.46 14 L -49.23 11 0 11 L 49.23 6 98.46 7 L 147.69 4 196.92 7 L 246.15 11 295.38 17 L 344.62 6 393.85 14 L 443.08 11 492.31 18 L 541.54 14 590.77 18 L 640 8 689.23 13 L 738.46 14 787.69 16 L 836.92 2 886.15 6 L 935.38 13 984.62 16 L 1033.85 5 1083.08 6 L 1132.31 11 1181.54 15 L 1230.77 14 1280 15 L 1329.23 10 1378.46 11' fill='none' stroke='url(%23wave-1729574810686)' stroke-width='3'%3E%3C/path%3E%3C/svg%3E");
  }

`;

export function getPatchStyle() {
  return [CSS_PATCH, ...getPrintStyle()];
}

export function getPrintStyle() {
  const cssTexts: string[] = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      const cssRules = sheet?.cssRules ?? [];
      Array.from(cssRules).forEach((rule) => {
        if (rule.constructor.name == "CSSMediaRule") {
          if ((rule as CSSMediaRule).conditionText === "print") {
            const res = rule.cssText.replace(/@media print\s*\{(.+)\}/gms, "$1");
            cssTexts.push(res);
          }
        }
      });
    } catch (error) {
      console.error(error);
    }
  });
  return cssTexts;
}

function generateDocId(n: number) {
  return Array.from({ length: n }, () => ((16 * Math.random()) | 0).toString(16)).join("");
}

export type AyncFnType = (...args: unknown[]) => Promise<unknown>;

export function getFrontMatter(app: App, file: TFile) {
  const cache = app.metadataCache.getFileCache(file);
  return cache?.frontmatter ?? ({} as FrontMatterCache);
}

// 逆向原生打印函数
export async function renderMarkdown(
  app: App,
  file: TFile,
  config: TConfig,
  extra?: {
    title?: string;
    file: TFile;
    id?: string;
  },
) {
  const startTime = new Date().getTime();

  const ws = app.workspace;
  if (ws.getActiveFile()?.path != file.path) {
    const leaf = ws.getLeaf();
    await leaf.openFile(file);
  }
  const view = ws.getActiveViewOfType(MarkdownView) as MarkdownView;
  // @ts-ignore
  const data = view?.data ?? ws?.getActiveFileView()?.data ?? ws.activeEditor?.data;
  if (!data) {
    new Notice("data is empty!");
  }

  const frontMatter = getFrontMatter(app, file);

  const cssclasses = [];
  for (const [key, val] of Object.entries(frontMatter)) {
    if (key.toLowerCase() == "cssclass" || key.toLowerCase() == "cssclasses") {
      if (Array.isArray(val)) {
        cssclasses.push(...val);
      } else {
        cssclasses.push(val);
      }
    }
  }

  const comp = new Component();
  comp.load();

  const printEl = document.body.createDiv("print");
  const viewEl = printEl.createDiv({
    cls: "markdown-preview-view markdown-rendered " + cssclasses.join(" "),
  });
  // Add this line after creating the `viewEl`
  viewEl.classList.add("pagedjs_enabled");

  app.vault.cachedRead(file);

  // @ts-ignore
  viewEl.toggleClass("rtl", app.vault.getConfig("rightToLeft"));
  // @ts-ignore
  viewEl.toggleClass("show-properties", "hidden" !== app.vault.getConfig("propertiesInDocument"));

  const title = extra?.title ?? file.basename;
  viewEl.createEl("h1", { text: title }, (e) => {
    e.addClass("__title__");
    e.style.display = config.showTitle ? "block" : "none";
    e.id = extra?.id ?? "";
  });

  const cache = app.metadataCache.getFileCache(file);

  // const lines = data?.split("\n") ?? [];
  // Object.entries(cache?.blocks ?? {}).forEach(([key, c]) => {
  //   const idx = c.position.end.line;
  //   lines[idx] = `<span id="^${key}" class="blockid"></span>\n` + lines[idx];
  // });

  const blocks = new Map(Object.entries(cache?.blocks ?? {}));
  const lines = (data?.split("\n") ?? []).map((line, i) => {
    for (const {
      id,
      position: { start, end },
    } of blocks.values()) {
      const blockid = `^${id}`;
      if (line.includes(blockid) && i >= start.line && i <= end.line) {
        blocks.delete(id);
        return line.replace(blockid, `<span id="${blockid}" class="blockid"></span> ${blockid}`);
      }
    }
    return line;
  });

  [...blocks.values()].forEach(({ id, position: { start, end } }) => {
    const idx = start.line;
    lines[idx] = `<span id="^${id}" class="blockid"></span>\n\n` + lines[idx];
  });

  const fragment = {
    children: undefined,
    appendChild(e: DocumentFragment) {
      this.children = e?.children;
      throw new Error("exit");
    },
  } as unknown as HTMLElement;

  const promises: AyncFnType[] = [];
  try {
    // `render` converts Markdown to HTML, and then it undergoes postProcess handling.
    // Here, postProcess handling is not needed.When passed as a fragment, it converts to HTML correctly,
    // but errors occur during recent postProcess handling, thus achieving the goal of avoiding postProcess handling.
    await MarkdownRenderer.render(app, lines.join("\n"), fragment, file.path, comp);
  } catch (error) {
    /* empty */
  }

  const el = createFragment();
  Array.from(fragment.children).forEach((item) => {
    el.createDiv({}, (t) => {
      return t.appendChild(item);
    });
  });

  viewEl.appendChild(el);

  // @ts-ignore
  // (app: App: param: T) => T
  // MarkdownPostProcessorContext
  await MarkdownRenderer.postProcess(app, {
    docId: generateDocId(16),
    sourcePath: file.path,
    frontmatter: {},
    promises,
    addChild: function (e: Component) {
      return comp.addChild(e);
    },
    getSectionInfo: function () {
      return null;
    },
    containerEl: viewEl,
    el: viewEl,
    displayMode: true,
  });
  await Promise.all(promises);

  printEl.findAll("a.internal-link").forEach((el: HTMLAnchorElement) => {
    const [title, anchor] = el.dataset.href?.split("#") ?? [];

    if ((!title || title?.length == 0 || title == file.basename) && anchor?.startsWith("^")) {
      return;
    }

    el.removeAttribute("href");
  });
  try {
    await fixWaitRender(data, viewEl);
  } catch (error) {
    console.warn("wait timeout");
  }

  fixCanvasToImage(viewEl);

  const doc = document.implementation.createHTMLDocument("document");
  doc.body.appendChild(printEl.cloneNode(true));

  printEl.detach();
  comp.unload();
  printEl.remove();
  doc.title = title;
  console.log(`md render time:${new Date().getTime() - startTime}ms`);
  return { doc, frontMatter, file };
}

export function fixDoc(doc: Document, title: string) {
  const dest = modifyDest(doc);
  fixAnchors(doc, dest, title);
  encodeEmbeds(doc);
  return doc;
}

export function encodeEmbeds(doc: Document) {
  const spans = Array.from(doc.querySelectorAll("span.markdown-embed")).reverse();
  spans.forEach((span: HTMLElement) => (span.innerHTML = encodeURIComponent(span.innerHTML)));
}

export async function fixWaitRender(data: string, viewEl: HTMLElement) {
  if (data.includes("```dataview") || data.includes("```gEvent") || data.includes("![[")) {
    await sleep(2000);
  }
  try {
    await waitForDomChange(viewEl);
  } catch (error) {
    await sleep(1000);
  }
}

// TODO: base64 to canvas
// TODO: light render canvas
export function fixCanvasToImage(el: HTMLElement) {
  for (const canvas of Array.from(el.querySelectorAll("canvas"))) {
    const data = canvas.toDataURL();
    const img = document.createElement("img");
    img.src = data;
    copyAttributes(img, canvas.attributes);
    img.className = "__canvas__";

    canvas.replaceWith(img);
  }
}

export function createWebview(scale = 1.25) {
  const webview = document.createElement("webview");
  webview.src = `app://obsidian.md/help.html`;
  webview.setAttribute(
    "style",
    `height:calc(${scale} * 100%);
     width: calc(${scale} * 100%);
     transform: scale(${1 / scale}, ${1 / scale});
     transform-origin: top left;
     border: 1px solid #f2f2f2;
    `,
  );
  webview.nodeintegration = true;
  webview.addEventListener("dom-ready", () => {
    // Webview is ready, now attach the event listener
    webview.executeJavaScript(`
      document.body.addEventListener('click', (event) => {
        const clickedElement = event.target;
    
        // Check if a page break already exists *before* the clicked element
        const existingPageBreak = clickedElement.previousElementSibling;
        if (existingPageBreak && existingPageBreak.classList.contains('pagedjs_page_break')) {
          // Remove the existing page break
          existingPageBreak.remove();
        } else {
          // Create the page break element
          const pageBreak = document.createElement('div');
          pageBreak.classList.add('pagedjs_page_break');
    
          // Insert the page break before the clicked element
          clickedElement.parentNode?.insertBefore(pageBreak, clickedElement);
        }
      });
    `);
    
    
    
  });
  return webview;
}

function waitForDomChange(target: HTMLElement, timeout = 2000, interval = 200): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const observer = new MutationObserver((m) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        observer.disconnect();
        resolve(true);
      }, interval);
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`timeout ${timeout}ms`));
    }, timeout);
  });
}
