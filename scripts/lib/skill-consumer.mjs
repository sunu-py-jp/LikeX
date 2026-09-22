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
    const extension = ({ slide: 'slon', spreadsheet: 'spon', document: 'dcon' }[module] ?? 'json');
    const file = path.join(directory, `sample.${extension}`);
    const execute = async (entry, args) => JSON.parse(await run(process.execPath, [entry, ...args], { cwd: directory, capture: true }));
    const created = await execute(script, ['create', '--output', file]);
    assert.equal(created.ok, true);
    const initial = JSON.parse(await readFile(file, 'utf8'));
    const commands = {
      slide: () => [{ type: 'element.add', slideId: initial.slides[0].id, element: { type: 'text', id: 'skill-heading', text: 'Skill consumer', x: 80, y: 40 } }],
      document: () => [{ type: 'text.insert', from: 1, text: 'Skill consumer' }],
      spreadsheet: () => [{ type: 'cells.set', sheetId: initial.sheets[0].id, values: { A1: 'Skill consumer', B1: '42' } },
        { type: 'dimensions.autoFit', sheetId: initial.sheets[0].id, axis: 'column', indices: [0] }],
      board: () => [{ type: 'card.add', columnId: initial.columns[0].id, card: { id: 'skill-card', title: 'Skill consumer' } }],
      dataview: () => [{ type: 'field.add', field: { id: 'skill-field', name: 'Skill consumer', type: 'text' } }, { type: 'row.add', row: { id: 'skill-row', values: { 'skill-field': 'Skill consumer' } } }],
      diagram: () => [{ type: 'node.add', node: { id: 'skill-node', text: 'Skill consumer' } }],
      whiteboard: () => [{ type: 'element.add', element: { id: 'skill-element', kind: 'sticky', text: 'Skill consumer' } }],
      calendar: () => [{ type: 'event.create', event: { id: 'skill-event', title: 'Skill consumer', allDay: true, start: '2026-09-22', end: '2026-09-23' } }],
      aichat: () => [{ type: 'message.add', conversationId: initial.conversations[0].id, message: { id: 'skill-message', role: 'user', content: 'Skill consumer', createdAt: '2026-09-22T00:00:00.000Z' } }],
      chat: () => [{ type: 'message.add', conversationId: initial.conversations[0].id, message: { id: 'skill-message', authorId: initial.participants[0].id, text: 'Skill consumer', createdAt: '2026-09-22T00:00:00.000Z' } }],
      form: () => [{ type: 'field.add', field: { id: 'skill-field', type: 'text', label: 'Skill consumer' } }],
    }[module]();
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
    } else if (module === 'document') assert.equal(saved.content.content[0].content[0].text, 'Skill consumer');
    else if (module === 'spreadsheet') {
      assert.equal(saved.sheets[0].rows[0].cells.A.value, 'Skill consumer');
      assert.ok(saved.sheets[0].columnWidths?.[0] > 0, 'the packaged skill applies automatic column sizing');
    } else {
      const content = {
        board: () => saved.columns[0].cards[0].title, dataview: () => saved.rows[0].values['skill-field'],
        diagram: () => saved.nodes[0].text, whiteboard: () => saved.elements[0].text,
        calendar: () => saved.events[0].title, chat: () => saved.conversations[0].messages[0].text, aichat: () => saved.conversations[0].messages[0].content,
        form: () => saved.fields[0].label,
      }[module]();
      assert.equal(content, 'Skill consumer');
    }
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
