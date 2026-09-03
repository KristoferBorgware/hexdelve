/*
 * A keyframed clip, read out of a file.
 *
 * `clips.ts` already authored these pose-major — a list of `{ t, bones }`,
 * where a bone left out of a pose simply gets no key there and interpolates
 * straight through it. That is how animators work and why the tables only ever
 * mention the bones that are doing something, and it is also, unchanged, a
 * perfectly good file format. So the shape here is the shape that was already
 * being written; what it gains is a bone name checked against the rig, and a
 * `mirrorOf` for the half of a symmetric pair that was `mirrorPose(...)`.
 *
 * The two conventions from `clip.ts` still hold and are worth restating,
 * because a file cannot carry a comment to the person editing it at 2am:
 *
 *   - Time is seconds, angles radians, Euler XYZ.
 *   - For a looping clip the pose at t = duration IS the pose at t = 0. Do not
 *     author a closing key; the wrap segment interpolates back to the first.
 */

import { mirrorPose, poseClip, type Clip, type ClipEvent, type Easing, type PoseEntry, type PoseKey } from '../anim/clip.js';
import { Node } from './document.js';
import type { RigAsset } from './rig.js';

export interface ClipAsset {
	readonly id: string;
	readonly name: string;
	readonly clip: Clip;
}

/**
 * A clip as read, before it is built.
 *
 * Kept apart from the `Clip` so `mirrorOf` has something to mirror: mirroring
 * is a transform of the AUTHORED poses, not of the sampled tracks, and once
 * `poseClip` has turned poses into per-bone key lists the left and right of a
 * bone are no longer next to each other.
 */
export interface ClipDocument {
	readonly id: string;
	readonly name: string;
	readonly duration: number | null;
	readonly loop: 'loop' | 'hold' | null;
	readonly poses: readonly PoseKey[];
	readonly events: readonly ClipEvent[];
	/** The clip this one is the left/right mirror of, as a path. */
	readonly mirrorOf: string | null;
}

const CLIP_KEYS = ['id', 'name', 'notes', 'rig', 'duration', 'loop', 'constants', 'events', 'poses', 'mirrorOf'] as const;
const EASINGS = ['auto', 'linear', 'step', 'flat'] as const;

export function readClip(source: string, file: string, rig: RigAsset): ClipDocument {
	const root = Node.parse(source, file).only(...CLIP_KEYS);
	const id = root.need('id').text();

	const constants: Record<string, number> = {};
	for (const [key, child] of root.get('constants').entriesOrEmpty()) {
		constants[key] = child.withScope({ ...constants }).number();
	}
	const scoped = root.withScope(constants);

	const mirrorOf = scoped.get('mirrorOf');
	const durationNode = scoped.get('duration');
	const loopNode = scoped.get('loop');

	if (!mirrorOf.present && !durationNode.present) {
		scoped.need('duration');
	}

	const events: ClipEvent[] = scoped
		.get('events')
		.listOrEmpty()
		.map((event) => {
			event.only('t', 'name');
			return { t: event.need('t').number(), name: event.need('name').text() };
		});

	return {
		id,
		name: scoped.get('name').textOr(id),
		duration: durationNode.present ? durationNode.number() : null,
		loop: loopNode.present ? loopNode.choice(['loop', 'hold'] as const) : null,
		poses: readPoses(scoped.get('poses'), rig),
		events,
		mirrorOf: mirrorOf.present ? mirrorOf.text() : null,
	};
}

/**
 * Build a clip, mirroring a source clip's poses if that is what it is.
 *
 * A mirrored clip inherits everything it does not state — the lean to the
 * right is the lean to the left, and nothing about it is worth typing twice
 * except its own name.
 */
export function buildClipAsset(document: ClipDocument, mirrored: ClipDocument | null): ClipAsset {
	const poses = mirrored === null ? document.poses : mirrorPoses(mirrored.poses);
	const duration = document.duration ?? mirrored?.duration ?? null;
	const loop = document.loop ?? mirrored?.loop ?? 'loop';
	const events = document.events.length > 0 ? document.events : (mirrored?.events ?? []);

	if (duration === null) {
		throw new Error(`clip '${document.id}' has no duration, and neither has the clip it mirrors`);
	}

	return {
		id: document.id,
		name: document.name,
		clip: poseClip(document.id, duration, loop, [...poses], [...events]),
	};
}

function mirrorPoses(poses: readonly PoseKey[]): PoseKey[] {
	return poses.map((pose) => ({
		t: pose.t,
		...(pose.e !== undefined ? { e: pose.e } : {}),
		p: mirrorPose(pose.p),
	}));
}

/**
 * The poses, in time order as authored.
 *
 * A bone name is checked against the rig here, which is the one thing a file
 * can get wrong that the code could not: `forarmL` compiled to nothing in
 * TypeScript and would silently animate nobody here.
 */
function readPoses(node: Node, rig: RigAsset): PoseKey[] {
	const known = new Set(rig.bones);

	return node.listOrEmpty().map((entry) => {
		entry.only('t', 'ease', 'bones');
		const easeNode = entry.get('ease');
		const ease = easeNode.present ? easeNode.choice(EASINGS) : undefined;

		const bones: Record<string, PoseEntry> = {};
		for (const [name, value] of entry.need('bones').entries()) {
			if (!known.has(name)) value.fail(`no bone called '${name}' in rig '${rig.id}'`);
			bones[name] = readPoseEntry(value);
		}

		return { t: entry.need('t').number(), ...(ease !== undefined ? { e: ease } : {}), p: bones };
	});
}

/**
 * One bone in one pose.
 *
 * Three numbers is a rotation, which is what all but a handful of keys in this
 * project are; a mapping is for the ones that also move the bone, or that want
 * their own easing.
 */
function readPoseEntry(node: Node): PoseEntry {
	if (!node.isMap) return node.vec3() as readonly [number, number, number];

	node.only('rot', 'pos', 'ease');
	const rot = node.get('rot');
	const pos = node.get('pos');
	const ease = node.get('ease');
	if (!rot.present && !pos.present) node.fail('expected rot, pos, or both');

	return {
		...(rot.present ? { rot: rot.vec3() } : {}),
		...(pos.present ? { pos: pos.vec3() } : {}),
		...(ease.present ? { e: ease.choice(EASINGS) as Easing } : {}),
	};
}
