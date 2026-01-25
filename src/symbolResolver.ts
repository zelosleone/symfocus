import * as vscode from "vscode";
import { isIgnored } from "./ignoreResolver";

/** Caller snippet showing how this symbol is used in the codebase */
type CallerSnippet = {
  file: string;
  line: number;
  snippet: string;
};

export type SymbolInfo = {
  name: string;
  kind: vscode.SymbolKind;
  range: vscode.Range;
  source: string;
  /** From DocumentSymbol.detail (e.g. function signature). Only when DocumentSymbol is used. */
  detail?: string;
  /** Enclosing symbol: SymbolInformation.containerName, or parent when using DocumentSymbol. */
  containerName?: string;
  /** True if SymbolTag.Deprecated is in DocumentSymbol.tags or SymbolInformation.tags. */
  isDeprecated?: boolean;
  /** From DocumentSymbol.selectionRange (identifier span). */
  selectionRange?: vscode.Range;
  /** When includeDefinition: path and 1-based line. Omitted when same as symbol's own range. */
  definitionLocation?: { path: string; line: number };
  /** When includeReferences: e.g. "Used in 3 places: a.ts:1, b.ts:2". Omit if none. */
  referencesSummary?: string;
  /** When includeReferences: actual code snippets showing how the symbol is called */
  callerSnippets?: CallerSnippet[];
};

function symbolKindLabel(kind: vscode.SymbolKind): string {
  const labels: Record<number, string> = {
    [vscode.SymbolKind.File]: "file",
    [vscode.SymbolKind.Module]: "module",
    [vscode.SymbolKind.Namespace]: "namespace",
    [vscode.SymbolKind.Package]: "package",
    [vscode.SymbolKind.Class]: "class",
    [vscode.SymbolKind.Method]: "method",
    [vscode.SymbolKind.Property]: "property",
    [vscode.SymbolKind.Field]: "field",
    [vscode.SymbolKind.Constructor]: "constructor",
    [vscode.SymbolKind.Enum]: "enum",
    [vscode.SymbolKind.Interface]: "interface",
    [vscode.SymbolKind.Function]: "function",
    [vscode.SymbolKind.Variable]: "variable",
    [vscode.SymbolKind.Constant]: "constant",
    [vscode.SymbolKind.String]: "string",
    [vscode.SymbolKind.Number]: "number",
    [vscode.SymbolKind.Boolean]: "boolean",
    [vscode.SymbolKind.Array]: "array",
    [vscode.SymbolKind.Object]: "object",
    [vscode.SymbolKind.Key]: "key",
    [vscode.SymbolKind.Null]: "null",
    [vscode.SymbolKind.EnumMember]: "enum member",
    [vscode.SymbolKind.Struct]: "struct",
    [vscode.SymbolKind.Event]: "event",
    [vscode.SymbolKind.Operator]: "operator",
    [vscode.SymbolKind.TypeParameter]: "type parameter",
  };
  return labels[kind] ?? "symbol";
}

/**
 * Performs a depth-first search over `DocumentSymbol[]` to find the innermost symbol
 * whose `range` contains `position`. When both a parent and its child contain the
 * position, the child is preferred. `range` is the full span (body, comments);
 * `selectionRange` is the identifier span. We use `range` for containment and source
 * extraction; `selectionRange` is exposed on `DocumentSymbol` for callers that need it.
 *
 * @param symbols - Root document symbols from the LSP.
 * @param position - Cursor position.
 * @param parentName - Name of the containing symbol when recursing; used to set `containerName`.
 * @returns The innermost matching symbol and its container name, or undefined.
 * @see DocumentSymbol
 * @see vscode.executeDocumentSymbolProvider
 */
function findInDocumentSymbols(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position,
  parentName?: string
): { symbol: vscode.DocumentSymbol; containerName: string | undefined } | undefined {
  let best: { symbol: vscode.DocumentSymbol; containerName: string | undefined } | undefined;
  for (const s of symbols) {
    if (!s.range.contains(position)) continue;
    const inChild = s.children?.length
      ? findInDocumentSymbols(s.children, position, s.name)
      : undefined;
    if (inChild) {
      best = inChild;
    } else {
      best = { symbol: s, containerName: parentName };
    }
  }
  return best;
}

