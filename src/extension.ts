import * as vscode from "vscode";
import { SymfocusViewProvider } from "./symfocusView";
import { registerExplainCommand } from "./explainCommand";
import { registerHoverProvider } from "./hoverProvider";
import { registerOpenFileCommand } from "./openFileCommand";

export function activate(context: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel("Symfocus");
  context.subscriptions.push(out);
  const log = (msg: string) =>
    out.appendLine(`[${new Date().toISOString()}] ${msg}`);

  const viewProvider = new SymfocusViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "symfocus.explanation",
      viewProvider
    )
  );

  registerHoverProvider(context);
  registerExplainCommand(context, log, viewProvider);
  registerOpenFileCommand(context);
}

export function deactivate(): void {}
