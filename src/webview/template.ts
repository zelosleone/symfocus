import { getScript } from "./script";
import {
  HeroSection,
  SymbolInfoCard,
  Placeholder,
  LoadingState,
  CopyRow,
} from "./components";

export interface WebviewUris {
  cssUri: string;
}

export function getHtml(cspSource: string, uris: WebviewUris): string {
  const csp = `default-src 'none'; script-src 'unsafe-inline' ${cspSource}; style-src ${cspSource};`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${uris.cssUri}">
</head>
<body>
  <!-- Screen reader announcements -->
  <div aria-live="polite" aria-atomic="true" class="sr-only" id="sr-announce"></div>

  <div class="frame" role="main">
    ${HeroSection()}

    <section class="content-shell">
      ${SymbolInfoCard()}
      <div id="symbol-signature" class="symbol-signature hidden"></div>
      ${Placeholder()}
      ${LoadingState()}
      ${CopyRow()}
      <div id="content" class="explanation hidden"></div>
    </section>
  </div>
  <script>${getScript()}</script>
</body>
</html>`;
}
