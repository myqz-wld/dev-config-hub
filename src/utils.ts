import { homedir } from "os";
import { join } from "path";

export const HOME = homedir();

export function expandHome(p: string): string {
  return p.startsWith("~") ? join(HOME, p.slice(1)) : p;
}

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /secret/i,
  /password/i,
  /bearer/i,
  /credential/i,
  /authorization/i,
];

const URL_CREDENTIAL_PATTERN = /((?:git\+)?https?:\/\/[^:]+:)[^@]+(@)/g;

function maskStringValue(value: string): string {
  return value.replace(URL_CREDENTIAL_PATTERN, "$1***$2");
}

export function maskSensitiveValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    let v = maskStringValue(value);
    if (SENSITIVE_PATTERNS.some((p) => p.test(key))) {
      if (v.length <= 8) return "***";
      return v.slice(0, 3) + "***" + v.slice(-3);
    }
    return v;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string"
        ? maskStringValue(item)
        : typeof item === "object" && item !== null
          ? maskObject(item as Record<string, unknown>)
          : item,
    );
  }
  if (typeof value === "object" && value !== null) {
    return maskObject(value as Record<string, unknown>);
  }
  return value;
}

export function maskObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = maskSensitiveValue(key, value);
  }
  return result;
}

const CONTENT_MASK_PATTERNS = [
  /("(?:[^"]*(?:key|token|secret|password|bearer|credential|authorization)[^"]*)":\s*")([^"]{8,})(")/gi,
  /(sk-[a-zA-Z0-9]{5})[a-zA-Z0-9]+([a-zA-Z0-9]{3})/g,
  /(mat_[a-zA-Z0-9]{5})[a-zA-Z0-9_-]+([a-zA-Z0-9]{3})/g,
  /(sh-[a-zA-Z0-9]{3})[a-zA-Z0-9]+/g,
  /(experimental_bearer_token\s*=\s*")([^"]{8,})(")/gi,
  /(env_key\s*=\s*")([^"]{8,})(")/gi,
  /(oauth2:)[a-zA-Z0-9]+(@)/g,
];

export function maskContent(content: string): string {
  let masked = content;
  masked = masked.replace(
    /("(?:[^"]*(?:key|token|secret|password|bearer|credential|authorization)[^"]*)":\s*")([^"]{8,})(")/gi,
    (_, prefix, val, suffix) => `${prefix}${val.slice(0, 3)}***${val.slice(-3)}${suffix}`,
  );
  masked = masked.replace(
    /((?:experimental_bearer_token|env_key)\s*=\s*")([^"]{8,})(")/gi,
    (_, prefix, val, suffix) => `${prefix}${val.slice(0, 3)}***${val.slice(-3)}${suffix}`,
  );
  masked = masked.replace(/(oauth2:)[a-zA-Z0-9]+(@)/g, "$1***$2");
  return masked;
}

export async function readFileIfExists(
  filePath: string,
): Promise<{ exists: boolean; content: string; rawContent: string }> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return { exists: false, content: "", rawContent: "" };
  const rawContent = await file.text();
  return { exists: true, content: maskContent(rawContent), rawContent };
}

export async function getToolVersion(command: string): Promise<string> {
  try {
    const proc = Bun.spawn(command.split(" "), {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const match = output.match(/[\d]+\.[\d]+(?:\.[\d]+)?/);
    return match ? match[0] : "unknown";
  } catch {
    return "not installed";
  }
}

