/*
 * Writing an edited effect back to its file.
 *
 * The whole file is the effect, so unlike the entity bench next door there is
 * nothing else in it to preserve — except the comments, and those are the
 * whole of what a hand-written asset file has that a generated one does not.
 * The header of `smoke.particles.yaml` says why the rise is a speed plus a
 * gravity rather than a speed, and losing that on the first save would be
 * losing the only place it is written down.
 *
 * So a save keeps the block of comments the file OPENS with and writes the
 * document under it. Comments further down are lost, which is the accepted
 * cost of a bench that writes files at all — the same one the entity bench
 * pays — and the header is where the argument lives in every file in this tree.
 */

import { writeParticleEffect, type ParticleEffect } from '@hexdelve/engine';

import { library } from '../../assets/library.js';

/** Where an effect's file sits, by the id the manifest lists it under. */
export function effectPath(id: string): string {
	return `particles/${id}.particles.yaml`;
}

/** The document a save would write, header and all. */
export function effectDocument(effect: ParticleEffect, header: string): string {
	const body = writeParticleEffect(effect);
	return header ? `${header}\n\n${body}` : body;
}

/**
 * The comment block a file opens with.
 *
 * Every line from the top that is blank or a comment, up to the first line of
 * document — which in these files is `id:`. Trailing blanks are dropped so the
 * one blank line between header and body is put back by the caller rather than
 * accumulating on every save.
 */
export function headerOf(text: string): string {
	const kept: string[] = [];
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (trimmed !== '' && !trimmed.startsWith('#')) break;
		kept.push(line);
	}
	while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();
	return kept.join('\n');
}

/** The header of the file this effect was read from, or nothing if it is new. */
export async function readHeader(id: string): Promise<string> {
	try {
		return headerOf(await library.text(effectPath(id)));
	} catch {
		// A file that is not there has no header, which is what a caller
		// writing a new effect should get rather than a failure.
		return '';
	}
}

/**
 * Replace one effect's file.
 *
 * The library parses what it is handed before sending it and forgets
 * everything derived from the old file afterwards, so a caller that reloads
 * straight after this gets the document it just wrote.
 */
export async function saveEffect(effect: ParticleEffect, header: string): Promise<void> {
	await library.save(effectPath(effect.id), effectDocument(effect, header));
}
