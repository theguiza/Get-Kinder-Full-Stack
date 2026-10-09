import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

/**
 * Route-source assertions (no SQL, no kai.* access) must judge executable code,
 * not comments. This returns `source` with every comment blanked and everything
 * else kept: the TypeScript parser (a declared devDependency) tokenizes the
 * whole module, the exact text of every token is copied through, and only the
 * trivia between tokens (whitespace and comments) becomes spaces. Newlines and
 * offsets are preserved.
 *
 * Because the parser, not a regex, decides what a comment is, string literals,
 * template literals (including `//` or `/*` inside template text and
 * `${...}` substitutions), and regular-expression literals are tokens and stay
 * visible to the assertions. A source that does not parse throws, so a parse
 * failure can never silently blank code.
 */
export function executableSource(source, fileName = "source.js") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
    ts.ScriptKind.JS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const [first] = sourceFile.parseDiagnostics;
    throw new Error(`executableSource could not parse ${fileName}: ${ts.flattenDiagnosticMessageText(first.messageText, "\n")}`);
  }

  const output = source.replace(/[^\n]/g, " ").split("");
  const copyToken = (node) => {
    const start = node.getStart(sourceFile, false);
    for (let index = start; index < node.end; index += 1) output[index] = source[index];
  };
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      copyToken(node);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sourceFile);
  return output.join("");
}
