/*
 * Choosing a backend.
 *
 * The rule the project asked for: WebGPU whenever it can be had, WebGL2 when
 * it cannot. "Can be had" is not a feature-detect — `navigator.gpu` exists in
 * browsers where `requestAdapter` still answers null, and a device request can
 * fail on a machine that has the API — so the only honest test is to try, and
 * fall back on any failure.
 *
 * A caller who names a backend gets that backend or an error; only `auto`
 * falls back, and when it does, `info.fellBack` says so.
 */

import {
	RendererCreationError,
	type BackendPreference,
	type Renderer,
	type RendererOptions,
} from './types.js';
import { WebGL2Renderer } from './webgl2/WebGL2Renderer.js';
import { WebGPURenderer } from './webgpu/WebGPURenderer.js';

/** Whether WebGPU is worth attempting at all. Cheap, and only a hint. */
export function isWebGPUAvailable(): boolean {
	return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu);
}

export async function createRenderer(options: RendererOptions): Promise<Renderer> {
	const preference: BackendPreference = options.backend ?? 'auto';

	if (preference === 'webgl2') {
		return WebGL2Renderer.create(options, false);
	}

	if (preference === 'webgpu') {
		return WebGPURenderer.create(options);
	}

	try {
		return await WebGPURenderer.create(options);
	} catch (error) {
		if (!(error instanceof RendererCreationError)) throw error;
		// Not a warning: on a browser without WebGPU this is the normal path.
		console.info(`[hexdelve] WebGPU unavailable (${error.message}); using WebGL2.`);
		return WebGL2Renderer.create(options, true);
	}
}
