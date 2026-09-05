/*
 * Writing an edited object tree back into its entity file.
 *
 * The bench edits one part of a file that says a great deal else — a rig, a
 * mesh, the animations and the trees over them. So a save reads the file it is
 * about to replace, keeps every one of those, and swaps in the tree: the two
 * halves of an entity live in one file precisely so they cannot disagree, and a
 * writer that emitted only the half it knew about would be the disagreement.
 *
 * What a rewrite does not keep is the comments, and that is the accepted cost
 * of a bench that writes files at all.
 */

import { readEntity, writeEntity } from '@hexdelve/engine';

import { library } from '../../assets/library.js';
import { draftToEmittable, type DraftNode } from './entitydraft.js';

/** Where an entity's file sits, by the id the manifest lists it under. */
export function entityPath(id: string): string {
	return `entities/${id}.entity.yaml`;
}

/**
 * Replace one entity's object tree with a draft.
 *
 * The library parses what it is handed before sending it and forgets
 * everything derived from the old file afterwards, so a caller that reloads
 * straight after this gets the document it just wrote rather than the cached
 * one it replaced.
 */
export async function saveEntityPrefab(id: string, draft: DraftNode): Promise<void> {
	const path = entityPath(id);
	const document = readEntity(await library.text(path), path);
	await library.save(path, writeEntity(document, draftToEmittable(draft)));
}
