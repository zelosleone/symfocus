import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getHtml, WebviewUris } from "./webview/template";

interface TextMatch {
  uri: vscode.Uri;
  line: number;
  col: number;
  content: string;
  score: number;
}

/**
 * Smart symbol navigation: tries workspace symbol provider first,
 * falls back to built-in text search with ranking.
 */
async function goToSymbolSmart(symbol: string): Promise<void> {
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    symbol
  );

  const matches = symbols?.filter(
    (s) => s.name === symbol || s.name.includes(symbol)
  );

  if (matches && matches.length > 0) {
    const best = matches.find((s) => s.name === symbol) ?? matches[0];
    const doc = await vscode.workspace.openTextDocument(best.location.uri);
    await vscode.window.showTextDocument(doc, { selection: best.location.range });
    return;
  }

  const textMatches = await searchTextInWorkspace(symbol);

  if (textMatches.length === 0) {
    void vscode.window.showInformationMessage(`No matches found for "${symbol}"`);
    return;
  }

  const top = textMatches[0];
  if (textMatches.length === 1 && top.score >= 0) {
    await navigateToMatch(top);
    return;
  }

  if (top.score >= 20) {
    await navigateToMatch(top);
    return;
  }

  const items = textMatches.map((m) => ({
    label: path.basename(m.uri.fsPath),
    description: `Line ${m.line}`,
    detail: m.content.trim().slice(0, 100),
    match: m,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder:
      top.score < 0
        ? `No definition-like matches; pick a location for "${symbol}"`
        : `Found ${textMatches.length} matches for "${symbol}"`,
  });

  if (picked) {
    await navigateToMatch(picked.match);
  }
}

async function navigateToMatch(match: TextMatch): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(match.uri);
  const line = Math.max(0, match.line - 1);
  const col = Math.max(0, match.col - 1);
  const pos = new vscode.Position(line, col);
  await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(pos, pos),
  });
}

/**
 * Search for text in workspace files with smart ranking.
 * Prefers definitions over imports/usages.
 */
async function searchTextInWorkspace(query: string): Promise<TextMatch[]> {
  const wf = vscode.workspace.workspaceFolders;
  if (!wf || wf.length === 0) return [];

  const root = wf[0].uri.fsPath;
  const results: TextMatch[] = [];
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".json", ".md"];
  const ignoreDirs = ["node_modules", ".git", "dist", "out", ".next", "build"];

  const files = await collectFiles(root, extensions, ignoreDirs);

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const col = line.indexOf(query);
        if (col === -1) continue;

        const score = scoreMatch(line, query, filePath);
        results.push({
          uri: vscode.Uri.file(filePath),
          line: i + 1,
          col: col + 1,
          content: line,
          score,
        });
      }
    } catch {
      // ignore unreadable files
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

/**
 * Score a match based on context - higher = more likely a definition.
 */
function scoreMatch(line: string, query: string, filePath: string): number {
  let score = 0;
  const lower = line.toLowerCase();

  if (lower.includes("import ") || lower.includes("require(")) {
    score -= 100;
  }

  if (lower.trimStart().startsWith("//") || lower.trimStart().startsWith("*")) {
    score -= 50;
  }

  if (lower.includes("function ") || lower.includes("const ") || lower.includes("let ")) {
    score += 30;
  }
  if (lower.includes("registercommand") || lower.includes("register")) {
    score += 50;
  }
  if (lower.includes("contributes") || lower.includes("commands")) {
    score += 40;
  }
  if (lower.includes("class ") || lower.includes("interface ")) {
    score += 30;
  }
  if (lower.includes("enum ") || lower.includes("struct ")) {
    score += 30;
  }
  if (lower.includes("type ") && lower.includes("=")) {
    score += 30;
  }

  if (line.includes(`"${query}"`) || line.includes(`'${query}'`)) {
    score += 20;
  }

  if (filePath.endsWith("package.json")) {
    score += 25;
  }

  if (filePath.includes("extension.ts") || filePath.includes("extension.js")) {
    score += 20;
  }

  return score;
}

/**
 * Recursively collect files with given extensions, ignoring certain directories.
 */
function collectFiles(
  dir: string,
  extensions: string[],
  ignoreDirs: string[]
): string[] {
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!ignoreDirs.includes(entry.name)) {
          results.push(...collectFiles(fullPath, extensions, ignoreDirs));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // ignore unreadable directories
  }

  return results;
}

export type SymfocusMessage =
  | { type: "show"; html: string }
  | { type: "append"; html: string }
  | { type: "clear" }
  | { type: "error"; message: string }
  | {
      type: "info";
      symbol: {
        name: string;
        kind: string;
        location: string;
        path: string;
        line?: number;
        col?: number;
        signature?: string;
      };
    }
  | { type: "status"; status: string; badge?: string }
  | { type: "loading" };

export class SymfocusViewProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _extensionUri: vscode.Uri;
  private _context: vscode.ExtensionContext;

  constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this._extensionUri = extensionUri;
    this._context = context;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    const uris: WebviewUris = {
      cssUri: webviewView.webview
        .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "symfocus.css"))
        .toString(),
    };

    webviewView.webview.html = getHtml(webviewView.webview.cspSource, uris);

    this._context.subscriptions.push(
      webviewView.webview.onDidReceiveMessage((msg) => {
        if (msg && msg.type === "openFile") {
          void vscode.commands.executeCommand(
            "symfocus.openFile",
            msg.path,
            msg.line,
            msg.col,
            msg.endLine
          );
        } else if (msg?.type === "goToSymbol" && typeof msg.symbol === "string") {
          void goToSymbolSmart(msg.symbol);
        }
      })
    );
  }

  post(msg: SymfocusMessage): void {
    this._view?.webview.postMessage(msg);
  }

  show(preserveFocus?: boolean): void {
    this._view?.show?.(preserveFocus);
  }
}
