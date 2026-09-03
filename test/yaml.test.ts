/*
 * The YAML reader and the arithmetic in a data file.
 *
 * A parser you wrote yourself is only worth having if it is loud about what it
 * does not support, so half of what is checked here is the REFUSALS: a tab
 * used as indentation, an anchor, a second document, a duplicate key. Each of
 * those has a silent mis-reading available to it, and a silent mis-reading in
 * an asset file is a character drawn slightly wrong with nothing to point at.
 */

import { describe, expect, it } from 'vitest';

import { evaluateExpression, expressionNames, parseYaml } from '@hexdelve/shared';

const lines = (...text: readonly string[]): string => text.join('\n');

describe('parseYaml', () => {
	it('reads a nested block mapping', () => {
		expect(parseYaml(lines('a: 1', 'b:', '  c: two', '  d: true'))).toEqual({
			a: 1,
			b: { c: 'two', d: true },
		});
	});

	it('lets a sequence sit at its own key’s indentation', () => {
		expect(parseYaml(lines('items:', '- one', '- two'))).toEqual({ items: ['one', 'two'] });
		expect(parseYaml(lines('items:', '  - one', '  - two'))).toEqual({ items: ['one', 'two'] });
	});

	it('reads a mapping whose first key shares the dash’s line', () => {
		const value = parseYaml(lines('bones:', '  - name: root', '    offset: [0, 1, 0]', '  - name: spine'));
		expect(value).toEqual({ bones: [{ name: 'root', offset: [0, 1, 0] }, { name: 'spine' }] });
	});

	it('reads nested flow collections', () => {
		expect(parseYaml('a: { b: [1, 2, { c: 3 }], d: [] }')).toEqual({
			a: { b: [1, 2, { c: 3 }], d: [] },
		});
	});

	it('keeps a colon and a comma inside a plain block scalar', () => {
		expect(parseYaml('hint: Calibrated, so the number means what it says')).toEqual({
			hint: 'Calibrated, so the number means what it says',
		});
	});

	it('reads 0x, so a colour stays written the way it was authored', () => {
		expect(parseYaml('steel: 0x4a5058')).toEqual({ steel: 0x4a5058 });
	});

	it('reads the other scalar shapes', () => {
		expect(parseYaml(lines('a: -1.5e3', 'b: .5', 'c: ~', 'd: null', 'e: false', "f: 'x: y'"))).toEqual({
			a: -1500,
			b: 0.5,
			c: null,
			d: null,
			e: false,
			f: 'x: y',
		});
	});

	it('strips comments outside quotes and keeps them inside', () => {
		expect(parseYaml(lines('# a whole line', 'a: 1 # trailing', 'b: "# not a comment"'))).toEqual({
			a: 1,
			b: '# not a comment',
		});
	});

	it('reads a literal and a folded block scalar', () => {
		expect(parseYaml(lines('a: |', '  one', '  two'))).toEqual({ a: 'one\ntwo\n' });
		expect(parseYaml(lines('a: >-', '  one', '  two'))).toEqual({ a: 'one two' });
	});

	it('ignores one leading document marker', () => {
		expect(parseYaml(lines('---', 'a: 1'))).toEqual({ a: 1 });
	});

	it('refuses a tab used as indentation', () => {
		expect(() => parseYaml(lines('a:', '\tb: 1'))).toThrow(/tabs may not indent/);
	});

	it('refuses anchors, aliases, tags and directives', () => {
		expect(() => parseYaml('a: &anchor 1')).toThrow(/anchors and aliases/);
		expect(() => parseYaml('a: *alias')).toThrow(/anchors and aliases/);
		expect(() => parseYaml('a: !tag 1')).toThrow(/tags are not supported/);
		expect(() => parseYaml('%YAML 1.2')).toThrow(/directives/);
	});

	it('refuses a second document', () => {
		expect(() => parseYaml(lines('a: 1', '---', 'b: 2'))).toThrow(/one document per file/);
	});

	it('refuses a duplicate key, in block and in flow', () => {
		expect(() => parseYaml(lines('a: 1', 'a: 2'))).toThrow(/duplicate key 'a'/);
		expect(() => parseYaml('x: { a: 1, a: 2 }')).toThrow(/duplicate key 'a'/);
	});

	it('names the file and the line when it fails', () => {
		expect(() => parseYaml(lines('a: 1', 'b: &c'), 'thing.yaml')).toThrow(/thing\.yaml:2:/);
	});
});

describe('evaluateExpression', () => {
	it('gives the same double as the TypeScript it replaces', () => {
		expect(evaluateExpression('pi / 2 + 0.05')).toBe(Math.PI / 2 + 0.05);
		expect(evaluateExpression('tau / 1.8')).toBe((Math.PI * 2) / 1.8);
		expect(evaluateExpression('deg(-12)')).toBe((-12 * Math.PI) / 180);
		expect(evaluateExpression('cos(pi / 6) * 0.26 * 0.86')).toBe(Math.cos(Math.PI / 6) * 0.26 * 0.86);
	});

	it('binds * and / tighter than + and -, left to right', () => {
		expect(evaluateExpression('1 + 2 * 3')).toBe(7);
		expect(evaluateExpression('(1 + 2) * 3')).toBe(9);
		expect(evaluateExpression('8 / 4 / 2')).toBe(1);
		expect(evaluateExpression('-2 - -3')).toBe(1);
	});

	it('reads names out of the scope it is given', () => {
		expect(evaluateExpression('radius * 1.07', { radius: 0.26 })).toBe(0.26 * 1.07);
	});

	it('names the alternatives when a name is unknown', () => {
		expect(() => evaluateExpression('widht * 2', { width: 1 })).toThrow(/unknown name 'widht'/);
		expect(() => evaluateExpression('widht * 2', { width: 1 })).toThrow(/width/);
	});

	it('refuses anything that is not arithmetic', () => {
		expect(() => evaluateExpression('1 + ')).toThrow(/ended early/);
		expect(() => evaluateExpression('(1 + 2')).toThrow(/expected \)/);
		expect(() => evaluateExpression('sin 1')).toThrow(/needs brackets/);
	});

	it('lists the names an expression uses, for a loader that checks early', () => {
		expect(expressionNames('cos(mount) * out + pi').sort()).toEqual(['mount', 'out']);
	});
});
