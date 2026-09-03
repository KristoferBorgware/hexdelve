/*
 * The numbers a prop does not have yet.
 *
 * Props in this project are meshes. There is no item system, nothing reads a
 * damage die, and nothing here is written anywhere — this is a mock, and the
 * inspector says so on screen rather than letting anyone find out the hard
 * way. It is here because a catalogue you can already look through is the
 * cheapest place to argue about what the numbers should BE, and arguing about
 * a form is far easier than arguing about a schema.
 *
 * So the shape is the part worth getting right, and it is deliberately data:
 * a prop's stats are a flat record, and what the panel draws is a list of
 * field descriptions. Adding a stat is one line in a table below and no change
 * to the inspector at all, which is the property that has to hold before any
 * of this can be pointed at a real item definition.
 *
 * The fields themselves are lifted off `docs/angband`, because that is what
 * this game's rules are being drawn from: a weapon is dice, sides, to-hit and
 * to-dam; armour is a base AC and a bonus; weight is in pounds and matters to
 * criticals and to blows; depth and rarity decide where a thing turns up. They
 * are placeholders, but they are placeholders shaped like the real thing.
 */

import type { BenchProp } from './props.js';

export type PropStatValue = number | string | boolean;
export type PropStats = Record<string, PropStatValue>;

export interface PropStatField {
	readonly key: string;
	readonly label: string;
	readonly kind: 'number' | 'text' | 'choice' | 'flag';
	/** Shown under the field, for the ones whose meaning is not obvious. */
	readonly hint?: string;
	/** Appended to the label, since a number with no unit means nothing. */
	readonly unit?: string;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly choices?: readonly string[];
}

export interface PropStatGroup {
	readonly id: string;
	readonly label: string;
	readonly fields: readonly PropStatField[];
}

export const RARITIES = ['common', 'uncommon', 'rare', 'artefact'] as const;

const IDENTITY: PropStatGroup = {
	id: 'identity',
	label: 'Identity',
	fields: [
		{ key: 'name', label: 'Name', kind: 'text' },
		{ key: 'rarity', label: 'Rarity', kind: 'choice', choices: RARITIES },
		{
			key: 'depth',
			label: 'Depth',
			kind: 'number',
			min: 0,
			max: 100,
			step: 1,
			hint: 'First level it appears on',
		},
		{ key: 'value', label: 'Value', kind: 'number', min: 0, step: 5, unit: 'gp' },
	],
};

const HANDLING: PropStatGroup = {
	id: 'handling',
	label: 'Handling',
	fields: [
		{
			key: 'weight',
			label: 'Weight',
			kind: 'number',
			min: 0,
			step: 0.1,
			unit: 'lb',
			hint: 'Crits harder, swings slower',
		},
		{ key: 'durability', label: 'Durability', kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
		{ key: 'cursed', label: 'Cursed', kind: 'flag' },
	],
};

const WEAPON: PropStatGroup = {
	id: 'weapon',
	label: 'Blows',
	fields: [
		{ key: 'dice', label: 'Damage dice', kind: 'number', min: 1, max: 12, step: 1 },
		{ key: 'sides', label: 'Die sides', kind: 'number', min: 1, max: 20, step: 1 },
		{ key: 'toHit', label: 'To-hit', kind: 'number', step: 1 },
		{ key: 'toDam', label: 'To-dam', kind: 'number', step: 1 },
		{ key: 'twoHanded', label: 'Two-handed', kind: 'flag' },
	],
};

const ARMOUR: PropStatGroup = {
	id: 'armour',
	label: 'Protection',
	fields: [
		{ key: 'ac', label: 'Base AC', kind: 'number', min: 0, step: 1 },
		{ key: 'toAc', label: 'To-AC', kind: 'number', step: 1 },
	],
};

const SHIELD: PropStatGroup = {
	id: 'armour',
	label: 'Protection',
	fields: [
		...ARMOUR.fields,
		{
			key: 'block',
			label: 'Block',
			kind: 'number',
			min: 0,
			max: 100,
			step: 1,
			unit: '%',
			hint: 'A bash turning a blow',
		},
	],
};

/** Which groups a prop's kind asks for. Order is the order the panel draws. */
export function statGroups(prop: BenchProp): readonly PropStatGroup[] {
	switch (prop.kind) {
		case 'weapon':
			return [IDENTITY, WEAPON, HANDLING];
		case 'shield':
			return [IDENTITY, SHIELD, HANDLING];
		case 'armour':
			return [IDENTITY, ARMOUR, HANDLING];
	}
}

/*
 * Starting numbers, so the form comes up looking like an item rather than like
 * a pile of zeroes. They are guesses of the right order of magnitude — a
 * long sword in Angband is 2d5 and about three pounds — and nothing depends on
 * them being right, which is the point of being able to edit them here.
 */
const DEFAULTS: Record<string, PropStats> = {
	helmet: {
		name: 'Nasal helm',
		rarity: 'common',
		depth: 3,
		value: 30,
		ac: 2,
		toAc: 0,
		weight: 4.5,
		durability: 100,
		cursed: false,
	},
	sword: {
		name: 'Long sword',
		rarity: 'common',
		depth: 5,
		value: 120,
		dice: 2,
		sides: 5,
		toHit: 0,
		toDam: 0,
		twoHanded: false,
		weight: 3,
		durability: 100,
		cursed: false,
	},
	shield: {
		name: 'Round shield',
		rarity: 'common',
		depth: 4,
		value: 60,
		ac: 3,
		toAc: 0,
		block: 12,
		weight: 5,
		durability: 100,
		cursed: false,
	},
};

/**
 * The stats a prop starts with — every field its groups declare, whether or
 * not the table above remembered to give it one.
 */
export function defaultStats(prop: BenchProp): PropStats {
	const stats: PropStats = {};
	const given = DEFAULTS[prop.id] ?? {};

	for (const group of statGroups(prop)) {
		for (const field of group.fields) {
			const value = given[field.key];
			if (value !== undefined) {
				stats[field.key] = value;
				continue;
			}
			stats[field.key] =
				field.kind === 'flag'
					? false
					: field.kind === 'choice'
						? (field.choices?.[0] ?? '')
						: field.kind === 'text'
							? prop.label
							: 0;
		}
	}

	return stats;
}

/** Whether a prop's stats have been touched since they were handed out. */
export function isEdited(prop: BenchProp, stats: PropStats): boolean {
	const base = defaultStats(prop);
	const keys = new Set([...Object.keys(base), ...Object.keys(stats)]);
	for (const key of keys) {
		if (base[key] !== stats[key]) return true;
	}
	return false;
}
