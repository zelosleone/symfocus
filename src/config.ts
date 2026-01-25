import * as vscode from "vscode";

export type ExplanationMode = "quick" | "standard" | "deep";
export type ExperienceLevel = "junior" | "senior";

export type SymfocusConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  includeDetail: boolean;
  includeDefinition: boolean;
  includeReferences: boolean;
  referencesCap: number;
  explanationMode: ExplanationMode;
  experienceLevel: ExperienceLevel;
  projectContext: string;
};

export function getSymfocusConfig(): SymfocusConfig {
  const cfg = vscode.workspace.getConfiguration();
  const modeRaw = cfg.get<string>("symfocus.explanation.mode") ?? "standard";
  const levelRaw = cfg.get<string>("symfocus.explanation.experienceLevel") ?? "senior";
  return {
    baseUrl: cfg.get<string>("symfocus.openai.baseUrl") ?? "",
    apiKey: cfg.get<string>("symfocus.openai.apiKey") ?? "",
    model: cfg.get<string>("symfocus.openai.model") ?? "",
    includeDetail: cfg.get<boolean>("symfocus.context.includeDetail") ?? true,
    includeDefinition: cfg.get<boolean>("symfocus.context.includeDefinition") ?? true,
    includeReferences: cfg.get<boolean>("symfocus.context.includeReferences") ?? false,
    referencesCap: cfg.get<number>("symfocus.context.referencesCap") ?? 5,
    explanationMode: (["quick", "standard", "deep"].includes(modeRaw) ? modeRaw : "standard") as ExplanationMode,
    experienceLevel: (["junior", "senior"].includes(levelRaw) ? levelRaw : "senior") as ExperienceLevel,
    projectContext: cfg.get<string>("symfocus.explanation.projectContext") ?? "",
  };
}

export type ValidateApiResult =
  | { ok: true; baseUrl: string; apiKey: string; model: string }
  | { ok: false; missing: string[] };

export function validateApiConfig(c: SymfocusConfig): ValidateApiResult {
  const missing: string[] = [];
  if (!c.baseUrl?.trim()) missing.push("Endpoint (base URL)");
  if (!c.apiKey?.trim()) missing.push("API key");
  if (!c.model?.trim()) missing.push("Model");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    baseUrl: c.baseUrl.trim(),
    apiKey: c.apiKey.trim(),
    model: c.model.trim(),
  };
}
