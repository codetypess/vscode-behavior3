import { formatConsoleArgs, getBehavior3OutputChannel } from "./outputChannel";

let installed = false;

/**
 * Mirror extension-host `console.log` / `console.info` / `console.warn` / `console.error` to the Behavior3 Output channel
 * (in addition to the default DevTools / debug console), for easier debugging.
 */
export function installExtensionConsoleToOutputChannel(): void {
  if (installed) {
    return;
  }
  installed = true;

  const out = getBehavior3OutputChannel();
  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    origLog(...args);
    try {
      out.info(formatConsoleArgs(args));
    } catch {
      /* ignore */
    }
  };

  console.info = (...args: unknown[]) => {
    origInfo(...args);
    try {
      out.info(formatConsoleArgs(args));
    } catch {
      /* ignore */
    }
  };

  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    try {
      out.warn(formatConsoleArgs(args));
    } catch {
      /* ignore */
    }
  };

  console.error = (...args: unknown[]) => {
    origError(...args);
    try {
      out.error(formatConsoleArgs(args));
    } catch {
      /* ignore */
    }
  };
}
