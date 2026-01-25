import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import DOMPurify from "isomorphic-dompurify";
import hljs from "highlight.js";

marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code: string, lang: string) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      try {
        return hljs.highlight(code, { language }).value;
      } catch {
        return hljs.highlight(code, { language: "plaintext" }).value;
      }
    },
  })
);

marked.setOptions({ gfm: true, breaks: true });

DOMPurify.setConfig({
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|ftp|file|mailto|tel|data|command):|[^a-z]+|[a-z+.-]+(?:[^a-z]|$))/i,
  ADD_ATTR: ["data-dw-path", "data-dw-line", "data-dw-col", "data-dw-line-end", "data-dw-symbol"],
});

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizePath(p: string): string {
  return p.replace(/^rc\//, "src/").replace(/^srs\//, "src/");
}

type LinkTransform = {
  href: string;
  path?: string;
  line?: number;
  col?: number;
  endLine?: number;
  symbol?: string;
};

export type RenderMarkdownOptions = {
  allowedLinks?: Set<string>;
};

function transformLinkHref(href: string): LinkTransform {
  if (href.startsWith("file:")) {
    const path = normalizePath(href.slice(5));
    const line = 1;
    const col = 1;
    return {
      href: `command:symfocus.openFile?${encodeURIComponent(JSON.stringify([path, line, col]))}`,
      path,
      line,
      col,
    };
  }
  if (!href.includes("//")) {
    const rangeMatch = href.match(/^(.+):(\d+)-(\d+)$/);
    if (rangeMatch) {
      const path = normalizePath(rangeMatch[1]);
      const line = parseInt(rangeMatch[2], 10);
      const endLine = parseInt(rangeMatch[3], 10);
      const col = 1;
      return {
        href: `command:symfocus.openFile?${encodeURIComponent(JSON.stringify([path, line, col, endLine]))}`,
        path,
        line,
        col,
        endLine,
      };
    }
    const m = href.match(/^(.+):(\d+)(?::(\d+))?$/);
    if (m) {
      const path = normalizePath(m[1]);
      const line = parseInt(m[2], 10);
      const col = m[3] ? parseInt(m[3], 10) : 1;
      return {
        href: `command:symfocus.openFile?${encodeURIComponent(JSON.stringify([path, line, col]))}`,
        path,
        line,
        col,
      };
    }
    const embedded = href.match(
      /([a-zA-Z0-9_./\\@+~-]+\.[a-zA-Z0-9]+):(\d+)(?:-(\d+))?(?::(\d+))?/
    );
    if (embedded) {
      const path = normalizePath(embedded[1]);
      const line = parseInt(embedded[2], 10);
      if (embedded[3] != null) {
        const endLine = parseInt(embedded[3], 10);
        const col = 1;
        return {
          href: `command:symfocus.openFile?${encodeURIComponent(JSON.stringify([path, line, col, endLine]))}`,
          path,
          line,
          col,
          endLine,
        };
      }
      const col = embedded[4] != null ? parseInt(embedded[4], 10) : 1;
      return {
        href: `command:symfocus.openFile?${encodeURIComponent(JSON.stringify([path, line, col]))}`,
        path,
        line,
        col,
      };
    }
    const bareFile = href.match(/^([a-zA-Z0-9_./\\@+~-]+\.[a-zA-Z0-9]+)$/);
    if (bareFile) {
      const path = normalizePath(bareFile[1]);
      return {
        href: `command:symfocus.openFile?${encodeURIComponent(JSON.stringify([path, 1, 1]))}`,
        path,
        line: 1,
        col: 1,
      };
    }
  }
  const symbolLike =
    href.length > 0 &&
    href.length < 200 &&
    !href.includes("//") &&
    !/^(file|https?|mailto|tel|data|#)/i.test(href);
  if (symbolLike) {
    return { href: "#", symbol: href };
  }
  return { href };
}

/** Pattern for backtick-wrapped path:line, path:line-line, or path:line:col (path has .ext). Groups: 1=path, 2=line. */
const BACKTICK_PATH_LINE =
  /`([^\s`]+\.\w+):(\d+)(?:-\d+)?(?::\d+)?`/g;

function linkifyBacktickPathLine(md: string): string {
  const blocks: string[] = [];
  let last = 0;
  const re = /```[\w]*\n[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    blocks.push(md.slice(last, m.index));
    blocks.push(m[0]);
    last = re.lastIndex;
  }
  blocks.push(md.slice(last));

  return blocks
    .map((segment) => {
      if (/^```[\w]*\n/.test(segment)) return segment;
      return segment.replace(BACKTICK_PATH_LINE, (full, _path, _line) => {
        const content = full.slice(1, -1);
        return content.includes("://") ? full : `[${content}](${content})`;
      });
    })
    .join("");
}

/** Naked path:line etc. — not inside `, [], (), or `. Skips ``` blocks. Linkifies (path:line) in parens. */
const NAKED_PATH_LINE =
  /(?<![\x5b\x60])([a-zA-Z0-9_./\\@+~-]+\.[a-zA-Z0-9]+:\d+(?:-\d+)?(?::\d+)?)/g;

function linkifyNakedPathLine(md: string): string {
  const blocks: string[] = [];
  let last = 0;
  const re = /```[\w]*\n[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    blocks.push(md.slice(last, m.index));
    blocks.push(m[0]);
    last = re.lastIndex;
  }
  blocks.push(md.slice(last));

  return blocks
    .map((segment) => {
      if (/^```[\w]*\n/.test(segment)) return segment;
      const parts = segment.split("`");
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          parts[i] = parts[i].replace(NAKED_PATH_LINE, (full) => {
            if (full.includes("://")) return full;
            return `[${full}](${full})`;
          });
        }
      }
      return parts.join("`");
    })
    .join("");
}

