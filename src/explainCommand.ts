import * as vscode from "vscode";
import { findSymbolAtPosition, getImportBlock, getKindLabel } from "./symbolResolver";
import { streamOpenAIChat } from "./llm";
import { SymfocusViewProvider } from "./symfocusView";
import { getSymfocusConfig, validateApiConfig } from "./config";
import { SYSTEM_PROMPT, buildUserPrompt } from "./promptBuilder";
import { renderMarkdown } from "./markdown";
import { detectProjectContext } from "./contextDetector";

let currentAbort: AbortController | null = null;
let lastRequestTime = 0;
let debounceTimer: NodeJS.Timeout | undefined;
const MIN_REQUEST_INTERVAL_MS = 2000;

type AllowedLinkInput = {
  relativePath: string;
  displayPath?: string;
  symbolRange: vscode.Range;
  definitionLocation?: { path: string; line: number };
  referencesSummary?: string;
  callerSnippets?: { file: string; line: number }[];
};

function normalizeLinkPath(p: string): string {
  return p.replace(/^rc\//, "src/").replace(/^srs\//, "src/");
}

function addAllowedLink(
  set: Set<string>,
  pathValue: string,
  line: number,
  endLine?: number
): void {
  if (!pathValue || line <= 0) return;
  const normalized = normalizeLinkPath(pathValue);
  if (endLine != null && endLine >= line) {
    set.add(`${normalized}:${line}-${endLine}`);
  }
  set.add(`${normalized}:${line}`);
}

function collectAllowedLinks(input: AllowedLinkInput): Set<string> {
  const allowed = new Set<string>();
  const startLine = input.symbolRange.start.line + 1;
  const endLine = input.symbolRange.end.line + 1;
  addAllowedLink(
    allowed,
    input.relativePath,
    startLine,
    endLine > startLine ? endLine : undefined
  );
  if (
    input.displayPath &&
    input.displayPath !== input.relativePath &&
    !input.displayPath.includes(":")
  ) {
    addAllowedLink(
      allowed,
      input.displayPath,
      startLine,
      endLine > startLine ? endLine : undefined
    );
  }
  if (input.definitionLocation) {
    addAllowedLink(
      allowed,
      input.definitionLocation.path,
      input.definitionLocation.line
    );
  }
  if (input.referencesSummary) {
    const refRe =
      /([a-zA-Z0-9_./\\@+~-]+\.[a-zA-Z0-9]+):(\d+)(?:-(\d+))?/g;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(input.referencesSummary)) !== null) {
      const line = parseInt(m[2], 10);
      const endLine = m[3] ? parseInt(m[3], 10) : undefined;
      addAllowedLink(allowed, m[1], line, endLine);
    }
  }
  if (input.callerSnippets) {
    for (const snippet of input.callerSnippets) {
      addAllowedLink(allowed, snippet.file, snippet.line);
    }
  }
  return allowed;
}

export function registerExplainCommand(
  context: vscode.ExtensionContext,
  log: (msg: string) => void,
  viewProvider: SymfocusViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("symfocus.explainSymbol", async () => {
      log("Explain started (debouncing)");

      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }

      if (currentAbort) {
        log("Aborting previous request");
        currentAbort.abort();
        currentAbort = null;
      }

      viewProvider.post({
        type: "status",
        status: "Waiting...",
        badge: "...",
      });

      debounceTimer = setTimeout(async () => {
        debounceTimer = undefined;

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          log("No active editor");
          return;
        }

        const now = Date.now();
        const timeSinceLast = now - lastRequestTime;
        if (timeSinceLast < MIN_REQUEST_INTERVAL_MS) {
          const waitTime = MIN_REQUEST_INTERVAL_MS - timeSinceLast;
          log(`Rate limit: waiting ${waitTime}ms`);
          viewProvider.post({
            type: "status",
            status: `Cooling down (${Math.ceil(waitTime / 1000)}s)...`,
            badge: "Wait",
          });
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        await executeExplain(editor, log, viewProvider);
      }, 500);
    })
  );
}

