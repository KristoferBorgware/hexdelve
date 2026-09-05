/*
 * Loading an entity, and everything it links to.
 *
 * The library owns three things the individual readers deliberately do not:
 * where a path leads, what has already been read, and the order the pieces
 * have to arrive in. That order is not arbitrary — a mesh cannot be read
 * without the rig whose bones its parts hang from, a clip cannot be checked
 * without it either, and a blend tree cannot be built until the animations it
 * refers to by name exist. So the graph is walked rig-first, always.
 *
 * Reading is asynchronous because getting a file is, whatever it comes out of,
 * and `AssetIO` is the whole of that host difference — see io.ts. Nothing in
 * @hexdelve/engine imports `node:fs`, and nothing has to.
 *
 * The library also owns the other half of the caching problem, which is
 * throwing it away. Saving a rig changes every mesh hung on it and every clip
 * checked against it, so a write drops the whole derived side rather than
 * trying to work out what it invalidated. These are small files read in
 * milliseconds; a clever invalidation here would buy nothing and would be
 * wrong the first time somebody added a link between two kinds.
 */

import { poseFunctionAnimation, clipAnimation, type AnimationAsset } from './animation.js';
import { assetsUnder, type ComponentAssets } from './binding.js';
import { loadBlendTree, type BlendTreeAsset } from './blendtree.js';
import { buildClipAsset, readClip, type ClipAsset } from './clip.js';
import { AssetError, Node } from './document.js';
import {
	findComponent,
	readAnimations,
	readAttachment,
	readEntity,
	ANIMATOR_KEYS,
	MESH_COMPONENT_KEYS,
	PARTICLES_COMPONENT_KEYS,
	RIG_COMPONENT_KEYS,
	type AnimationRequest,
	type EntityAsset,
} from './entity.js';
import { loadMesh, type MeshAsset } from './mesh.js';
import { readParticleEffect } from './particles.js';
import type { ComponentSpec, PrefabNode } from './prefab.js';
import { PoseFunctionRegistry } from './poseFunctions.js';
import type { AssetIO } from './io.js';
import { loadRig, type RigAsset, type RigView } from './rig.js';
import { loadSystem, type SystemAsset } from './system.js';
import type { ParticleEffect } from '../particles/effect.js';

/** Where a bench looks when nothing in a file names a rig to ask. */
const NO_VIEW: RigView = { focusY: 0, frameDistance: 4 };

/** What the manifest may list. */
const MANIFEST_KEYS = ['entities', 'particles', 'notes'] as const;

export interface AssetLibraryOptions {
	/** The pose functions entity files may name. Defaults to an empty one. */
	readonly poseFunctions?: PoseFunctionRegistry;
}

/** What a save refused, and why — so an editor can say it rather than throw. */
export class AssetWriteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AssetWriteError';
	}
}

export class AssetLibrary {
	readonly poseFunctions: PoseFunctionRegistry;

	private readonly io: AssetIO;
	private readonly texts = new Map<string, Promise<string>>();
	private readonly rigs = new Map<string, Promise<RigAsset>>();
	private readonly systems = new Map<string, Promise<SystemAsset>>();
	private readonly meshes = new Map<string, Promise<MeshAsset>>();
	private readonly clips = new Map<string, Promise<ClipAsset>>();
	private readonly effects = new Map<string, Promise<ParticleEffect>>();
	private readonly entities = new Map<string, Promise<EntityAsset>>();

	constructor(io: AssetIO, options: AssetLibraryOptions = {}) {
		this.io = io;
		this.poseFunctions = options.poseFunctions ?? new PoseFunctionRegistry();
	}

	/** Which backend this is reading through, for a status line. */
	get source(): AssetIO {
		return this.io;
	}

	/**
	 * Every file read so far, in order.
	 *
	 * Not a directory listing — no backend here has one, and a manifest is a
	 * better answer anyway. After `index()` this is the whole reachable set,
	 * because reaching an entity means reading everything it links to; before
	 * it, it is honestly just what has been asked for.
	 */
	get paths(): string[] {
		return [...this.texts.keys()].sort();
	}

