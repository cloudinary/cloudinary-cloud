import type { CreateOptions } from '../commands/create.js';

export type ParsedArgs =
  | { kind: 'create'; options: CreateOptions }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

/**
 * Hand-rolled argv parser — the CLI has one command and seven flags, which is
 * not worth a runtime dependency. Supports `--flag value` and `--flag=value`,
 * and `--ip` may repeat.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const options: CreateOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inlineValue: string | undefined;

    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq !== -1) {
      inlineValue = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }

    const takeValue = (): string | { error: string } => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[++i];
      if (next === undefined || next.startsWith('-')) return { error: `${arg} requires a value` };
      return next;
    };

    switch (arg) {
      case '-h': case '--help':
        return { kind: 'help' };
      case '-V': case '--version':
        return { kind: 'version' };
      case '--ip': {
        const v = takeValue();
        if (typeof v !== 'string') return { kind: 'error', message: v.error };
        options.ip = [...(options.ip ?? []), v];
        break;
      }
      case '--email': {
        const v = takeValue();
        if (typeof v !== 'string') return { kind: 'error', message: v.error };
        options.email = v;
        break;
      }
      case '--api-host': {
        const v = takeValue();
        if (typeof v !== 'string') return { kind: 'error', message: v.error };
        options.apiHost = v;
        break;
      }
      case '--force':
        options.force = true;
        break;
      case '--no-env':
        options.env = false;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        if (arg.startsWith('-')) return { kind: 'error', message: `Unknown option: ${arg}` };
        positionals.push(arg);
    }
  }

  // `create` is the default command; `claim` and `status` are planned.
  if (positionals.length === 0 || (positionals.length === 1 && positionals[0] === 'create')) {
    return { kind: 'create', options };
  }
  const unknown = positionals.find(p => p !== 'create') ?? positionals[1];
  return { kind: 'error', message: `Unknown command: ${unknown}` };
}

export const HELP_TEXT = `One command, and your media is live on Cloudinary.

Usage: cloudinary-sandbox [create] [options]

Commands:
  create (default)     provision a disposable Cloudinary sandbox account — no
                       signup, no credentials needed. Writes CLOUDINARY_URL to
                       ./.env and prints a claim URL a human can open later to
                       keep the account.

Options:
  --ip <address>       public IP allowed to view delivered media (repeatable,
                       max 3, "requester_ip" for your own); defaults to your own IP
  --email <address>    pre-fill the claim page with this email (never verified
                       at creation)
  --force              replace an existing CLOUDINARY_URL in ./.env
  --no-env             do not write ./.env — credentials are only printed
  --json               print the raw provisioning response as JSON
  --api-host <url>     override the Cloudinary API host (or set CLOUDINARY_API_HOST)
  -V, --version        print the version
  -h, --help           show this help
`;
