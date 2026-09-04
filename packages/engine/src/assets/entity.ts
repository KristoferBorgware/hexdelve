/*
 * The entity file: the root that ties one asset together.
 *
 * Everything else in this directory reads one kind of thing. This reads the
 * file that says which of them belong to each other — a rig, a body hung on
 * it, the animations that pose it, the trees that drive them — because that
 * grouping was itself scattered across code: a rig module, a model module, a
 * clip module, and an entry in the editor's bench listing all four. Adding the
 * hellhound touched five files and none of them was about a hellhound.
 *
 *   id: wanderer
 *   kind: character
 *   rig: ../rigs/humanoid.rig.yaml
 *   mesh: ../meshes/wanderer.mesh.yaml
 *   animations: { walk: {...}, guard: ../clips/guard.clip.yaml }
 *   blendTrees: { locomotion: ../trees/locomotion.tree.yaml }
 *
 * A PROP is the same file with less in it. A helmet is an entity — it is a
 * thing in the world with a mesh — but it has no rig, no animations and no
 * blend trees, because the whole of wearing one is which transform its parts
 * are drawn through: its own, or a bone's. What it has instead is `attach`,
 * naming the rig it was modelled against and the bone it hangs from, and
 * `ground`, the two numbers that put it down in the grass. Those are refused
 * on a character and the character's four are refused on a prop, which is the
 * schema earning its keep: "props have no rig" stops being a convention
 * somebody remembers and becomes a thing the loader says.
 *
 * WHY THE BLEND TREES LINK ANIMATIONS AND NOT THE OTHER WAY ROUND. A tree
 * refers to `walk`, and the entity is what says what `walk` is. That way the
 * files that list paths are exactly one — this one — and a tree is a pure
 * arrangement over named leaves, so the locomotion tree is the same file for
 * the wanderer and the ghoul. The alternative, a tree that carries its own
 * clip paths, would have the entity and the tree both naming files and both
 * able to disagree about which walk was meant.
 */

import { Node } from './document.js';
import type { AnimationAsset } from './animation.js';
import type { BlendTreeAsset } from './blendtree.js';
import type { MeshAsset } from './mesh.js';
import { emptyPrefab, readPrefabNode, type PrefabNode } from './prefab.js';
import type { RigAsset, RigView } from './rig.js';

export type EntityKind = 'character' | 'prop';

/** Where a prop hangs when it is worn. */
export interface Attachment {
	/** The rig it was modelled against — the one it borrows bone names from. */
	readonly rig: RigAsset;
	readonly bone: string;
}

/** How a prop lies when it is put down. */
export interface Grounding {
	/** How far to raise it so it rests on the grass rather than in it. */
	readonly lift: number;
	/** Rotation about X: 0 stands it up, pi/2 lays it flat. */
	readonly tilt: number;
}

export interface EntityAsset {
	readonly id: string;
	readonly name: string;
	readonly kind: EntityKind;
	/** A character's own rig. Null on a prop, which has none. */
	readonly rig: RigAsset | null;
	readonly mesh: MeshAsset;
	readonly animations: ReadonlyMap<string, AnimationAsset>;
	readonly blendTrees: ReadonlyMap<string, BlendTreeAsset>;
	readonly attach: Attachment | null;
	readonly ground: Grounding | null;
	/** Where to look and how far back to stand, for a bench or a preview. */
	readonly view: RigView;
	/** Free-form labels: `armour`, `weapon`, whatever the game turns out to want. */
	readonly tags: readonly string[];
	/** One line for a catalogue row — what the thing actually is. */
	readonly blurb: string | null;
	/**
	 * What this is when it is standing in the world: an object, what is
	 * attached to it, and what hangs under it.
	 *
	 * Never null. A file that says nothing gets one object named after the
	 * entity with nothing on it, because "a thing with no components" is a
	 * real answer and an absent prefab is not — every entity can be spawned.
	 */
	readonly prefab: PrefabNode;
}

export const ENTITY_KEYS = [
	'id',
	'name',
	'kind',
	'notes',
	'blurb',
	'tags',
	'rig',
	'mesh',
	'animations',
	'blendTrees',
	'attach',
	'ground',
	'view',
	'object',
] as const;

/** What the entity file says, before any of it has been fetched. */
export interface EntityDocument {
	readonly id: string;
	readonly name: string;
	readonly kind: EntityKind;
	readonly blurb: string | null;
	readonly tags: readonly string[];
	/** Paths, relative to the entity file. */
	readonly rig: string | null;
	readonly mesh: string;
	readonly animations: readonly AnimationRequest[];
	readonly blendTrees: readonly { readonly name: string; readonly path: string }[];
	readonly attach: { readonly rig: string; readonly bone: string } | null;
	readonly ground: Grounding | null;
	readonly view: Partial<RigView>;
	readonly prefab: PrefabNode;
}