	/** Whether this host can save at all. False on a static build, and in Electron. */
	get writable(): boolean {
		return this.io.writer !== null;
	}

	/**
	 * Write one file back, and forget everything derived from the old one.
	 *
	 * The text is PARSED before it is sent, so a file that could not be read
	 * back is never written — an editor that saves a broken document has
	 * turned an unsaved change into a broken asset, which is strictly worse
	 * than refusing. This is a syntax check, not a full load: whether the
	 * document means anything is settled by reading it again, which the caller
	 * is free to do straight afterwards and which the caches above now oblige.
	 */
	async save(path: string, text: string): Promise<void> {
		const at = normalise(path);
		const writer = this.io.writer;
		if (!writer) {
			throw new AssetWriteError(
				`cannot save '${at}': the ${this.io.kind} backend at ${this.io.origin} is read-only`,
			);
		}
		// Node.parse throws an AssetError naming the file and line if it cannot.
		Node.parse(text, at);
		await writer.write(at, text);
		this.invalidate();
	}

	/** Delete one file, and forget everything derived from it. */
	async remove(path: string): Promise<void> {
		const at = normalise(path);
		const writer = this.io.writer;
		if (!writer) {
			throw new AssetWriteError(
				`cannot delete '${at}': the ${this.io.kind} backend at ${this.io.origin} is read-only`,
			);
		}
		await writer.remove(at);
		this.invalidate();
	}

	/**
	 * Forget what has been read.
	 *
	 * With a path, that one file's text; without, everything. Either way the
	 * whole derived side goes, for the reason in this file's header.
	 */
	invalidate(path?: string): void {
		if (path === undefined) this.texts.clear();
		else this.texts.delete(normalise(path));
		this.rigs.clear();
		this.systems.clear();
		this.meshes.clear();
		this.clips.clear();
		this.effects.clear();
		this.entities.clear();
	}

	/** Every entity a manifest lists, in the order it lists them. */
	async index(path = 'index.yaml'): Promise<EntityAsset[]> {
		const at = normalise(path);
		const root = Node.parse(await this.text(at), at).only(...MANIFEST_KEYS);
		const listed = root.need('entities').list();
		return Promise.all(listed.map((entry) => this.entity(resolve(at, entry.text()))));
	}

	/**
	 * Every particle effect a manifest lists, in the order it lists them.
	 *
	 * A list of its own beside the entities rather than a section inside one,
	 * because an effect is not an entity: nothing wears it, nothing walks, and
	 * the same file drives a chimney and a burst where a blow landed. A
	 * manifest with no `particles` section has none, which is what a tree that
	 * has not authored any looks like.
	 */
	async effectIndex(path = 'index.yaml'): Promise<ParticleEffect[]> {
		const at = normalise(path);
		const root = Node.parse(await this.text(at), at).only(...MANIFEST_KEYS);
		const listed = root.get('particles').listOrEmpty();
		return Promise.all(listed.map((entry) => this.effect(resolve(at, entry.text()))));
	}

	/** One particle effect. Read once per path, like everything else here. */
	effect(path: string): Promise<ParticleEffect> {
		return this.once(this.effects, normalise(path), async (at) =>
			readParticleEffect(await this.text(at), at),
		);
	}

	/** An entity, and everything it links to. Read once per path. */
	entity(path: string): Promise<EntityAsset> {
		return this.once(this.entities, normalise(path), (at) => this.readEntity(at));
	}

	/**
	 * A system prefab. Read once per path, like everything else here.
	 *
	 * Reading it twice would be harmless; spawning it twice would not, and
	 * that is the caller's discipline rather than this one's — a library hands
	 * out what a file says, and how many copies of it exist is a question about
	 * the world.
	 */
	system(path: string): Promise<SystemAsset> {
		return this.once(this.systems, normalise(path), async (at) => loadSystem(await this.text(at), at));
	}

