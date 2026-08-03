#!/usr/bin/env node

import { createCommand } from './commands/create.js';
import { parseArgs, HELP_TEXT } from './lib/args.js';
import { getPackageInfo } from './lib/version.js';

const parsed = parseArgs(process.argv.slice(2));

switch (parsed.kind) {
  case 'help':
    console.log(HELP_TEXT);
    break;
  case 'version':
    console.log(getPackageInfo().version);
    break;
  case 'error':
    console.error(`Error: ${parsed.message}`);
    console.error('Run "cloudinary-cloud --help" for usage.');
    process.exit(2);
    break;
  case 'create':
    await createCommand(parsed.options);
    break;
}
