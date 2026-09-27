import * as path from 'node:path';
import { convert } from './convert';
import { SOURCES, findSource } from './sources';

// yarn workspace server convert <source> --input <file or folder> --out <folder> [--version <v>] [--limit <n>]
//
// Turns a public dictionary source into a dataset of the project's format
// (issue #527): the folder it writes is what the import reads — upload it
// as files, zip it, or put it under DICTIONARY_IMPORT_DIR.

const usage = (): string =>
  [
    'Usage: yarn workspace server convert <source> --input <path> --out <folder> [options]',
    '',
    'Sources:',
    ...SOURCES.map((source) => `  ${source.name.padEnd(12)}${source.description}`),
    '',
    'Options:',
    '  --input <path>    the file the source distributes, as it is downloaded (or the folder it unpacks into)',
    '  --out <folder>    where the dataset is written (created when missing)',
    '  --version <v>     the version of the dataset; the day of the conversion by default',
    '  --limit <n>       stop after n records of the source, for a trial run',
    '  --<name> <value>  an option of the source, e.g. --cmudict cmudict.dict',
  ].join('\n');

const parseArgs = (argv: string[]): { source?: string; flags: Record<string, string> } => {
  const flags: Record<string, string> = {};
  let source: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) flags[arg.slice(2)] = 'true';
      else {
        flags[arg.slice(2)] = value;
        index += 1;
      }
    } else if (!source) source = arg;
  }
  return { source, flags };
};

const main = async (): Promise<number> => {
  const { source: name, flags } = parseArgs(process.argv.slice(2));
  if (!name || flags.help) {
    console.log(usage());
    return name ? 0 : 1;
  }
  const source = findSource(name);
  if (!source) {
    console.error(`Unknown source "${name}". Known: ${SOURCES.map((item) => item.name).join(', ')}`);
    return 1;
  }
  const { input, out, version, limit, ...sourceOptions } = flags;
  if (!input || !out) {
    console.error('--input and --out are required\n');
    console.error(usage());
    return 1;
  }
  if (limit !== undefined && !/^\d+$/.test(limit)) {
    console.error(`--limit takes a number of records, got "${limit}"`);
    return 1;
  }

  const outDir = path.resolve(out);
  const startedAt = Date.now();
  const summary = await convert({
    source,
    input: path.resolve(input),
    outDir,
    version,
    limit: limit === undefined ? undefined : Number(limit),
    // the paths a source option names are relative to where the command runs
    sourceOptions: Object.fromEntries(
      Object.entries(sourceOptions).map(([key, value]) => [
        key,
        key === 'cmudict' ? path.resolve(value) : value,
      ]),
    ),
    log: (message) => console.log(`  ${message}`),
  });

  console.log(`\n${source.name} → ${outDir}`);
  console.log(
    `  ${summary.entries} entries, ${summary.meanings} meanings, version ${summary.manifest.version}`,
  );
  console.log(`  license ${summary.manifest.license}: ${summary.manifest.attribution}`);
  for (const [file, { lines }] of Object.entries(summary.manifest.files)) console.log(`  ${file}: ${lines}`);
  const skipped = Object.entries(summary.skipped);
  if (skipped.length) {
    console.log(`  left out: ${skipped.map(([reason, count]) => `${count} ${reason}`).join(', ')}`);
  }
  if (summary.late_duplicates) console.log(`  ${summary.late_duplicates} repeated entries left out`);
  console.log(`  ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  console.log(
    "\nThe folder is a dataset of the project's format: the import page takes it (the files, or the folder " +
      'zipped) into the dataset of this source. On an instance, the datasets page installs the file itself.',
  );
  return 0;
};

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