	rig(path: string): Promise<RigAsset> {
		return this.once(this.rigs, normalise(path), async (at) => loadRig(await this.text(at), at));
	}

	mesh(path: string, rig: RigAsset): Promise<MeshAsset> {
		const at = normalise(path);
		return this.once(this.meshes, `${at}|${rig.id}`, async () =>
			loadMesh(await this.text(at), at, rig),
		);
	}

	/**
	 * A clip.
	 *
	 * `mirrorOf` is followed here rather than in the reader, because mirroring
	 * needs the SOURCE clip's authored poses and the reader has no way to
	 * fetch another file. A chain of mirrors is refused: two clips each
	 * claiming to be the mirror of the other is a file nobody can read either.
	 */
	clip(path: string, rig: RigAsset): Promise<ClipAsset> {
		const at = normalise(path);
		return this.once(this.clips, `${at}|${rig.id}`, async () => {
			const document = readClip(await this.text(at), at, rig);
			if (document.mirrorOf === null) return buildClipAsset(document, null);

			const fromPath = resolve(at, document.mirrorOf);
			const mirrored = readClip(await this.text(fromPath), fromPath, rig);
			if (mirrored.mirrorOf !== null) {
				throw new AssetError(at, 'mirrorOf', `'${fromPath}' is itself a mirror; mirror the original`);
			}
			return buildClipAsset(document, mirrored);
		});
	}

	private async readEntity(at: string): Promise<EntityAsset> {
		const document = readEntity(await this.text(at), at);
		const prefab = await this.bind(document.prefab, at, null);
		const rig = findComponent(prefab, 'rig')?.assets.rig ?? null;

		return {
			id: document.id,
			name: document.name,
			view: { ...(rig?.view ?? NO_VIEW), ...document.view },
			tags: document.tags,
			prefab,
		};
	}

	/**
	 * One object and its subtree, with every component's files fetched.
	 *
	 * The rig goes first and travels downwards, because the rest need it: a mesh
	 * is checked against the bones its parts hang on, a clip against the bones
	 * it keys, an attach against the bone it names. `inherited` is what an object
	 * gets when it declares no rig of its own, which is how a sword under a hand
	 * is read against the hand's rig without repeating the path.
	 */
	private async bind(node: PrefabNode, at: string, inherited: RigAsset | null): Promise<PrefabNode> {
		const declared = node.components.filter((one) => one.type === 'rig');
		if (declared.length > 1) {
			declared[1]!.fields.fail(`'${node.name}' already has a rig, and an object has one`);
		}

		let rig = inherited;
		if (declared[0]) {
			declared[0].fields.only(...RIG_COMPONENT_KEYS);
			rig = await this.rig(resolve(at, declared[0].fields.need('rig').text()));
		}

		const components: ComponentSpec[] = [];
		for (const component of node.components) {
			components.push({ ...component, assets: await this.bindComponent(component, at, rig) });
		}

		const children: PrefabNode[] = [];
		for (const child of node.children) children.push(await this.bind(child, at, rig));

		return { ...node, components, children };
	}

