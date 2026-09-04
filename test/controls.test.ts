/*
 * Whose key is it?
 *
 * `Controls` binds `keydown` on the window, because a canvas only receives a
 * key once something has given it focus and a game nobody has clicked on yet
 * should still answer the space bar. That decision is right and it has a cost:
 * the handler is offered every key pressed anywhere on the page, and it used to
 * take the space bar unconditionally — `preventDefault` and all.
 *
 * The bug that produced this file: the editor's script view runs a yard beside
 * a code editor, and every space typed into the code went to a game nobody was
 * playing. Nothing threw. The characters simply did not appear.
 *
 * The fix is one predicate, and the predicate is what is worth testing —
 * there is no DOM in this runner, and there does not need to be one. The
 * decision is about the SHAPE of what was focused, so the cases below are that
 * shape and nothing else, which is also what makes it right for an element from
 * another document, where `instanceof HTMLElement` is false.
 */

import { describe, expect, it } from 'vitest';
import { takesText } from '@hexdelve/client';

describe('a key that went somewhere that takes text', () => {
	it('belongs to a form control', () => {
		expect(takesText({ tagName: 'INPUT' })).toBe(true);
		expect(takesText({ tagName: 'TEXTAREA' })).toBe(true);
		expect(takesText({ tagName: 'SELECT' })).toBe(true);
	});

	it('belongs to anything contenteditable', () => {
		expect(takesText({ tagName: 'DIV', isContentEditable: true })).toBe(true);
	});

	/*
	 * The case this was written for. Monaco takes its input through an
	 * EditContext, so what has focus is a plain `<div>` that is not a form
	 * control and is not contenteditable — it answers to no other test here.
	 */
	it('belongs to an element with an EditContext attached', () => {
		expect(takesText({ tagName: 'DIV', editContext: {} })).toBe(true);
	});
});

describe('a key that went anywhere else', () => {
	it('is the game to answer for', () => {
		expect(takesText({ tagName: 'CANVAS' })).toBe(false);
		expect(takesText({ tagName: 'BODY' })).toBe(false);
		expect(takesText({ tagName: 'BUTTON' })).toBe(false);
		// A page with nothing focused reports the document, and a key pressed
		// with a window focused reports the window.
		expect(takesText({ tagName: undefined })).toBe(false);
	});

	it('is not a crash when there is no target at all', () => {
		expect(takesText(null)).toBe(false);
	});

	/*
	 * `isContentEditable` is `false` on every element that is not one, and
	 * `editContext` is `null` rather than absent on a browser that has the API.
	 * Both are the ordinary case, and both would be truthy if this were written
	 * with `in`.
	 */
	it('is not fooled by the properties being present and empty', () => {
		expect(takesText({ tagName: 'DIV', isContentEditable: false, editContext: null })).toBe(false);
	});
});
