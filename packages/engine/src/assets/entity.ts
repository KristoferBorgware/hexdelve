/*
 * The entity file: one thing, as a tree of objects with components on them.
 *
 * An entity is not a shape the format knows in advance. It is an object, what
 * is attached to it, and what hangs underneath it — and what the thing IS falls
 * out of which components it carries:
 *
 *   id: wanderer
 *   name: Wanderer
 *   object:
 *     components:
 *       - { type: rig, rig: ../rigs/humanoid.rig.yaml }
 *       - { type: mesh, mesh: ../meshes/wanderer.mesh.yaml }
 *       - { type: animator, animations: {...}, blendTrees: {...} }
 *       - { type: script, script: Character, hp: 20 }
 *
 * A sword is the same file with `attach` where the animator was: a rig it
 * borrows bone names from, a mesh, and the bone it hangs off when somebody is
 * carrying it. Nothing says which of the two a file describes, because nothing
 * has to — a thing that can be posed has an animator and a thing that can be
 * worn has an attach, and both statements are already in the components.
 *
 * ## The four this file reads
 *
 * `rig`, `mesh`, `animator` and `attach`, beside `script` in `scripting/`. A
 * game adds its own and the engine never learns them; these are the engine's
 * because each is a fact about drawing or posing, which is what an engine is
 * for. Their records are also the only ones that name FILES, which is why they
 * are read here rather than left to a factory: a path has to be resolved and
 * fetched before anything can be spawned, and only the library can do that.
 *
 * ## One rig per object, inherited downwards
 *
 * A `rig` component puts a rig in scope for the object it sits on and for
 * everything under it. A mesh checks its bone names against that rig, an attach
 * looks its bone up in it, an animator poses it. Naming it once per object is
 * what stops a body from being able to hang a bat's mesh on a man's bones.
 *
 * ## Why the blend trees link animations and not the other way round
 *
 * A tree refers to `walk`, and the animator is what says what `walk` is. That
 * way the records that list paths are exactly the ones above, and a tree is a
 * pure arrangement over named leaves — so one locomotion tree reads on every
 * entity that names its leaves. The alternative, a tree carrying its own clip
 * paths, would have the animator and the tree both naming files and both able
 * to disagree about which walk was meant.
 */

import type { AnimationAsset } from './animation.js';
import type { ComponentAssets } from './binding.js';
import type { BlendTreeAsset } from './blendtree.js';
import { Node } from './document.js';
import type { MeshAsset } from './mesh.js';
import { emptyPrefab, readPrefabNode, type ComponentSpec, type PrefabNode } from './prefab.js';
import type { RigAsset, RigView } from './rig.js';

export interface EntityAsset {
	readonly id: string;
	readonly name: string;
	/** Where to look and how far back to stand, for a bench or a preview. */
	readonly view: RigView;
	/** Free-form labels: `armour`, `weapon`, whatever the game turns out to want. */
	readonly tags: readonly string[];
	/**
	 * What this is when it is standing in the world, with every component's
	 * files loaded — see binding.ts.
	 *
	 * Never null. A file that says nothing gets one object named after the
	 * entity with nothing on it, because "a thing with no components" is a real
	 * answer and an absent object is not: every entity can be spawned.
	 */
	readonly prefab: PrefabNode;
}

export const ENTITY_KEYS = ['id', 'name', 'notes', 'tags', 'view', 'object'] as const;

/** What the entity file says, before any of it has been fetched. */
export interface EntityDocument {
	readonly id: string;
	readonly name: string;
	readonly tags: readonly string[];
	readonly view: Partial<RigView>;
	readonly prefab: PrefabNode;
}

export function readEntity(source: string, file: string): EntityDocument {
	const root = Node.parse(source, file).only(...ENTITY_KEYS);
	const id = root.need('id').text();
	const view = root.get('view').only('focusY', 'frameDistance');

	return {
		id,
		name: root.get('name').textOr(id),
		tags: root
			.get('tags')
			.listOrEmpty()
			.map((tag) => tag.text()),
		view: {
			...(view.get('focusY').present ? { focusY: view.need('focusY').number() } : {}),
			...(view.get('frameDistance').present
				? { frameDistance: view.need('frameDistance').number() }
				: {}),
		},
		prefab: root.get('object').present ? readPrefabNode(root.need('object'), id) : emptyPrefab(id),
	};
}