	/** One component record's files, by what its type is known to name. */
	private async bindComponent(
		component: ComponentSpec,
		at: string,
		rig: RigAsset | null,
	): Promise<ComponentAssets> {
		const { fields } = component;

		/*
		 * Three of the four need one, and say so where the record is. A mesh or
		 * a bone with nothing above it to name a rig is not a record missing a
		 * default; it is a file that cannot be read, and the line it is written
		 * on is what the reader can usefully point at.
		 */
		const needsRig = (): RigAsset =>
			rig ??
			fields.fail(
				`a '${component.type}' needs a rig, and nothing on this object or above it names one`,
			);

		switch (component.type) {
			case 'rig':
				return assetsUnder(rig);

			case 'mesh': {
				fields.only(...MESH_COMPONENT_KEYS);
				const mesh = await this.mesh(resolve(at, fields.need('mesh').text()), needsRig());
				return { rig, mesh, effect: null, animations: new Map(), blendTrees: new Map() };
			}

			case 'particles': {
				fields.only(...PARTICLES_COMPONENT_KEYS);
				const effect = await this.effect(resolve(at, fields.need('effect').text()));
				return { rig, mesh: null, effect, animations: new Map(), blendTrees: new Map() };
			}

			case 'animator': {
				fields.only(...ANIMATOR_KEYS);
				const own = needsRig();

				const animations = new Map<string, AnimationAsset>();
				for (const request of readAnimations(fields.get('animations'))) {
					animations.set(request.name, await this.animation(at, request, own));
				}

				const blendTrees = new Map<string, BlendTreeAsset>();
				for (const [name, child] of fields.get('blendTrees').entriesOrEmpty()) {
					const path = resolve(at, child.text());
					blendTrees.set(name, loadBlendTree(await this.text(path), path, own, animations));
				}

				return { rig, mesh: null, effect: null, animations, blendTrees };
			}

			case 'attach': {
				const { bone } = readAttachment(fields);
				const own = needsRig();
				if (!own.bones.includes(bone)) {
					fields.need('bone').fail(`no bone called '${bone}' in rig '${own.id}'`);
				}
				return assetsUnder(rig);
			}

			default:
				return assetsUnder(rig);
		}
	}

	private async animation(
		at: string,
		request: AnimationRequest,
		rig: RigAsset,
	): Promise<AnimationAsset> {
		if (request.kind === 'clip') {
			const asset = await this.clip(resolve(at, request.path), rig);
			return clipAnimation(asset.clip, rig, {
				name: request.name,
				label: request.label ?? asset.name,
				sync: request.sync ?? false,
				contacts: request.contacts ?? [],
			});
		}

		const fn = this.poseFunctions.get(request.procedural);
		if (fn === undefined) {
			throw new AssetError(
				at,
				`animations.${request.name}.procedural`,
				`no pose function called '${request.procedural}'; this library knows ` +
					`${this.poseFunctions.ids.join(', ') || 'none — was one registered?'}`,
			);
		}

		const duration =
			request.duration ?? (typeof fn.duration === 'function' ? fn.duration(request.args) : fn.duration);

		return poseFunctionAnimation(fn, rig, request.args, duration, {
			name: request.name,
			label: request.label ?? request.name,
			sync: request.sync ?? false,
			contacts: request.contacts ?? fn.contacts ?? [],
		});
	}

	/**
	 * One file's raw text, read once and remembered.
	 *
	 * Public because an editor wants the bytes rather than the parsed thing —
	 * these documents carry their own comments and a reader that returned only
	 * what it understood would drop every one of them.
	 */
	text(path: string): Promise<string> {
		let pending = this.texts.get(path);
		if (pending === undefined) {
			pending = this.io.read(path);
			this.texts.set(path, pending);
		}
		return pending;
	}

	/** Memoise by key, keeping the promise so two callers share one read. */
	private once<T>(cache: Map<string, Promise<T>>, key: string, load: (key: string) => Promise<T>): Promise<T> {
		let pending = cache.get(key);
		if (pending === undefined) {
			pending = load(key.split('|')[0]!);
			cache.set(key, pending);
		}
		return pending;
	}
}

/* --------------------------------------------------------------- the paths -- */

/**
 * A path relative to the file that mentioned it.
 *
 * POSIX-ish and deliberately not `node:path`: this runs in a browser as often
 * as not. A leading `/` means from the asset root rather than from the file,
 * which is the escape hatch for a deep tree that would otherwise be all dots.
 */
export function resolve(from: string, to: string): string {
	if (to.startsWith('/')) return normalise(to.slice(1));
	const at = from.lastIndexOf('/');
	return normalise(`${at === -1 ? '' : from.slice(0, at + 1)}${to}`);
}

export function normalise(path: string): string {
	const out: string[] = [];
	for (const part of path.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (out.length === 0) throw new Error(`'${path}' climbs above the asset root`);
			out.pop();
			continue;
		}
		out.push(part);
	}
	return out.join('/');
}
