/**
 * Minimal ANSI color helpers — replaces picocolors so the published package
 * has zero runtime dependencies. Colors are disabled when stdout is not a TTY,
 * when NO_COLOR is set (https://no-color.org), or when TERM=dumb; FORCE_COLOR
 * overrides all of that.
 */

const enabled = (() => {
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === 'dumb') return false;
  return process.stdout.isTTY === true;
})();

const ESC = '\u001b';


function wrap(open: number, close: number): (text: string) => string {
  if (!enabled) return text => text;
  return text => `${ESC}[${open}m${text}${ESC}[${close}m`;
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const underline = wrap(4, 24);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);
