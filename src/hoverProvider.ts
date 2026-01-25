import * as vscode from "vscode";

export function registerHoverProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      {
        provideHover(doc, position, token) {
          if (token.isCancellationRequested) return undefined;
          const word = doc.getWordRangeAtPosition(position);
          if (!word) return undefined;
          const md = new vscode.MarkdownString(
            "[Explain in Symfocus](command:symfocus.explainSymbol) (Ctrl+Alt+E)"
          );
          md.isTrusted = true;
          return new vscode.Hover(md);
        },
      }
    )
  );
}
