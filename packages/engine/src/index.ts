/*
 * @hexdelve/engine — everything between a canvas and a picture.
 *
 * The engine knows how to draw hexagonal prisms on a GPU, how to look at them,
 * and how to keep time. It knows nothing about a game: no characters, no
 * grid rules, no input. Those belong to the client, which is what makes the
 * client the package worth distributing.
 */

export {
	hexPrismGeometry,
	hexCorner,
	HEX_VERTEX_STRIDE_BYTES,
	HEX_VERTEX_STRIDE_FLOATS,
	type HexPrismGeometry,
} from './geometry/hexPrism.js';

export {
	HexInstances,
	HEX_INSTANCE_BYTES,
	HEX_INSTANCE_FLOATS,
	type ColorInput,
} from './scene/HexInstances.js';

export { OrbitCamera, type OrbitCameraOptions } from './scene/OrbitCamera.js';

export { Ticker, type TickerOptions, type FixedUpdate, type FrameUpdate } from './core/Ticker.js';

export { createRenderer, isWebGPUAvailable } from './renderer/createRenderer.js';

export {
	RendererCreationError,
	type BackendKind,
	type BackendPreference,
	type Frame,
	type Light,
	type Renderer,
	type RendererInfo,
	type RendererOptions,
} from './renderer/types.js';

export { WebGPURenderer } from './renderer/webgpu/WebGPURenderer.js';
export { WebGL2Renderer } from './renderer/webgl2/WebGL2Renderer.js';
