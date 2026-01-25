import type { ExplanationMode, ExperienceLevel } from "./config";

export const SYSTEM_PROMPT = `You explain code to developers. Your response must follow this structure:

**Summary**: 1-2 sentence overview of what this symbol does.

**Definition**: Type signature with file path and line numbers. Use a markdown link for the file path (e.g. [src/file.ts:56](src/file.ts:56) or [src/file.ts:56-59](src/file.ts:56-59)), not backticks.

**Parameters** (functions/methods only): List each parameter with name, type, purpose, and default value if any. Be thorough.

**Returns** (functions/methods only): What is returned and under what conditions. Cover all return paths.

**Side Effects**: Blocking behavior, state mutations, I/O operations, network calls. Write "None" if pure.

**Example Usage**: 1-2 practical code examples. Reference caller snippets from codebase when provided.

**Performance**: ONLY include if there's an actual performance problem—O(n²) loops, blocking I/O in hot paths, memory leaks, unnecessary allocations. NO generic advice like "consider caching" or "be mindful of performance". Skip entirely if no real issue.

**Security**: ONLY include if there's an actual vulnerability—injection, XSS, auth bypass, secrets exposure, unsafe deserialization. NO generic advice like "validate input" or "sanitize data". Skip entirely if no real issue.

**Notes**: Edge cases, platform-specific behavior, deprecation warnings. Skip if nothing notable.

**See Also**: List only meaningful related symbols that a developer would look up: functions, classes, types, or modules. Use markdown links with a short label. Do NOT include local variables, parameters, or implementation details (e.g. line0, col0, doc, tmp, err, i).
- [functionName](src/file.ts:42)
- [ClassName helper](src/other.ts:10)

Rules:
- Do not output a top-level # EXPLANATION or # Explanation heading; the UI provides the title.
- Be thorough in Parameters, Returns, Side Effects—don't skip important details
- For Performance/Security ONLY: skip generic advice, only mention specific issues with concrete fixes
- Reference actual line numbers and variable names
- Wrap every code location or line-range citation in a clickable Markdown link (e.g., replace "lines 4-15" or "line 59" with [src/markdown.ts:4-15](src/markdown.ts:4-15)).
- When quoting inline comments or caller annotations like \`// src/explainCommand.ts:253\`, format them as clickable references (e.g., [src/explainCommand.ts:253](src/explainCommand.ts:253)).
- Skip any section with nothing meaningful to say
- For parameters, methods, and types that appear in the provided source or definitionLocation, use a clickable link with code styling: [\`symbolName\`](path:line). Never use plain \`symbolName\` when you know the file and line; use [\`symbolName\`](path:line) so it stays code-styled and clickable. Use plain \`code\` only for keywords, literals, or when no location is available.
- Line numbers in file:line links are always 1-based (first line is 1). Use ONLY line numbers explicitly given in the prompt: \`Line:\`, \`Defined in: path:N\`, \`referencesSummary\`, and \`callerSnippets\` (e.g. \`file:line\`). Do NOT infer or guess from the source code block (it has no line numbers); guessing causes links to open 1 line off.
- When linking symbol names, use the exact path and line from those prompt fields (e.g. [\`parameterName\`](src/current.ts:28)); if a symbol's line is not provided, use plain \`code\` or omit the link.
- In standard and deep modes, always include **See Also** with at least 1–2 related symbols when definitionLocation, referencesSummary, or callerSnippets are provided; omit only when none of these exist.
- For **See Also**, list only top-level or exported symbols (functions, classes, types, modules). Never list local variables, loop counters, parameters, or implementation details like line0, col0, doc.
- Always use the exact relative path (e.g. src/file.ts). Never write rc/ for src/ or similar typos.`;

type SymbolKindCategory =
  | "function"
  | "class"
  | "interface"
  | "variable"
  | "constant"
  | "enum"
  | "module"
  | "type"
  | "other";

/** Caller snippet showing how this symbol is used in the codebase */
type CallerSnippet = {
  file: string;
  line: number;
  snippet: string;
};

export type BuildUserPromptOptions = {
  importBlock?: string;
  ideHover?: string;
  detail?: string;
  containerName?: string;
  isDeprecated?: boolean;
  definitionLocation?: { path: string; line: number };
  referencesSummary?: string;
  callerSnippets?: CallerSnippet[];
  line?: number;
  column?: number;
  displayPath?: string;
  explanationMode?: ExplanationMode;
  experienceLevel?: ExperienceLevel;
  projectContext?: string;
};

/** Map VS Code symbol kind labels to categories for section selection */
function categorizeKind(kindLabel: string): SymbolKindCategory {
  const lower = kindLabel.toLowerCase();
  if (["function", "method", "constructor"].includes(lower)) return "function";
  if (["class", "struct"].includes(lower)) return "class";
  if (["interface"].includes(lower)) return "interface";
  if (["variable", "property", "field"].includes(lower)) return "variable";
  if (["constant"].includes(lower)) return "constant";
  if (["enum", "enum member"].includes(lower)) return "enum";
  if (["module", "namespace", "package", "file"].includes(lower)) return "module";
  if (["type parameter"].includes(lower)) return "type";
  return "other";
}

