import * as path from "path";
import * as vscode from "vscode";
import ignore from "ignore";
import { minimatch } from "minimatch";

type IgnoreInstance = ReturnType<typeof ignore>;
const ignorerCache = new Map<string, IgnoreInstance>();

async function getIgnorer(folder: vscode.WorkspaceFolder): Promise<IgnoreInstance> {
  const key = folder.uri.toString();
  const cached = ignorerCache.get(key);
  if (cached) return cached;

  const ig = ignore();
  const decoder = new TextDecoder();

  const ignoreFiles = [".gitignore", ".cursorignore", ".vscodeignore"];

  for (const filename of ignoreFiles) {
    try {
      const uri = vscode.Uri.joinPath(folder.uri, filename);
      const raw = await vscode.workspace.fs.readFile(uri);
      const content = decoder.decode(raw).trim();
      if (content.length > 0) ig.add(content);
    } catch {
      // ignore missing ignore files
    }
  }

  try {
    const excludeUri = vscode.Uri.joinPath(folder.uri, ".git", "info", "exclude");
    const raw = await vscode.workspace.fs.readFile(excludeUri);
    const content = decoder.decode(raw).trim();
    if (content.length > 0) ig.add(content);
  } catch {
    // ignore missing .git/info/exclude
  }

  ignorerCache.set(key, ig);
  return ig;
}

function isExcludedBySettings(relPath: string): boolean {
  const filesExclude =
    vscode.workspace.getConfiguration("files").get<Record<string, boolean>>("exclude") ?? {};
  const searchExclude =
    vscode.workspace.getConfiguration("search").get<Record<string, boolean>>("exclude") ?? {};
  const patterns = { ...filesExclude, ...searchExclude };

  for (const [pattern, value] of Object.entries(patterns)) {
    if (value === true && minimatch(relPath, pattern, { matchBase: true })) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the given URI is ignored by .gitignore, .git/info/exclude,
 * .cursorignore, .vscodeignore, or VS Code's files.exclude / search.exclude.
 * Paths outside any workspace folder are not considered ignored.
 */
export async function isIgnored(uri: vscode.Uri): Promise<boolean> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return false;

  const relPath = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
  if (relPath.startsWith("..")) return false;

  const ig = await getIgnorer(folder);
  if (ig.ignores(relPath)) return true;
  if (isExcludedBySettings(relPath)) return true;

  return false;
}