/**
 * When the LSP returns a flat `SymbolInformation[]` (no hierarchy), picks the
 * smallest range that contains `position` (by line span). Used as fallback when
 * `DocumentSymbol[]` is not provided.
 *
 * @param infos - Flat symbol list from the LSP.
 * @param position - Cursor position.
 * @returns The smallest containing symbol, or undefined.
 * @see SymbolInformation
 */
function findInSymbolInformation(
  infos: vscode.SymbolInformation[],
  position: vscode.Position
): vscode.SymbolInformation | undefined {
  let best: vscode.SymbolInformation | undefined;
  let bestSpan = 0;
  for (const s of infos) {
    if (!s.location.range.contains(position)) continue;
    const span = s.location.range.end.line - s.location.range.start.line;
    if (best === undefined || span < bestSpan) {
      best = s;
      bestSpan = span;
    }
  }
  return best;
}

export type FindSymbolOpts = {
  includeDefinition?: boolean;
  includeReferences?: boolean;
  refsCap?: number;
};

async function getDefinitionLocation(
  document: vscode.TextDocument,
  position: vscode.Position,
  symbolRange: vscode.Range
): Promise<{ path: string; line: number } | undefined> {
  try {
    const rawDef = await vscode.commands.executeCommand<
      vscode.Location | vscode.LocationLink[] | undefined
    >("vscode.executeDefinitionProvider", document.uri, position);
    const loc = Array.isArray(rawDef) ? rawDef[0] : rawDef;
    if (!loc) return undefined;
    const defUri = "targetUri" in loc ? loc.targetUri : loc.uri;
    const defRange = "targetRange" in loc ? loc.targetRange : loc.range;
    const sameFile = defUri.toString() === document.uri.toString();
    const sameRange = defRange.isEqual(symbolRange);
    const defIgnored = await isIgnored(defUri);
    if ((!sameFile || !sameRange) && !defIgnored) {
      return {
        path: vscode.workspace.asRelativePath(defUri),
        line: defRange.start.line + 1,
      };
    }
  } catch {
    // ignore definition provider errors
  }
  return undefined;
}

async function getReferencesInfo(
  document: vscode.TextDocument,
  position: vscode.Position,
  symbolRange: vscode.Range,
  refsCap: number
): Promise<{ referencesSummary?: string; callerSnippets?: CallerSnippet[] }> {
  try {
    const refs =
      (await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        document.uri,
        position
      )) ?? [];

    const ignored = await Promise.all(refs.map((loc) => isIgnored(loc.uri)));
    const refsFiltered = refs.filter((_, i) => !ignored[i]);

    const externalRefs = refsFiltered.filter((loc) => {
      const sameFile = loc.uri.toString() === document.uri.toString();
      const overlaps = sameFile && loc.range.intersection(symbolRange);
      return !overlaps;
    });

    const n = externalRefs.length;
    if (n === 0) return {};

    const take = Math.min(n, refsCap);
    const parts = externalRefs.slice(0, take).map(
      (loc) =>
        `${vscode.workspace.asRelativePath(loc.uri)}:${loc.range.start.line + 1}`
    );
    const referencesSummary =
      n > refsCap
        ? `Used in ${n} places: ${parts.join(", ")}`
        : `Used in: ${parts.join(", ")}`;

    const snippets: CallerSnippet[] = [];
    for (const loc of externalRefs.slice(0, 3)) {
      try {
        const refDoc = await vscode.workspace.openTextDocument(loc.uri);
        const refLine = loc.range.start.line;
        const startLine = Math.max(0, refLine - 1);
        const endLine = Math.min(refDoc.lineCount - 1, refLine + 1);
        const snippetRange = new vscode.Range(
          startLine,
          0,
          endLine,
          refDoc.lineAt(endLine).range.end.character
        );
        const snippet = refDoc.getText(snippetRange).trim();
        if (snippet.length > 0 && snippet.length < 500) {
          snippets.push({
            file: vscode.workspace.asRelativePath(loc.uri),
            line: refLine + 1,
            snippet,
          });
        }
      } catch {
        // ignore unreadable reference files
      }
    }
    return { referencesSummary, callerSnippets: snippets.length > 0 ? snippets : undefined };
  } catch {
    return {};
  }
}