/** One entry of the `animations` mapping, as read. */
export type AnimationRequest = ClipRequest | ProceduralRequest;

interface RequestBase {
	readonly name: string;
	readonly label: string | null;
	readonly sync: boolean | null;
}

export interface ClipRequest extends RequestBase {
	readonly kind: 'clip';
	readonly path: string;
	readonly contacts: readonly number[] | null;
}

export interface ProceduralRequest extends RequestBase {
	readonly kind: 'procedural';
	readonly procedural: string;
	readonly args: Readonly<Record<string, number>>;
	readonly duration: number | null;
	readonly contacts: readonly number[] | null;
}

const ATTACH_KEYS = ['rig', 'bone'] as const;
const GROUND_KEYS = ['lift', 'tilt'] as const;
const CLIP_ENTRY_KEYS = ['clip', 'label', 'sync', 'contacts'] as const;
const PROCEDURAL_ENTRY_KEYS = ['procedural', 'args', 'duration', 'contacts', 'label', 'sync'] as const;

export function readEntity(source: string, file: string): EntityDocument {
	const root = Node.parse(source, file).only(...ENTITY_KEYS);
	const id = root.need('id').text();
	const kind = root.get('kind').present
		? root.need('kind').choice(['character', 'prop'] as const)
		: 'character';

	/*
	 * The two shapes are enforced rather than merely documented. A prop with a
	 * blend tree is not a prop, and the useful moment to say so is now, not
	 * when something tries to pose a helmet.
	 */
	const prop = kind === 'prop';
	for (const key of prop ? (['rig', 'animations', 'blendTrees'] as const) : (['attach', 'ground'] as const)) {
		const node = root.get(key);
		if (node.present) {
			node.fail(
				prop
					? `a prop has no ${key}: wearing one is which transform its parts are drawn ` +
							'through, so it needs `attach` and `ground` instead'
					: `'${key}' belongs to a prop; a character wears things rather than being worn`,
			);
		}
	}

	const attachNode = root.get('attach');
	if (prop && !attachNode.present) root.need('attach');
	if (!prop && !root.get('rig').present) root.need('rig');

	const groundNode = root.get('ground').only(...GROUND_KEYS);
	const view = root.get('view').only('focusY', 'frameDistance');
	const blurb = root.get('blurb');

	return {
		id,
		name: root.get('name').textOr(id),
		kind,
		blurb: blurb.present ? blurb.text().trim() : null,
		tags: root
			.get('tags')
			.listOrEmpty()
			.map((tag) => tag.text()),
		rig: prop ? null : root.need('rig').text(),
		mesh: root.need('mesh').text(),
		animations: readAnimations(root.get('animations')),
		blendTrees: root
			.get('blendTrees')
			.entriesOrEmpty()
			.map(([name, child]) => ({ name, path: child.text() })),
		attach: attachNode.present
			? {
					rig: attachNode.only(...ATTACH_KEYS).need('rig').text(),
					bone: attachNode.need('bone').text(),
				}
			: null,
		ground: groundNode.present
			? { lift: groundNode.get('lift').numberOr(0), tilt: groundNode.get('tilt').numberOr(0) }
			: null,
		view: {
			...(view.get('focusY').present ? { focusY: view.need('focusY').number() } : {}),
			...(view.get('frameDistance').present
				? { frameDistance: view.need('frameDistance').number() }
				: {}),
		},
		prefab: root.get('object').present
			? readPrefabNode(root.need('object'), id)
			: emptyPrefab(id),
	};
}

/**
 * The animations, as requests.
 *
 * A bare string is a clip file, which is the common case and not worth making
 * anyone spell out. A mapping is either the same thing with options on it or a
 * pose function with its arguments — see poseFunctions.ts for why the second
 * kind cannot be a file and should not try.
 */
function readAnimations(node: Node): AnimationRequest[] {
	return node.entriesOrEmpty().map(([name, child]) => {
		if (!child.isMap) {
			return { kind: 'clip', name, path: child.text(), label: null, sync: null, contacts: null };
		}

		const label = child.get('label');
		const sync = child.get('sync');
		const contacts = child.get('contacts');
		const base = {
			name,
			label: label.present ? label.text() : null,
			sync: sync.present ? sync.flag(false) : null,
			contacts: contacts.present ? contacts.list().map((phase) => phase.number()) : null,
		};

		if (child.get('procedural').present) {
			child.only(...PROCEDURAL_ENTRY_KEYS);
			const duration = child.get('duration');
			return {
				...base,
				kind: 'procedural',
				procedural: child.need('procedural').text(),
				args: child.get('args').present ? child.need('args').numbers() : {},
				duration: duration.present ? duration.number() : null,
			};
		}

		child.only(...CLIP_ENTRY_KEYS);
		return { ...base, kind: 'clip', path: child.need('clip').text() };
	});
}