async function executeExplain(
  editor: vscode.TextEditor,
  log: (msg: string) => void,
  viewProvider: SymfocusViewProvider
) {
  const doc = editor.document;
  const position = editor.selection.isEmpty
    ? editor.selection.active
    : editor.selection.start;

  const cfg = getSymfocusConfig();
  const api = validateApiConfig(cfg);
  if (!api.ok) {
    log(`Missing config: ${api.missing.join(", ")}`);
    void vscode.window
      .showErrorMessage(
        `Symfocus: Set in Settings: ${api.missing.join(", ")}.`,
        "Open Settings"
      )
      .then((action) => {
        if (action === "Open Settings")
          void vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "symfocus"
          );
      });
    return;
  }
  log(`API: ${api.baseUrl} model=${api.model}`);

  const ourAbort = new AbortController();
  currentAbort = ourAbort;

  viewProvider.post({ type: "loading" });
  viewProvider.post({
    type: "status",
    status: "Scanning selection…",
    badge: "Working",
  });
  void vscode.commands.executeCommand("workbench.view.extension.symfocus");
  viewProvider.show(false);

  try {
    const findOpts = {
      includeDefinition: cfg.includeDefinition,
      includeReferences: cfg.includeReferences,
      refsCap: cfg.referencesCap,
    };

    const needsProjectDetection = !cfg.projectContext?.trim();
    const [info, rawHover, detectedContext] = await Promise.all([
      findSymbolAtPosition(doc, position, findOpts),
      Promise.resolve(
        vscode.commands.executeCommand<vscode.Hover | undefined>(
          "vscode.executeHoverProvider",
          doc.uri,
          position
        )
      ).catch(() => undefined),
      needsProjectDetection ? detectProjectContext().catch(() => undefined) : Promise.resolve(undefined),
    ]);

    if (ourAbort.signal.aborted) return;

    if (!info) {
      log("No symbol at cursor");
      viewProvider.post({
        type: "status",
        status: "Place the cursor on a symbol and try again.",
        badge: "Error",
      });
      viewProvider.post({
        type: "error",
        message:
          "No symbol found at cursor. Place the cursor on a function, class, or variable.",
      });
      return;
    }
    log(`Symbol: ${info.name} (${getKindLabel(info.kind)})`);

    const workspaceRoot =
      vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? "";
    const relativePath = workspaceRoot
      ? vscode.workspace.asRelativePath(doc.uri)
      : doc.uri.fsPath;
    const displayPath = relativePath || doc.uri.fsPath;

    const importBlock = getImportBlock(doc, info.range.start.line, 20);

    let ideHover: string | undefined;
    if (rawHover?.contents) {
      const arr = Array.isArray(rawHover.contents)
        ? rawHover.contents
        : [rawHover.contents];
      const parts = arr.map((x: vscode.MarkedString | vscode.MarkdownString) =>
        typeof x === "string" ? x : (x as { value?: string }).value ?? ""
      );
      const s = parts.join("\n").slice(0, 400).trim();
      if (s.length > 0) ideHover = s;
    }

    const projectContext = cfg.projectContext?.trim() || detectedContext;
    if (projectContext) {
      log(`Project context: ${projectContext.slice(0, 50)}...`);
    }

    const userPrompt = buildUserPrompt(
      relativePath,
      info.name,
      getKindLabel(info.kind),
      doc.languageId,
      info.source,
      {
        importBlock,
        ideHover,
        ...(cfg.includeDetail && info.detail != null && { detail: info.detail }),
        ...(info.containerName != null && { containerName: info.containerName }),
        ...(info.isDeprecated && { isDeprecated: true }),
        ...(cfg.includeDefinition && info.definitionLocation != null && {
          definitionLocation: info.definitionLocation,
        }),
        ...(cfg.includeReferences && info.referencesSummary != null && {
          referencesSummary: info.referencesSummary,
        }),
        ...(cfg.includeReferences && info.callerSnippets != null && {
          callerSnippets: info.callerSnippets,
        }),
        line: info.range.start.line + 1,
        column: info.range.start.character + 1,
        displayPath,
        explanationMode: cfg.explanationMode,
        experienceLevel: cfg.experienceLevel,
        projectContext,
      }
    );

    const allowedLinks = collectAllowedLinks({
      relativePath,
      displayPath,
      symbolRange: info.range,
      definitionLocation: info.definitionLocation,
      referencesSummary: info.referencesSummary,
      callerSnippets: info.callerSnippets,
    });

    viewProvider.post({
      type: "info",
      symbol: {
        name: info.name,
        kind: getKindLabel(info.kind),
        location: displayPath,
        path: doc.uri.fsPath,
        line: info.range.start.line + 1,
        col: info.range.start.character + 1,
        ...(ideHover && { signature: ideHover }),
      },
    });
    viewProvider.post({
      type: "status",
      status: "Composing prompt…",
      badge: "Working",
    });
    viewProvider.post({ type: "clear" });
    viewProvider.post({
      type: "status",
      status: "Sending request…",
      badge: "Working",
    });
    log("Streaming…");

    let accumulator = "";
    let isAborted = false;
    let chunkCount = 0;
    let explanationComplete = false;
    let renderTimer: NodeJS.Timeout | undefined;
    let pendingRender = false;

    const scheduleRender = () => {
      if (renderTimer) return;
      pendingRender = true;
      renderTimer = setTimeout(async () => {
        renderTimer = undefined;
        if (!pendingRender) return;
        pendingRender = false;
        try {
          const html = await renderMarkdown(accumulator, { allowedLinks });
          viewProvider.post({ type: "show", html });
        } catch (e) {
          log(`renderMarkdown error: ${e instanceof Error ? e.message : String(e)}`);
          const html = `<p>${accumulator.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
          viewProvider.post({ type: "show", html });
        }
      }, 50);
    };

    const finalRender = async () => {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      if (accumulator.length === 0) return;
      try {
        const html = await renderMarkdown(accumulator, { allowedLinks });
        viewProvider.post({ type: "show", html });
      } catch (e) {
        log(`renderMarkdown error: ${e instanceof Error ? e.message : String(e)}`);
        const html = `<p>${accumulator.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
        viewProvider.post({ type: "show", html });
      }
    };

    const maxTokens =
      cfg.explanationMode === "quick"
        ? 768
        : cfg.explanationMode === "standard"
          ? 1536
          : 2048;
    for await (const chunk of streamOpenAIChat(
      api.baseUrl,
      api.apiKey,
      api.model,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      ourAbort.signal,
      {
        log,
        maxTokens,
        temperature: 0.3,
      }
    )) {
      if (chunk.type === "chunk") {
        chunkCount++;
        if (chunkCount === 1) {
          viewProvider.post({
            type: "status",
            status: "Receiving explanation…",
            badge: "Working",
          });
        }
        accumulator += chunk.content;
        scheduleRender();
      } else if (chunk.type === "done") {
        log(`Done. ${chunkCount} chunks, ${accumulator.length} chars`);
        explanationComplete = accumulator.length > 0;
        await finalRender();
        if (!explanationComplete) {
          log("No content in model response");
          const message = "No explanation was generated.";
          viewProvider.post({ type: "error", message });
          viewProvider.post({
            type: "status",
            status: message,
            badge: "Error",
          });
        }
        break;
      } else if (chunk.type === "error") {
        log(`Error: ${chunk.message}${chunk.aborted ? " (aborted)" : ""}`);
        isAborted = chunk.aborted ?? false;
        if (!isAborted) {
          viewProvider.post({ type: "error", message: chunk.message });
          viewProvider.post({
            type: "status",
            status: chunk.message,
            badge: "Error",
          });
          void vscode.window.showErrorMessage(`Symfocus: ${chunk.message}`);
        }
        break;
      }
    }

    if (!isAborted && explanationComplete) {
      viewProvider.post({
        type: "status",
        status: "Explanation ready",
        badge: "Ready",
      });
    }

  } catch (e) {
    if (ourAbort.signal.aborted) return;
    log(`Error in executeExplain: ${e}`);
  } finally {
    lastRequestTime = Date.now();
    if (currentAbort === ourAbort) {
      currentAbort = null;
    }
  }
}