/** Strip LLM-style [path:line] or [path:line-line] wrapped in extra brackets so link text shows path:line. */
function stripWrappedPathLineBrackets(text: string): string {
  if (/^\[[^\]]+\.\w+:\d+(?:-\d+)?(?::\d+)?\]$/.test(text)) {
    return text.slice(1, -1);
  }
  return text;
}

function isAllowedFileLink(
  pathValue: string,
  line: number | undefined,
  endLine: number | undefined,
  allowedLinks?: Set<string>
): boolean {
  if (!allowedLinks) return true;
  if (line == null || line <= 0) return false;
  if (endLine != null && endLine >= line) {
    return allowedLinks.has(`${pathValue}:${line}-${endLine}`);
  }
  return allowedLinks.has(`${pathValue}:${line}`);
}

function buildRenderer(allowedLinks?: Set<string>): InstanceType<typeof marked.Renderer> {
  const renderer = new marked.Renderer();
  renderer.link = (href: string, title: string | null | undefined, text: string) => {
    let t = transformLinkHref(href);

    if (t.path != null && t.line === 1) {
      const textMatch = text.match(/:(\d+)(?:-(\d+))?(?::(\d+))?/);
      if (textMatch) {
        const line = parseInt(textMatch[1], 10);
        const endLine = textMatch[2] ? parseInt(textMatch[2], 10) : undefined;
        const col = textMatch[3] ? parseInt(textMatch[3], 10) : 1;
        t = {
          ...t,
          href: `command:symfocus.openFile?${encodeURIComponent(JSON.stringify([t.path, line, col, endLine]))}`,
          line,
          col,
          endLine,
        };
      }
    }

    if (
      t.path != null &&
      !isAllowedFileLink(t.path, t.line, t.endLine, allowedLinks)
    ) {
      return text;
    }

    const tit = title ? ` title="${escapeHtml(title)}"` : "";
    const data =
      t.path != null
        ? ` data-dw-path="${escapeHtml(t.path)}" data-dw-line="${String(t.line ?? 1)}" data-dw-col="${String(t.col ?? 1)}"${t.endLine != null ? ` data-dw-line-end="${String(t.endLine)}"` : ""}`
        : "";
    const displayText = stripWrappedPathLineBrackets(text);
    let inner = displayText !== text ? escapeHtml(displayText) : text;

    if (t.path != null && t.line != null && t.line > 0) {
      const lineMatch = inner.match(/:(\d+(?:-\d+)?(?::\d+)?)(?=$|[^\d:])/);
      if (lineMatch) {
        const pathPart = inner.slice(0, -lineMatch[0].length);
        inner = `${pathPart}<span class="dw-line-number">${lineMatch[0]}</span>`;
      }
    }

    const aHref = t.symbol != null ? "#" : t.href;
    return `<a href="${escapeHtml(aHref)}"${data}${t.symbol != null ? ` data-dw-symbol="${escapeHtml(t.symbol)}"` : ""}${tit}>${inner}</a>`;
  };
  return renderer;
}

export async function renderMarkdown(
  md: string,
  options?: RenderMarkdownOptions
): Promise<string> {
  try {
    const backtickLinkified = linkifyBacktickPathLine(md);
    const linkified = linkifyNakedPathLine(backtickLinkified);
    const renderer = buildRenderer(options?.allowedLinks);
    const html = (await marked.parse(linkified, { renderer })) as string;
    return DOMPurify.sanitize(html);
  } catch {
    return `<p>${escapeHtml(md)}</p>`;
  }
}