/** Get sections relevant for this symbol kind - includes Performance/Security for LLM to skip if not applicable */
function getSectionsForKind(category: SymbolKindCategory): string[] {
  const common = ["Example Usage", "Performance", "Security", "Notes", "See Also"];
  switch (category) {
    case "function":
      return ["Definition", "Parameters", "Returns", "Side Effects", ...common];
    case "class":
      return ["Definition", "Constructor", "Key Members", "Side Effects", ...common];
    case "interface":
      return ["Definition", "Properties", "Implementors", ...common];
    case "variable":
    case "constant":
      return ["Definition", "Type & Scope", "Side Effects", ...common];
    case "enum":
      return ["Definition", "Variants", ...common];
    case "module":
      return ["Definition", "Exports", ...common];
    case "type":
      return ["Definition", "Constraints", ...common];
    default:
      return ["Definition", "Purpose", ...common];
  }
}

/** Build sections list based on mode and kind - LLM decides what's relevant */
function buildSectionsList(
  category: SymbolKindCategory,
  _source: string,
  mode: ExplanationMode,
  isDeprecated: boolean
): string[] {
  if (mode === "quick") {
    return ["Summary", "Definition"];
  }

  const sections = ["Summary"];

  if (isDeprecated) {
    sections.push("Migration");
  }

  const kindSections = getSectionsForKind(category);
  sections.push(...kindSections);

  return sections;
}

function buildExperienceInstruction(_level: ExperienceLevel): string {
  return "Assume the reader understands the language. Don't explain syntax or basic patterns.";
}

export function buildUserPrompt(
  relativePath: string,
  name: string,
  kindLabel: string,
  lang: string,
  source: string,
  options?: BuildUserPromptOptions
): string {
  const {
    importBlock,
    ideHover,
    detail,
    containerName,
    isDeprecated,
    definitionLocation,
    referencesSummary,
    callerSnippets,
    line,
    column,
    displayPath,
    explanationMode = "standard",
    experienceLevel = "senior",
    projectContext,
  } = options ?? {};

  const category = categorizeKind(kindLabel);
  const sections = buildSectionsList(category, source, explanationMode, isDeprecated ?? false);

  let sourceVal = source;
  let importBlockVal = importBlock;
  let callerSnippetsVal = callerSnippets;
  let projectContextVal = projectContext;
  if (explanationMode === "quick") {
    const sourceLines = source.split("\n");
    sourceVal =
      sourceLines.slice(0, 35).join("\n") + (sourceLines.length > 35 ? "\n..." : "");
    if (importBlockVal) {
      const ibLines = importBlockVal.split("\n");
      importBlockVal =
        ibLines.slice(0, 12).join("\n") + (ibLines.length > 12 ? "\n..." : "");
    }
    if (callerSnippetsVal) callerSnippetsVal = callerSnippetsVal.slice(0, 2);
    if (projectContextVal) projectContextVal = projectContextVal.slice(0, 80);
  }

  const importSection =
    importBlockVal && importBlockVal.length > 0
      ? "Imports / header:\n```" + lang + "\n" + importBlockVal + "\n```\n\n"
      : "";

  const hoverLine = ideHover && ideHover.length > 0 ? `\nIDE hover: ${ideHover}` : "";

  const afterSymbol =
    (detail ? `\nSignature: ${detail}` : "") +
    (containerName ? `\nContainer: ${containerName}` : "") +
    (isDeprecated ? `\n⚠️ DEPRECATED` : "");

  const afterHover =
    (definitionLocation
      ? `\nDefined in: ${definitionLocation.path}:${definitionLocation.line}`
      : "") + (referencesSummary ? `\n${referencesSummary}` : "");

  let callerSnippetsSection = "";
  if (callerSnippetsVal && callerSnippetsVal.length > 0) {
    const snippetLines = callerSnippetsVal.map(
      (s) => `${s.file}:${s.line}\n\`\`\`\n${s.snippet}\n\`\`\``
    );
    callerSnippetsSection = `\nCaller examples from codebase:\n${snippetLines.join("\n\n")}`;
  }

  const locationLine =
    line != null ? `Line: ${line}${column ? `, col ${column}` : ""}` : "";

  const pathLabel = displayPath ?? relativePath;
  const experienceInstruction = buildExperienceInstruction(experienceLevel);

  const sectionHeadings = sections.map((s) => `### ${s}`).join("\n");

  const modeInstruction =
    explanationMode === "quick"
      ? "Be extremely brief—just 1-2 sentences total."
      : explanationMode === "deep"
        ? "Be thorough. Cover edge cases and non-obvious behavior."
        : "Be concise but complete. 2-3 sentences per section max.";

  const contextSection = projectContextVal
    ? `\nProject context: ${projectContextVal}\nRelate explanations to this domain where relevant.\n`
    : "";

  return `File: ${relativePath}
Symbol: \`${name}\` (${kindLabel})${afterSymbol}
${locationLine}
${importSection}Source:
\`\`\`${lang}
${sourceVal}
\`\`\`${hoverLine}${afterHover}${callerSnippetsSection}
${contextSection}
Explain this ${kindLabel} at ${pathLabel}:${line ?? "?"}.

${experienceInstruction}

${modeInstruction}

Structure your response with these headings (skip any section if nothing meaningful to say):
${sectionHeadings}
Always include **See Also** when context provides definitionLocation, referencesSummary, or callerSnippets.

Rules:
- Teach directly—never give advice about "how to teach" or mention "students"
- Be specific to THIS code, not generic advice
- Reference line numbers when relevant
- For file:line links, use only line numbers from Line:, Defined in:, referencesSummary, and callerSnippets; do not infer from the source block
- If a concept needs explaining, explain it inline in the relevant section`;
}
