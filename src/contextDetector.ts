import * as vscode from "vscode";
import { isIgnored } from "./ignoreResolver";

/** Domain indicators and their descriptions */
const DOMAIN_INDICATORS: Array<{ patterns: RegExp; domain: string }> = [
  // Game development
  { patterns: /\b(bevy|godot|unity|unreal|game[-_]?engine|ecs|entity[-_]?component)\b/i, domain: "game development" },
  // Robotics
  { patterns: /\b(ros|ros2|robot|robotics|gazebo|moveit|urdf|sensor[-_]?fusion)\b/i, domain: "robotics" },
  // Machine Learning / AI
  { patterns: /\b(tensorflow|pytorch|keras|scikit[-_]?learn|ml|machine[-_]?learning|neural[-_]?net|llm|transformer|huggingface)\b/i, domain: "machine learning" },
  // Data Science
  { patterns: /\b(pandas|numpy|scipy|matplotlib|jupyter|data[-_]?science|analytics|statistics)\b/i, domain: "data science" },
  // Web Frontend
  { patterns: /\b(react|vue|angular|svelte|nextjs|nuxt|frontend|web[-_]?app|spa|pwa)\b/i, domain: "web frontend" },
  // Web Backend
  { patterns: /\b(express|fastapi|django|flask|nestjs|spring|backend|api[-_]?server|rest[-_]?api|graphql)\b/i, domain: "web backend" },
  // Mobile
  { patterns: /\b(react[-_]?native|flutter|swift|kotlin|ios|android|mobile[-_]?app)\b/i, domain: "mobile development" },
  // DevOps / Infrastructure
  { patterns: /\b(kubernetes|docker|terraform|ansible|ci[-_]?cd|devops|infrastructure|helm|k8s)\b/i, domain: "DevOps/infrastructure" },
  // Finance / Trading
  { patterns: /\b(trading|finance|fintech|quantitative|backtest|portfolio|stock|crypto|blockchain)\b/i, domain: "finance/trading" },
  // Embedded / IoT
  { patterns: /\b(embedded|iot|microcontroller|arduino|esp32|rtos|firmware)\b/i, domain: "embedded systems" },
  // Math / Scientific
  { patterns: /\b(math|numerical|simulation|physics|linear[-_]?algebra|calculus|optimization)\b/i, domain: "scientific computing" },
  // CLI / Tools
  { patterns: /\b(cli|command[-_]?line|terminal|shell|tool|utility)\b/i, domain: "CLI tooling" },
  // Database
  { patterns: /\b(database|sql|postgres|mysql|mongodb|redis|orm|prisma|drizzle)\b/i, domain: "database/data layer" },
  // Security
  { patterns: /\b(security|crypto|encryption|auth|oauth|jwt|cybersecurity)\b/i, domain: "security" },
  // Audio / Video
  { patterns: /\b(audio|video|media|ffmpeg|streaming|codec|webrtc)\b/i, domain: "audio/video processing" },
  // 3D / Graphics
  { patterns: /\b(3d|opengl|webgl|vulkan|graphics|rendering|shader|three\.?js)\b/i, domain: "3D graphics" },
];

/**
 * Detects project context from workspace files.
 * Priority: 1. README.md, 2. package.json description, 3. domain indicators from dependencies
 */
export async function detectProjectContext(): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }

  const rootUri = workspaceFolders[0].uri;

  const [readmeContext, packageContext, domainContext] = await Promise.all([
    extractFromReadme(rootUri).catch(() => undefined),
    extractFromPackageJson(rootUri).catch(() => undefined),
    detectDomainFromFiles(rootUri).catch(() => undefined),
  ]);

  const results: string[] = [];
  if (readmeContext) results.push(readmeContext);
  if (packageContext) results.push(packageContext);
  if (domainContext) results.push(`Domain: ${domainContext}`);

  if (results.length === 0) {
    return undefined;
  }

  const combined = results.join(". ");
  return combined.length > 300 ? combined.slice(0, 297) + "..." : combined;
}

