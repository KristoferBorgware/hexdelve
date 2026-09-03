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
 * Reading is asynchronous because getting a file is, whatever it comes out of.
 * `AssetSource` is the whole of that: one method, one string in, one string
 * out. `fetchSource` is the browser's; a tool or a test wanting the disk
 * writes four lines around `readFile` and hands it over, which is why nothing
 * in @hexdelve/engine imports `node:fs` and nothing has to.
 */

import { poseFunctionAnimation, clipAnimation, type AnimationAsset } from './animation.js';
import { loadBlendTree, type BlendTreeAsset } from './blendtree.js';
import { buildClipAsset, readClip, type ClipAsset } from './clip.js';
import { AssetError, Node } from './document.js';
import { readEntity, type AnimationRequest, type EntityAsset } from './entity.js';
import { loadMesh, type MeshAsset } from './mesh.js';
import { PoseFunctionRegistry } from './poseFunctions.js';
import { loadRig, type RigAsset } from './rig.js';

/** Where asset files come from. One method, so anything can be one. */
export interface AssetSource {
	read(path: string): Promise<string>;
}

/**
 * Files over HTTP, under a base URL.
 *
 * The base is joined with a `/` and nothing cleverer, so it works from a
 * GitHub Pages subdirectory and from a `file://` URL inside Electron — the
 * same reason the client's Vite config sets `base: './'`.
 */
export function fetchSource(baseUrl: string): AssetSource {
	const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	return {
		async read(path) {
			const url = `${base}${path}`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
			return response.text();
		},
	};
}

/** Files already in hand, keyed by path — for a packed build, or a test. */
export function mapSource(files: ReadonlyMap<string, string> | Record<string, string>): AssetSource {
	const map = files instanceof Map ? files : new Map(Object.entries(files));
	return {
		async read(path) {
			const text = map.get(path);
			if (text === undefined) {
				throw new Error(`no asset at '${path}'; this pack has ${[...map.keys()].sort().join(', ')}`);
			}
			return text;
		},
	};
}

export interface AssetLibraryOptions {
	/** The pose functions entity files may name. Defaults to an empty one. */
	readonly poseFunctions?: PoseFunctionRegistry;
}

export class AssetLibrary {
	readonly poseFunctions: PoseFunctionRegistry;

	private readonly source: AssetSource;
	private readonly texts = new Map<string, Promise<string>>();
	private readonly rigs = new Map<string, Promise<RigAsset>>();
	private readonly meshes = new Map<string, Promise<MeshAsset>>();
	private readonly clips = new Map<string, Promise<ClipAsset>>();
	private readonly entities = new Map<string, Promise<EntityAsset>>();

	constructor(source: AssetSource, options: AssetLibraryOptions = {}) {
		this.source = source;
		this.poseFunctions = options.poseFunctions ?? new PoseFunctionRegistry();
	}

	/** Every entity a manifest lists, in the order it lists them. */
	async index(path = 'index.yaml'): Promise<EntityAsset[]> {
		const at = normalise(path);
		const root = Node.parse(await this.text(at), at).only('entities', 'notes');
		const listed = root.need('entities').list();
		return Promise.all(listed.map((entry) => this.entity(resolve(at, entry.text()))));
	}

	/** An entity, and everything it links to. Read once per path. */
	entity(path: string): Promise<EntityAsset> {
		return this.once(this.entities, normalise(path), (at) => this.readEntity(at));
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

		const attachRig = document.attach === null ? null : await this.rig(resolve(at, document.attach.rig));
		const ownRig = document.rig === null ? null : await this.rig(resolve(at, document.rig));

		// A prop's bone names belong to the rig it is worn on; a character's to
		// its own. Either way the mesh needs one before it can be checked.
		const meshRig = ownRig ?? attachRig;
		if (meshRig === null) throw new AssetError(at, 'rig', 'nothing says which rig this mesh belongs to');
		const mesh = await this.mesh(resolve(at, document.mesh), meshRig);

		if (document.attach !== null && !attachRig!.bones.includes(document.attach.bone)) {
			throw new AssetError(
				at,
				'attach.bone',
				`no bone called '${document.attach.bone}' in rig '${attachRig!.id}'`,
			);
		}

		const animations = new Map<string, AnimationAsset>();
		if (ownRig !== null) {
			for (const request of document.animations) {
				animations.set(request.name, await this.animation(at, request, ownRig));
			}
		}

		const blendTrees = new Map<string, BlendTreeAsset>();
		for (const { name, path } of document.blendTrees) {
			const treePath = resolve(at, path);
			blendTrees.set(name, loadBlendTree(await this.text(treePath), treePath, ownRig!, animations));
		}

		return {
			id: document.id,
			name: document.name,
			kind: document.kind,
			rig: ownRig,
			mesh,
			animations,
			blendTrees,
			attach: document.attach === null ? null : { rig: attachRig!, bone: document.attach.bone },
			ground: document.ground,
			view: { ...(ownRig ?? attachRig!).view, ...document.view },
			tags: document.tags,
			blurb: document.blurb,
		};
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

	private text(path: string): Promise<string> {
		let pending = this.texts.get(path);
		if (pending === undefined) {
			pending = this.source.read(path);
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
