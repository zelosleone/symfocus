import * as vscode from "vscode";
import * as path from "path";

export function registerOpenFileCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "symfocus.openFile",
      async (
        targetPath: string,
        line?: number | string,
        col?: number | string,
        endLine?: number | string
      ) => {
        const lineNum =
          typeof line === "number" && !isNaN(line)
            ? line
            : typeof line === "string" && /^\d+$/.test(line)
              ? parseInt(line, 10)
              : undefined;
        const colNum =
          typeof col === "number" && !isNaN(col)
            ? col
            : typeof col === "string" && /^\d+$/.test(col)
              ? parseInt(col, 10)
              : undefined;
        const endLineNum =
          typeof endLine === "number" && !isNaN(endLine)
            ? endLine
            : typeof endLine === "string" && /^\d+$/.test(endLine)
              ? parseInt(endLine, 10)
              : undefined;
        const line0 = lineNum != null && lineNum >= 1 ? lineNum - 1 : 0;
        const col0 = colNum != null && colNum >= 1 ? colNum - 1 : 0;
        const endLine0 =
          endLineNum != null && endLineNum >= 1 ? endLineNum - 1 : undefined;

        let uri: vscode.Uri;
        if (targetPath.startsWith("file:")) {
          uri = vscode.Uri.parse(targetPath);
        } else if (
          vscode.workspace.workspaceFolders &&
          vscode.workspace.workspaceFolders.length > 0 &&
          !targetPath.startsWith("/") &&
          !/^[a-zA-Z]:[\\/]/.test(targetPath)
        ) {
          uri = vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders[0].uri,
            targetPath
          );
        } else {
          uri = vscode.Uri.file(targetPath);
        }

        const errMsg = (e: unknown) =>
          `Symfocus: Could not open ${targetPath}. ${e instanceof Error ? e.message : String(e)}`;

        function buildSelection(
          doc: vscode.TextDocument
        ): vscode.Range {
          if (doc.lineCount === 0) {
            return new vscode.Range(0, 0, 0, 0);
          }
          const line0Clamp = Math.max(0, Math.min(line0, doc.lineCount - 1));
          if (endLine0 != null && endLine0 >= line0) {
            const endLine0Clamp = Math.max(
              0,
              Math.min(endLine0, doc.lineCount - 1)
            );
            const start = Math.min(line0Clamp, endLine0Clamp);
            const end = Math.max(line0Clamp, endLine0Clamp);
            const endLineLen = doc.lineAt(end).range.end.character;
            return new vscode.Range(start, 0, end, endLineLen);
          }
          const lineLen = doc.lineAt(line0Clamp).range.end.character;
          const col0Clamp = Math.max(0, Math.min(col0, lineLen));
          return new vscode.Range(line0Clamp, col0Clamp, line0Clamp, col0Clamp);
        }

        async function openAtUri(openUri: vscode.Uri): Promise<void> {
          const doc = await vscode.workspace.openTextDocument(openUri);
          const selection = buildSelection(doc);
          await vscode.window.showTextDocument(doc, { selection });
        }

        async function pickFromMatches(
          matches: vscode.Uri[],
          originalTarget: string
        ): Promise<vscode.Uri | undefined> {
          if (matches.length === 1) return matches[0];
          if (matches.length === 0) return undefined;
          const items = matches.map((match) => ({
            label: vscode.workspace.asRelativePath(match),
            description: match.fsPath,
            uri: match,
          }));
          const picked = await vscode.window.showQuickPick(items, {
            placeHolder: `Select a file for "${originalTarget}"`,
          });
          return picked?.uri;
        }

        try {
          await openAtUri(uri);
        } catch (e) {
          const canRetry =
            !targetPath.startsWith("file:") &&
            !targetPath.startsWith("/") &&
            !/^[a-zA-Z]:[\\/]/.test(targetPath) &&
            vscode.workspace.workspaceFolders &&
            vscode.workspace.workspaceFolders.length > 0 &&
            (targetPath.startsWith("rc/") || targetPath.startsWith("srs/"));
          if (canRetry) {
            const wf = vscode.workspace.workspaceFolders;
            if (wf && wf.length > 0) {
              const pathAlt = targetPath
                .replace(/^rc\//, "src/")
                .replace(/^srs\//, "src/");
              const uriAlt = vscode.Uri.joinPath(wf[0].uri, pathAlt);
              try {
                await openAtUri(uriAlt);
                return;
              } catch {
                // ignore missing fallback path
              }
            }
          }
          if (
            vscode.workspace.workspaceFolders &&
            vscode.workspace.workspaceFolders.length > 0
          ) {
            const basename = path.basename(targetPath);
            if (basename && basename !== targetPath) {
              try {
                const matches = await vscode.workspace.findFiles(
                  `**/${basename}`,
                  "**/{node_modules,.git,dist,out,.next,build}/**",
                  20
                );
                const pickedUri = await pickFromMatches(matches, targetPath);
                if (pickedUri) {
                  await openAtUri(pickedUri);
                  return;
                }
              } catch {
                // ignore search errors
              }
            }
          }
          void vscode.window.showErrorMessage(errMsg(e));
        }
      }
    )
  );
}
