export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgMagenta: "\x1b[45m",
  bgYellow: "\x1b[43m",
};

export const LEVEL_COLORS: Record<string, string> = {
  global: c.blue,
  user: c.green,
  project: c.magenta,
  local: c.yellow,
};
