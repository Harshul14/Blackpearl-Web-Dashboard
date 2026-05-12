const TOKEN_CHAR_RATIO = 3;

export function chunkJsonlByTokens(
  lines: string[],
  maxTokens: number,
  tokenCharRatio = TOKEN_CHAR_RATIO,
) {
  const chunks = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;
  for (const line of lines) {
    const lineTokens = Math.ceil(line.length / tokenCharRatio);
    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
    currentChunk.push(line);
    currentTokens += lineTokens;
  }
  if (currentChunk.length) {
    chunks.push(currentChunk);
  }
  return chunks;
}

export function attemptRepairJson(jsonString: string): string {
  if (!jsonString) return "{}";

  // Basic Cleanup: Remove Markdown code blocks
  let str = jsonString.replace(/^```(json)?|```$/gm, "").trim();

  // Fast Path: Try parsing immediately.
  try {
    JSON.parse(str);
    return str;
  } catch (e) {
    // Continue to repair
  }

  // State Machine Parser
  let inString = false;
  let isEscaped = false;
  const stack: string[] = [];
  let lastNonWhitespaceIndex = -1;
  let lastValidClosingIndex = -1;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;
    if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === "}" || char === "]") {
      if (stack.length > 0) {
        const expected = stack[stack.length - 1];
        if (char === expected) {
          stack.pop();
          if (stack.length === 0) {
            lastValidClosingIndex = i;
          }
        } else {
          // Mismatched bracket found (e.g. { ] ).
          // Usually better to stop here and try to repair what we have so far
          break;
        }
      }
    }

    if (/\S/.test(char)) {
      lastNonWhitespaceIndex = i;
    }
  }

  // Truncate Garbage
  // If we found a valid root closing point, but there is text afterwards,
  // and the stack is empty (meaning we aren't waiting for more closes), cut the string.
  if (
    stack.length === 0 &&
    lastValidClosingIndex !== -1 &&
    lastValidClosingIndex < lastNonWhitespaceIndex
  ) {
    str = str.substring(0, lastValidClosingIndex + 1);
  }
  //  Repair Truncation (Missing Quotes/Brackets)
  let result = str;

  // Close open string
  if (inString) {
    result += '"';
  }
  // Remove trailing comma if it exists at the very end of valid content
  // We scan backwards from the end of our potentially modified result
  result = result.trim().replace(/,$/, "");
  // Close remaining open structures from the stack
  // We reverse walk the stack to close inner-most first
  while (stack.length > 0) {
    result += stack.pop();
  }
  // Final Attempt
  try {
    // One last safe regex for trailing commas inside objects/arrays
    // (This is safer now that we've balanced the end)
    result = result.replace(/,\s*([}\]])/g, "$1");
    JSON.parse(result);
    return result;
  } catch (e) {
    // If still failing, fallback to empty object or array based on start
    const trimmed = result.trim();
    if (trimmed.startsWith("[")) return "[]";
    return "{}";
  }
}

export function mergeFilters(filters: any[]): any {
  const result: any = {};
  for (const filter of filters) {
    if (!filter || typeof filter !== "object") continue;
    for (const key of Object.keys(filter)) {
      const existing = result[key];
      const incoming = filter[key];
      if (Array.isArray(incoming)) {
        const combined = [
          ...(Array.isArray(existing) ? existing : []),
          ...incoming,
        ];
        result[key] = Array.from(
          new Map(
            combined.map((item) => [JSON.stringify(item), item]),
          ).values(),
        );
      } else if (
        incoming &&
        typeof incoming === "object" &&
        !Array.isArray(incoming)
      ) {
        result[key] = mergeFilters([existing || {}, incoming]);
      } else {
        result[key] = incoming;
      }
    }
  }
  return result;
}

export function sanitizePromptForFilters(input: string): string {
  if (!input) return input;
  return input
    .replace(/<\|system\|>[\s\S]*?<\/s>/gi, "")
    .replace(/<\|context\|>\s*Previous History:\nColleague:/gi, "")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]")
    .replace(/\b\d{10,15}\b/g, "[PHONE]")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