/* --------------------------------------------- the records that name files -- */

export const RIG_COMPONENT_KEYS = ['type', 'rig'] as const;
export const MESH_COMPONENT_KEYS = ['type', 'mesh'] as const;
export const ANIMATOR_KEYS = ['type', 'animations', 'blendTrees'] as const;
export const ATTACH_KEYS = ['type', 'bone', 'lift', 'tilt'] as const;

/** Where a thing hangs when it is worn, and how it lies when it is put down. */
export interface Attachment {
	/** The bone it hangs from, in the rig in scope where it was declared. */
	readonly bone: string;
	/** How far to raise it so it rests on the grass rather than in it. */
	readonly lift: number;
	/** Rotation about X on the ground: 0 stands it up, pi/2 lays it flat. */
	readonly tilt: number;
}

export function readAttachment(fields: Node): Attachment {
	fields.only(...ATTACH_KEYS);
	return {
		bone: fields.need('bone').text(),
		lift: fields.get('lift').numberOr(0),
		tilt: fields.get('tilt').numberOr(0),
	};
}

/** One entry of an animator's `animations` mapping, as read. */
export type AnimationRequest = ClipRequest;

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

const CLIP_ENTRY_KEYS = ['clip', 'label', 'sync', 'contacts'] as const;

/**
 * The animations, as requests.
 *
 * A bare string is a clip file, which is the common case and not worth making
 * anyone spell out; a mapping is the same thing with options on it. Every
 * animation is a clip — the cycles worked out as functions are baked into
 * clips by `tools/bake-clips.mjs` before they get here, which is what lets an
 * entity name one thing rather than two.
 */
export function readAnimations(node: Node): AnimationRequest[] {
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

		child.only(...CLIP_ENTRY_KEYS);
		return { ...base, kind: 'clip', path: child.need('clip').text() };
	});
}

/* --------------------------------------------------- reading a loaded tree -- */

/**
 * The first component of this type in an object tree, parents before children.
 *
 * What a catalogue row or a bench asks with: "the mesh of a helmet" is a
 * well-formed question about a file with one object in it, and this is the
 * answer. Anything that cares WHICH object a component sits on walks the tree
 * itself rather than asking here.
 */
export function findComponent(node: PrefabNode, type: string): ComponentSpec | null {
	for (const component of node.components) {
		if (component.type === type) return component;
	}
	for (const child of node.children) {
		const found = findComponent(child, type);
		if (found) return found;
	}
	return null;
}

/** The assets bound to the first component of this type, or none. */
export function componentAssets(entity: EntityAsset, type: string): ComponentAssets | null {
	return findComponent(entity.prefab, type)?.assets ?? null;
}

/*
 * The five questions worth a name of their own.
 *
 * Each is the first one in the tree, which is the whole answer for a file with
 * one object in it — and every file here has one. A caller that means a
 * particular object walks the tree with `findComponent` on that object instead,
 * and nothing below hides the difference: these say "this entity's rig" and a
 * file with two rigs in it has more than one thing they could mean.
 */

/** The bones it is built on, or null where it has none. */
export function entityRig(entity: EntityAsset): RigAsset | null {
	return componentAssets(entity, 'rig')?.rig ?? null;
}

/** The prisms it is drawn as, or null where it has none. */
export function entityMesh(entity: EntityAsset): MeshAsset | null {
	return componentAssets(entity, 'mesh')?.mesh ?? null;
}

/** The animations it can be put in, by name. Empty where it has no animator. */
export function entityAnimations(entity: EntityAsset): ReadonlyMap<string, AnimationAsset> {
	return componentAssets(entity, 'animator')?.animations ?? new Map();
}

/** The trees over those animations, by name. */
export function entityBlendTrees(entity: EntityAsset): ReadonlyMap<string, BlendTreeAsset> {
	return componentAssets(entity, 'animator')?.blendTrees ?? new Map();
}

/** What it hangs from and how it lies, for an entity that can be worn. */
export function entityAttachment(entity: EntityAsset): Attachment | null {
	const attach = findComponent(entity.prefab, 'attach');
	return attach === null ? null : readAttachment(attach.fields);
}