async function extractFromReadme(rootUri: vscode.Uri): Promise<string | undefined> {
  const readmePaths = ["README.md", "readme.md", "README.rst", "README.txt"];

  for (const filename of readmePaths) {
    try {
      const readmeUri = vscode.Uri.joinPath(rootUri, filename);
      if (await isIgnored(readmeUri)) continue;
      const content = await vscode.workspace.fs.readFile(readmeUri);
      const text = new TextDecoder().decode(content);

      const lines = text.split("\n");
      const meaningfulLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.startsWith("#") ||
          trimmed.startsWith("!") ||
          trimmed.startsWith("[!") ||
          trimmed.startsWith("<") ||
          trimmed.startsWith("```") ||
          trimmed.match(/^\[.*\]\(.*\)$/)
        ) {
          continue;
        }

        meaningfulLines.push(trimmed);
        if (meaningfulLines.length >= 3) break;
      }

      if (meaningfulLines.length > 0) {
        const desc = meaningfulLines.join(" ").slice(0, 200);
        return `Project: ${desc}`;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function extractFromPackageJson(rootUri: vscode.Uri): Promise<string | undefined> {
  try {
    const pkgUri = vscode.Uri.joinPath(rootUri, "package.json");
    if (!(await isIgnored(pkgUri))) {
      const content = await vscode.workspace.fs.readFile(pkgUri);
      const text = new TextDecoder().decode(content);
      const pkg = JSON.parse(text) as { description?: string; name?: string };

      if (pkg.description && pkg.description.length > 5) {
        return pkg.description.slice(0, 150);
      }
    }
  } catch {
    // ignore unreadable package.json
  }

  try {
    const cargoUri = vscode.Uri.joinPath(rootUri, "Cargo.toml");
    if (!(await isIgnored(cargoUri))) {
      const content = await vscode.workspace.fs.readFile(cargoUri);
      const text = new TextDecoder().decode(content);
      const descMatch = text.match(/description\s*=\s*"([^"]+)"/);
      if (descMatch) {
        return descMatch[1].slice(0, 150);
      }
    }
  } catch {
    // ignore unreadable Cargo.toml
  }

  try {
    const pyprojectUri = vscode.Uri.joinPath(rootUri, "pyproject.toml");
    if (!(await isIgnored(pyprojectUri))) {
      const content = await vscode.workspace.fs.readFile(pyprojectUri);
      const text = new TextDecoder().decode(content);
      const descMatch = text.match(/description\s*=\s*"([^"]+)"/);
      if (descMatch) {
        return descMatch[1].slice(0, 150);
      }
    }
  } catch {
    // ignore unreadable pyproject.toml
  }

  return undefined;
}

async function detectDomainFromFiles(rootUri: vscode.Uri): Promise<string | undefined> {
  const decoder = new TextDecoder();

  const tryReadFile = async (filename: string): Promise<string | undefined> => {
    try {
      const uri = vscode.Uri.joinPath(rootUri, filename);
      if (await isIgnored(uri)) return undefined;
      const content = await vscode.workspace.fs.readFile(uri);
      return decoder.decode(content);
    } catch {
      return undefined;
    }
  };

  const results = await Promise.all([
    tryReadFile("package.json"),
    tryReadFile("Cargo.toml"),
    tryReadFile("requirements.txt"),
    tryReadFile("pyproject.toml"),
  ]);

  const combined = results.filter(Boolean).join("\n");
  if (!combined) return undefined;

  const detectedDomains: string[] = [];
  for (const { patterns, domain } of DOMAIN_INDICATORS) {
    if (patterns.test(combined)) {
      detectedDomains.push(domain);
    }
  }

  if (detectedDomains.length === 0) return undefined;

  return detectedDomains.slice(0, 3).join(", ");
}
