import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { libraryModule } from './modules.mjs';
import { run } from './run.mjs';

/** Exercise the skill shipped in the tarball, including a copy outside the installing project. */
export async function checkSkillConsumer({ module, installed, consumer }) {
  const { skillName } = libraryModule(module);
  if (!skillName) return undefined;
  const directory = await mkdtemp(path.join(tmpdir(), `likex-${module}-skill-consumer-`));
  try {
    const skill = path.join(installed, 'skills', skillName);
    const script = path.join(skill, 'scripts/document.mjs');
    const extension = module === 'slide' ? 'slon' : 'spon';
    const file = path.join(directory, `sample.${extension}`);
    const execute = async (entry, args) => JSON.parse(await run(process.execPath, [entry, ...args], { cwd: directory, capture: true }));
    const created = await execute(script, ['create', '--output', file]);
    assert.equal(created.ok, true);
    const initial = JSON.parse(await readFile(file, 'utf8'));
    const commands = module === 'slide'
      ? [{ type: 'element.add', slideId: initial.slides[0].id, element: { type: 'text', id: 'skill-heading', text: 'Skill consumer', x: 80, y: 40 } }]
      : [{ type: 'cells.set', sheetId: initial.sheets[0].id, values: { A1: 'Skill consumer', B1: '42' } }];
    const commandFile = path.join(directory, 'commands.json');
    await writeFile(commandFile, JSON.stringify(commands));
    const before = await readFile(file, 'utf8');
    const dry = await execute(script, ['apply', '--input', file, '--commands', commandFile, '--dry-run']);
    assert.equal(dry.ok, true); assert.equal(dry.written, false);
    assert.equal(await readFile(file, 'utf8'), before);
    const applied = await execute(script, ['apply', '--input', file, '--commands', commandFile, '--output', file]);
    assert.equal(applied.ok, true); assert.equal(applied.written, true);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (module === 'slide') {
      assert.equal(saved.slides[0].elements[0].text, 'Skill consumer');
      assert.equal(saved.slides[0].elements[0].stackOrder, 0);
    } else assert.equal(saved.sheets[0].rows[0].cells.A.value, 'Skill consumer');
    assert.equal((await execute(script, ['validate', '--input', file])).valid, true);

    const copied = path.join(directory, skillName);
    await cp(skill, copied, { recursive: true });
    const copiedScript = path.join(copied, 'scripts/document.mjs');
    assert.equal((await execute(copiedScript, ['inspect', '--input', file, '--project', consumer])).ok, true);
    const committed = await readFile(file, 'utf8');
    await writeFile(commandFile, JSON.stringify([{ type: 'not-a-command' }]));
    await assert.rejects(execute(copiedScript, ['apply', '--input', file, '--commands', commandFile, '--output', file, '--project', consumer]));
    assert.equal(await readFile(file, 'utf8'), committed);
    return { skillName, nativeFormat: extension, createApplyValidate: 'passed', copiedSkill: 'passed', failedWritePreservesInput: 'passed' };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
