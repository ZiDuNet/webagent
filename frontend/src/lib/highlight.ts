export type TokenType =
  | "plain"
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "tag"
  | "attr"
  | "function"
  | "punct";

export interface CodeToken {
  text: string;
  type: TokenType;
}

const COMMON = [
  "if",
  "else",
  "for",
  "while",
  "return",
  "break",
  "continue",
  "import",
  "from",
  "as",
  "in",
  "is",
  "not",
  "and",
  "or",
  "class",
  "def",
  "function",
  "const",
  "let",
  "var",
  "new",
  "try",
  "catch",
  "finally",
  "throw",
  "await",
  "async",
  "yield",
  "export",
  "default",
  "true",
  "false",
  "null",
  "undefined",
  "None",
  "True",
  "False",
  "with",
  "lambda",
  "pass",
  "raise",
  "this",
  "typeof",
  "interface",
  "type",
  "enum",
  "implements",
  "extends",
  "public",
  "private",
  "protected",
  "static",
];

const SQL = [
  "select",
  "from",
  "where",
  "insert",
  "into",
  "values",
  "update",
  "set",
  "delete",
  "create",
  "table",
  "alter",
  "drop",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "on",
  "group",
  "by",
  "order",
  "having",
  "limit",
  "offset",
  "as",
  "and",
  "or",
  "not",
  "null",
  "count",
  "sum",
  "avg",
  "distinct",
  "case",
  "when",
  "then",
  "else",
  "end",
];

const KEYWORDS = new Set(
  [...COMMON, ...SQL].map((word) => word.toLowerCase())
);

function normalizeLanguage(language: string): string {
  const value = language.toLowerCase().trim();
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    html: "html",
    xml: "html",
    md: "markdown",
    plaintext: "text",
    txt: "text",
  };
  return aliases[value] ?? value;
}

function tokenizeHtml(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const pattern =
    /(<!--.*?-->|<\/?[A-Za-z][\w:-]*|\/?>|[A-Za-z_:][\w:.-]*(?==)|"[^"]*"|'[^']*'|=)/g;
  let cursor = 0;

  const push = (text: string, type: TokenType) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += text;
    else tokens.push({ text, type });
  };

  for (const match of line.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    push(line.slice(cursor, index), "plain");
    if (value.startsWith("<!--")) push(value, "comment");
    else if (value.startsWith("</") || value.startsWith("<")) push(value, "tag");
    else if (value === ">" || value === "/>") push(value, "tag");
    else if (value === "=") push(value, "punct");
    else if (value.startsWith('"') || value.startsWith("'"))
      push(value, "string");
    else push(value, "attr");
    cursor = index + value.length;
  }
  push(line.slice(cursor), "plain");
  return tokens;
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[\w$]/.test(char);
}

export function tokenizeLine(line: string, language: string): CodeToken[] {
  const lang = normalizeLanguage(language);
  if (!line) return [];
  if (lang === "text" || lang === "markdown") {
    return [{ text: line, type: "plain" }];
  }
  if (lang === "html") return tokenizeHtml(line);

  const tokens: CodeToken[] = [];
  let index = 0;
  const hashComment = ["python", "bash", "ruby", "yaml", "toml"].includes(lang);
  const dashComment = ["sql", "lua"].includes(lang);

  const push = (text: string, type: TokenType) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += text;
    else tokens.push({ text, type });
  };

  while (index < line.length) {
    const char = line[index];
    const rest = line.slice(index);

    if (rest.startsWith("//") || (dashComment && rest.startsWith("--"))) {
      push(rest, "comment");
      break;
    }
    if (hashComment && char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      push(rest, "comment");
      break;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      const comment = end >= 0 ? rest.slice(0, end + 2) : rest;
      push(comment, "comment");
      index += comment.length;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === "\\") {
          end += 2;
          continue;
        }
        if (line[end] === char) {
          end += 1;
          break;
        }
        end += 1;
      }
      push(line.slice(index, end), "string");
      index = end;
      continue;
    }

    if (/\d/.test(char) && !/[\w$]/.test(line[index - 1] ?? "")) {
      const number = rest.match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
      if (number) {
        push(number[0], "number");
        index += number[0].length;
        continue;
      }
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end])) end += 1;
      const word = line.slice(index, end);
      const following = line.slice(end).match(/^\s*/)?.[0].length ?? 0;
      const nextChar = line[end + following] ?? "";
      if (KEYWORDS.has(word.toLowerCase())) push(word, "keyword");
      else if (nextChar === "(") push(word, "function");
      else push(word, "plain");
      index = end;
      continue;
    }

    if (/[{}()[\].,;:+\-*/%=<>!&|?~^@]/.test(char)) {
      push(char, "punct");
      index += 1;
      continue;
    }

    push(char, "plain");
    index += 1;
  }

  return tokens;
}

export function normalizeCodeLanguage(language: string): string {
  return normalizeLanguage(language) || "text";
}
