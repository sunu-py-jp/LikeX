import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { exportedType, numericConstant, schemaFromType } from './skills/schema-generator.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const schemaTargets = [
  { package: 'spreadsheet', type: 'SpreadsheetFile', source: 'src/model/native-file.ts', output: 'spon.schema.json' },
  { package: 'spreadsheet', type: 'SpreadsheetCommand', source: 'src/commands/types.ts', output: 'commands.schema.json',
    limit: { source: 'src/commands/stage-spreadsheet-commands.ts', name: 'MAX_SPREADSHEET_COMMANDS' } },
  { package: 'slide', type: 'SlideFile', source: 'src/model/file-format.ts', output: 'slon.schema.json' },
  { package: 'slide', type: 'SlideCommand', source: 'src/model/types.ts', output: 'commands.schema.json',
    limit: { source: 'src/model/limits.ts', name: 'SLIDE_LIMITS', property: 'commands' } },
  { package: 'document', type: 'DocumentModel', source: 'src/model/types.ts', output: 'dcon.schema.json' },
  { package: 'document', type: 'DocumentCommand', source: 'src/model/types.ts', output: 'commands.schema.json',
    limit: { source: 'src/model/validation.ts', name: 'DOCUMENT_LIMITS', property: 'commands' } },
  { package: 'board', type: 'BoardModel', source: 'src/model/types.ts', output: 'board.schema.json' },
  { package: 'board', type: 'BoardCommand', source: 'src/model/types.ts', output: 'commands.schema.json', limit: { source: 'src/model/board.ts', name: 'BOARD_LIMITS', property: 'commands' } },
  { package: 'dataview', type: 'DataViewModel', source: 'src/model/types.ts', output: 'dataview.schema.json' },
  { package: 'dataview', type: 'DataViewCommand', source: 'src/model/types.ts', output: 'commands.schema.json', limit: { source: 'src/model/data.ts', name: 'DATAVIEW_LIMITS', property: 'commands' } },
  { package: 'diagram', type: 'DiagramModel', source: 'src/model/types.ts', output: 'diagram.schema.json' },
  { package: 'diagram', type: 'DiagramCommand', source: 'src/model/types.ts', output: 'commands.schema.json', limit: { source: 'src/model/commands.ts', name: 'MAX_DIAGRAM_COMMANDS' } },
  { package: 'whiteboard', type: 'WhiteboardModel', source: 'src/model/types.ts', output: 'whiteboard.schema.json' },
  { package: 'whiteboard', type: 'WhiteboardCommand', source: 'src/model/types.ts', output: 'commands.schema.json', limit: { source: 'src/model/commands.ts', name: 'MAX_WHITEBOARD_COMMANDS' } },
  { package: 'calendar', type: 'Calendar', source: 'src/model/types.ts', output: 'calendar.schema.json' },
  { package: 'calendar', type: 'CalendarCommand', source: 'src/model/types.ts', output: 'commands.schema.json', limit: { source: 'src/model/index.ts', name: 'CALENDAR_MAX_COMMANDS' } },
  { package: 'aichat', type: 'AIChatModel', source: 'src/model/types.ts', output: 'aichat.schema.json' },
  { package: 'aichat', type: 'AIChatCommand', source: 'src/model/types.ts', output: 'commands.schema.json', limit: { source: 'src/model/validation.ts', name: 'AICHAT_LIMITS', property: 'commands' } },
  { package: 'chat', type: 'ChatModel', source: 'src/model/types.ts', output: 'chat.schema.json' },
  { package: 'chat', type: 'ChatCommand', source: 'src/model/types.ts', output: 'commands.schema.json', limit: { source: 'src/model/validation.ts', name: 'CHAT_LIMITS', property: 'commands' } },
  { package: 'form', type: 'FormModel', source: 'src/model/types.ts', output: 'form.schema.json' },
  { package: 'form', type: 'FormCommand', source: 'src/model/types.ts', output: 'commands.schema.json', limit: { source: 'src/model/validation.ts', name: 'FORM_LIMITS', property: 'commands' } },
];
const packagePath = (target, file) => `packages/${target.package}/${file}`;
const outputPath = target => packagePath(target, `skills/likex-${target.package}/references/${target.output}`);

export async function generateSkillSchemas({ root = repository } = {}) {
  const configFile = ts.readConfigFile(path.join(root, 'tsconfig.base.json'), ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  if (config.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(config.errors, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  const rootNames = [...new Set(schemaTargets.flatMap(target => [target.source, target.limit?.source]
    .filter(Boolean).map(file => path.join(root, packagePath(target, file)))))];
  // CI checks schemas before building workspace libraries. Resolve the shared
  // package from its sources so generated declarations can never affect output.
  const program = ts.createProgram({ rootNames, options: { ...config.options, noEmit: true,
    paths: { ...config.options.paths,
      '@likex/core': [path.join(root, 'packages/core/src/index.ts')],
      '@likex/core/*': [path.join(root, 'packages/core/src/*')],
    },
  } });
  if (program.getSourceFiles().some(source => /[/\\]packages[/\\][^/\\]+[/\\]dist[/\\]/.test(source.fileName)))
    throw new Error('Schema generation must resolve workspace types from source, never from generated dist files');
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  const checker = program.getTypeChecker();
  const outputs = new Map();
  for (const target of schemaTargets) {
    const source = packagePath(target, target.source);
    const modelType = exportedType(program, path.join(root, source), target.type);
    const metadata = JSON.parse(await readFile(path.join(root, packagePath(target, 'package.json')), 'utf8'));
    const maxItems = target.limit && numericConstant(program, path.join(root, packagePath(target, target.limit.source)),
      target.limit.name, target.limit.property);
    const schema = schemaFromType(checker, modelType, {
      title: target.type + (target.limit ? '[]' : ''), maxItems,
      comment: `Generated by scripts/build-skill-schemas.mjs (generator v1; TypeScript ${ts.version}; ${metadata.name} ${metadata.version}) from ${source}#${target.type}. Do not edit. Structural JSON constraints only; runtime parsers and command APIs are authoritative for limits, references, and semantic validity. Undefined alternatives are omitted because JSON cannot represent undefined.`,
    });
    outputs.set(outputPath(target), JSON.stringify(schema, null, 2) + '\n');
  }
  return outputs;
}

export async function buildSkillSchemas({ root = repository, check = false } = {}) {
  const outputs = await generateSkillSchemas({ root });
  const stale = [];
  for (const [file, text] of outputs) {
    const destination = path.join(root, file);
    let current;
    try { current = await readFile(destination, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === text) continue;
    if (check) stale.push(file);
    else { await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, text); }
  }
  if (stale.length) throw new Error(`Skill schemas are stale. Run node scripts/build-skill-schemas.mjs:\n${stale.join('\n')}`);
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Usage: node scripts/build-skill-schemas.mjs [--check]');
  const check = process.argv.includes('--check');
  const outputs = await buildSkillSchemas({ check });
  console.log(`${check ? 'Verified' : 'Generated'} ${outputs.size} skill JSON Schemas from TypeScript model and command types.`);
}
