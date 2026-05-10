#!/usr/bin/env node

import { installStartupProfileReporter, profileMark, profileSpan } from './startup-profile.js';

installStartupProfileReporter();
profileMark('bin:entry');
const { runKloCli } = await profileSpan('import ./cli-runtime.js', () => import('./cli-runtime.js'));
profileMark('bin:runKloCli');
process.exitCode = await runKloCli(process.argv.slice(2));