/**
 * Resolves the symbol at the given position. Uses two LSP shapes: (1) hierarchical
 * `DocumentSymbol[]`—depth-first, innermost containing symbol; (2) flat
 * `SymbolInformation[]`—smallest containing range. Falls back to the word at the
 * cursor plus ±2 lines when neither is available. Supports `opts` to fetch
 * definition and reference locations. Fills extended `SymbolInfo` fields
 * (`detail`, `containerName`, `isDeprecated`, `selectionRange`, `definitionLocation`,
 * `referencesSummary`) when available.
 *
 * @param document - The text document.
 * @param position - Cursor position.
 * @param opts - Optional. `includeDefinition` (default true), `includeReferences`
 *   (default false), `refsCap` (default 5). Definition/reference provider calls
 *   are wrapped in try/catch; on failure the corresponding fields stay unset.
 * @returns Resolved `SymbolInfo` or null.
 */
export async function findSymbolAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  opts?: FindSymbolOpts
): Promise<SymbolInfo | null> {
  const includeDef = opts?.includeDefinition !== false;
  const includeRefs = opts?.includeReferences === true;
  const refsCap = opts?.refsCap ?? 5;

  const raw = await vscode.commands.executeCommand<
    vscode.DocumentSymbol[] | vscode.SymbolInformation[]
  >("vscode.executeDocumentSymbolProvider", document.uri);

  let info: SymbolInfo | null = null;

  if (raw && Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if ("children" in first) {
      const res = findInDocumentSymbols(raw as vscode.DocumentSymbol[], position);
      if (res) {
        const sym = res.symbol;
        const source = document.getText(sym.range);
        info = {
          name: sym.name,
          kind: sym.kind,
          range: sym.range,
          source,
          ...(sym.detail && sym.detail.length > 0 && { detail: sym.detail }),
          ...(res.containerName != null && { containerName: res.containerName }),
          isDeprecated: sym.tags?.includes(vscode.SymbolTag.Deprecated) ?? false,
          ...(sym.selectionRange && { selectionRange: sym.selectionRange }),
        };
      }
    } else {
      const sym = findInSymbolInformation(
        raw as vscode.SymbolInformation[],
        position
      );
      if (sym) {
        const source = document.getText(sym.location.range);
        info = {
          name: sym.name,
          kind: sym.kind,
          range: sym.location.range,
          source,
          ...(sym.containerName && sym.containerName.length > 0 && { containerName: sym.containerName }),
          isDeprecated: sym.tags?.includes(vscode.SymbolTag.Deprecated) ?? false,
        };
      }
    }
  }

  if (!info) {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return null;
    const name = document.getText(wordRange);
    const startLine = Math.max(0, wordRange.start.line - 2);
    const endLine = Math.min(document.lineCount - 1, wordRange.end.line + 2);
    const snippetRange = new vscode.Range(
      startLine,
      0,
      endLine,
      document.lineAt(endLine).range.end.character
    );
    info = {
      name,
      kind: vscode.SymbolKind.Variable,
      range: wordRange,
      source: document.getText(snippetRange),
    };
  }

  if (includeDef && includeRefs) {
    const [defLoc, refsInfo] = await Promise.all([
      getDefinitionLocation(document, position, info.range),
      getReferencesInfo(document, position, info.range, refsCap),
    ]);
    if (defLoc) info.definitionLocation = defLoc;
    if (refsInfo.referencesSummary) info.referencesSummary = refsInfo.referencesSummary;
    if (refsInfo.callerSnippets && refsInfo.callerSnippets.length > 0) {
      info.callerSnippets = refsInfo.callerSnippets;
    }
  } else if (includeDef) {
    const defLoc = await getDefinitionLocation(document, position, info.range);
    if (defLoc) info.definitionLocation = defLoc;
  } else if (includeRefs) {
    const refsInfo = await getReferencesInfo(document, position, info.range, refsCap);
    if (refsInfo.referencesSummary) info.referencesSummary = refsInfo.referencesSummary;
    if (refsInfo.callerSnippets && refsInfo.callerSnippets.length > 0) {
      info.callerSnippets = refsInfo.callerSnippets;
    }
  }

  return info;
}

export function getKindLabel(kind: vscode.SymbolKind): string {
  return symbolKindLabel(kind);
}

/**
 * Returns the top-of-file block (imports / header) up to the symbol's line.
 * Capped to maxLines to avoid token bloat.
 */
export function getImportBlock(
  document: vscode.TextDocument,
  symbolStartLine: number,
  maxLines = 20
): string {
  const endLine = Math.min(maxLines, symbolStartLine);
  if (endLine <= 0) return "";
  return document.getText(new vscode.Range(0, 0, endLine, 0));
}
