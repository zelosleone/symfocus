# Symfocus

Symfocus adds a sidebar panel that explains the symbol under your cursor. It uses your own OpenAI-compatible endpoint, so you keep control of the model and keys. I tried to replicate Windsurf's DeepWiki feature, because, you know, it was good. This way you can easily navigate the unknown codebases, different code snippets etc. I made it for personal usage first and foremost, this is why I only tested with Z.ai's GLM endpoints, however, as the time goes on i can test with other models and refine the extension even further. (Obviously!) Or, you can also help me with contributing to codebase! All PRs are welcome!

## Quick start

1. Install dependencies and build:
   ```bash
   npm install
   npm run compile
   ```
2. Open VS Code settings and fill in:
   - `symfocus.openai.baseUrl`
   - `symfocus.openai.apiKey`
   - `symfocus.openai.model`

## Usage

- Put the cursor on a symbol and press `Ctrl+Alt+E` (`Cmd+Alt+E` on macOS).
- Or right-click a symbol and choose **Symfocus: Explain Symbol at Cursor**.
- The explanation shows in the **Symfocus** view on the Activity Bar.
- You can also just hover in and it will show up at the top.

## Settings

- `symfocus.context.includeDetail`: include LSP detail like signatures.
- `symfocus.context.includeDefinition`: add definition location links.
- `symfocus.context.includeReferences`: include reference summaries.
- `symfocus.context.referencesCap`: cap the reference list length.
- `symfocus.explanation.mode`: `quick`, `standard`, or `deep`.
- `symfocus.explanation.experienceLevel`: `junior` or `senior`.
- `symfocus.explanation.projectContext`: optional domain hint.

## Packaging

```bash
npm install -g @vscode/vsce
vsce package
```

Install the `.vsix` via **Extensions** -> **...** -> **Install from VSIX**.
