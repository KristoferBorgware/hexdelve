/*
 * The WebGL2 backend — the one that is always there.
 *
 * Instancing is core in WebGL2 (no extension dance), so this is a single
 * program, one vertex array, and two buffers: the shared prism and the
 * per-instance array. Multisampling is left to the canvas, which is both
 * simpler and cheaper than resolving one by hand.
 */

import type { DepthRange, Mat4 } from '@hexdelve/shared';

import { hexPrismGeometry, HEX_VERTEX_STRIDE_BYTES } from '../../geometry/hexPrism.js';
import { HEX_INSTANCE_BYTES } from '../../scene/HexInstances.js';
import {
	instanceTotal,
	RendererCreationError,
	type Frame,
	type InstanceRanges,
	type Renderer,
	type RendererInfo,
	type RendererOptions,
} from '../types.js';
import {
	DEPTH_FRAGMENT_SHADER,
	DEPTH_VERTEX_SHADER,
	FRAGMENT_SHADER,
	VERTEX_SHADER,
} from './shaders.js';

interface Uniforms {
	viewProjection: WebGLUniformLocation;
	lightViewProjection: WebGLUniformLocation;
	light: WebGLUniformLocation;
	ambient: WebGLUniformLocation;
	shadow: WebGLUniformLocation;
	shadowMap: WebGLUniformLocation;
}

/** The shadow pass needs one matrix and nothing else. */
interface DepthUniforms {
	lightViewProjection: WebGLUniformLocation;
}

export class WebGL2Renderer implements Renderer {
	readonly backend = 'webgl2' as const;
	readonly depthRange: DepthRange = 'negative-one-to-one';
	readonly info: RendererInfo;

	private readonly gl: WebGL2RenderingContext;
	private readonly canvas: HTMLCanvasElement;
	private readonly clearColor: readonly [number, number, number, number];

	private readonly program: WebGLProgram;
	private readonly uniforms: Uniforms;
	private readonly depthProgram: WebGLProgram | null;
	private readonly depthUniforms: DepthUniforms | null;
	private readonly shadowFramebuffer: WebGLFramebuffer | null;
	private readonly shadowTexture: WebGLTexture | null;
	private readonly shadowMapSize: number;
	private readonly vao: WebGLVertexArrayObject;
	private readonly vertexBuffer: WebGLBuffer;
	private readonly indexBuffer: WebGLBuffer;
	private readonly instanceBuffer: WebGLBuffer;
	private readonly indexCount: number;

	private instanceCapacity = 0;
	private ranges: InstanceRanges = { opaque: 0, blended: 0, overlay: 0 };
	private disposed = false;
	private contextLost = false;
	private readonly onContextLost: (event: Event) => void;

	static create(options: RendererOptions, fellBack: boolean): WebGL2Renderer {
		const gl = options.canvas.getContext('webgl2', {
			alpha: false,
			antialias: options.msaa !== false,
			depth: true,
			stencil: false,
			powerPreference: 'high-performance',
			preserveDrawingBuffer: false,
		});
		if (!gl) {
			throw new RendererCreationError('webgl2', 'This browser does not support WebGL2.');
		}
		return new WebGL2Renderer(options, gl, fellBack);
	}

	private constructor(options: RendererOptions, gl: WebGL2RenderingContext, fellBack: boolean) {
		this.gl = gl;
		this.canvas = options.canvas;
		this.clearColor = options.clearColor ?? [0.77, 0.84, 0.78, 1];

		this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
		this.uniforms = {
			viewProjection: mustGetUniform(gl, this.program, 'uViewProjection'),
			lightViewProjection: mustGetUniform(gl, this.program, 'uLightViewProjection'),
			light: mustGetUniform(gl, this.program, 'uLight'),
			ambient: mustGetUniform(gl, this.program, 'uAmbient'),
			shadow: mustGetUniform(gl, this.program, 'uShadow'),
			shadowMap: mustGetUniform(gl, this.program, 'uShadowMap'),
		};

		this.shadowMapSize = options.shadowMapSize ?? 2048;
		if (this.shadowMapSize > 0) {
			this.depthProgram = linkProgram(gl, DEPTH_VERTEX_SHADER, DEPTH_FRAGMENT_SHADER);
			this.depthUniforms = {
				lightViewProjection: mustGetUniform(gl, this.depthProgram, 'uLightViewProjection'),
			};

			this.shadowTexture = mustCreate(gl.createTexture(), 'shadow texture');
			gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
			gl.texImage2D(
				gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F,
				this.shadowMapSize, this.shadowMapSize, 0,
				gl.DEPTH_COMPONENT, gl.FLOAT, null,
			);
			// LINEAR on a comparison sampler is not a blur of depths — it is a
			// blur of the *results* of the depth test, which is exactly the 2x2
			// percentage-closer filter wanted here and free in hardware.
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

			this.shadowFramebuffer = mustCreate(gl.createFramebuffer(), 'shadow framebuffer');
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTexture, 0,
			);
			// Depth only: without this the driver expects a colour buffer that
			// is not there and the framebuffer is incomplete.
			gl.drawBuffers([gl.NONE]);
			gl.readBuffer(gl.NONE);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.bindTexture(gl.TEXTURE_2D, null);
		} else {
			this.depthProgram = null;
			this.depthUniforms = null;
			this.shadowTexture = null;
			this.shadowFramebuffer = null;
		}

		const geometry = hexPrismGeometry();
		this.indexCount = geometry.indexCount;

		this.vao = mustCreate(gl.createVertexArray(), 'vertex array');
		this.vertexBuffer = mustCreate(gl.createBuffer(), 'vertex buffer');
		this.indexBuffer = mustCreate(gl.createBuffer(), 'index buffer');
		this.instanceBuffer = mustCreate(gl.createBuffer(), 'instance buffer');

		gl.bindVertexArray(this.vao);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, HEX_VERTEX_STRIDE_BYTES, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, HEX_VERTEX_STRIDE_BYTES, 12);

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

		// Four vec4s of instance data, advanced once per prism rather than
		// once per vertex.
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
		for (let i = 0; i < 4; i++) {
			const location = 2 + i;
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, 4, gl.FLOAT, false, HEX_INSTANCE_BYTES, i * 16);
			gl.vertexAttribDivisor(location, 1);
		}

		gl.bindVertexArray(null);

		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.frontFace(gl.CCW);

		// A WebGL context can be taken away too, and unlike WebGPU it announces
		// it on the canvas rather than on a promise. Preventing the default is
		// what makes the loss reported rather than silent.
		this.onContextLost = (event: Event) => {
			event.preventDefault();
			this.contextLost = true;
			console.error('[hexdelve] the WebGL2 context was lost.');
			options.onDeviceLost?.('the WebGL2 context was lost');
		};
		this.canvas.addEventListener('webglcontextlost', this.onContextLost);

		const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
		const device = debugInfo
			? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
			: String(gl.getParameter(gl.RENDERER));

		this.info = {
			backend: 'webgl2',
			device,
			msaaSamples: gl.getParameter(gl.SAMPLES) as number,
			fellBack,
		};
	}

	get alive(): boolean {
		return !this.disposed && !this.contextLost;
	}

	resize(width: number, height: number, pixelRatio: number): void {
		if (!this.alive) return;
		const w = Math.max(1, Math.floor(width * pixelRatio));
		const h = Math.max(1, Math.floor(height * pixelRatio));
		if (this.canvas.width === w && this.canvas.height === h) return;
		this.canvas.width = w;
		this.canvas.height = h;
	}

	setInstances(data: Float32Array, ranges: InstanceRanges): void {
		if (!this.alive) return;
		const gl = this.gl;
		this.ranges = ranges;
		const count = instanceTotal(ranges);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
		if (count > this.instanceCapacity) {
			// Over-allocate so a scene that grows a prism at a time does not
			// reallocate on every push.
			this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, 256);
			gl.bufferData(gl.ARRAY_BUFFER, this.instanceCapacity * HEX_INSTANCE_BYTES, gl.DYNAMIC_DRAW);
		}
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * (HEX_INSTANCE_BYTES / 4));
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}

	render(frame: Frame): void {
		if (!this.alive) return;
		const gl = this.gl;
		const { opaque, blended, overlay } = this.ranges;

		const shadow = this.shadowFramebuffer && frame.shadow ? frame.shadow : null;
		if (shadow && opaque > 0) this.renderShadowMap(shadow.viewProjection, opaque);

		const [r, g, b, a] = this.clearColor;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(r, g, b, a);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		if (opaque + blended + overlay === 0) return;

		gl.useProgram(this.program);
		gl.uniformMatrix4fv(this.uniforms.viewProjection, false, frame.viewProjection as Mat4);

		const d = frame.light.direction;
		gl.uniform4f(this.uniforms.light, d[0]!, d[1]!, d[2]!, frame.light.intensity);
		const ambient = frame.light.ambient;
		gl.uniform3f(this.uniforms.ambient, ambient[0]!, ambient[1]!, ambient[2]!);

		if (shadow) {
			gl.uniformMatrix4fv(this.uniforms.lightViewProjection, false, shadow.viewProjection as Mat4);
			gl.uniform3f(this.uniforms.shadow, 1, shadow.bias ?? 0.0025, 1 / this.shadowMapSize);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
			gl.uniform1i(this.uniforms.shadowMap, 0);
		} else {
			gl.uniform3f(this.uniforms.shadow, 0, 0, 0);
		}

		gl.bindVertexArray(this.vao);

		// Opaque: depth written, so everything after this can test against a
		// complete depth buffer.
		gl.disable(gl.BLEND);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
		this.drawRange(0, opaque);

		if (blended > 0 || overlay > 0) {
			gl.enable(gl.BLEND);
			gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			// Transparent surfaces never write depth, so one cannot hide another.
			gl.depthMask(false);
			this.drawRange(opaque, blended);

			gl.disable(gl.DEPTH_TEST);
			this.drawRange(opaque + blended, overlay);
			gl.enable(gl.DEPTH_TEST);

			gl.depthMask(true);
			gl.disable(gl.BLEND);
		}

		gl.bindVertexArray(null);
	}

	/**
	 * The scene from the sun, depth only.
	 *
	 * Only the opaque range casts. Smoke that shadowed the yard would be a lie
	 * about what smoke does, and the ground arrows are a readout — a readout
	 * that cast a shadow would be a very strange object indeed.
	 *
	 * Front faces are culled rather than back ones for the duration. What gets
	 * written is then the far side of each prism, which is further from the
	 * light than the surface being tested, and most of the depth bias a flat
	 * face would otherwise need stops being necessary.
	 */
	private renderShadowMap(lightViewProjection: Mat4, opaque: number): void {
		const gl = this.gl;

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
		gl.viewport(0, 0, this.shadowMapSize, this.shadowMapSize);
		gl.clearDepth(1);
		gl.clear(gl.DEPTH_BUFFER_BIT);

		gl.useProgram(this.depthProgram);
		gl.uniformMatrix4fv(this.depthUniforms!.lightViewProjection, false, lightViewProjection);

		gl.disable(gl.BLEND);
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(true);
		gl.cullFace(gl.FRONT);

		gl.bindVertexArray(this.vao);
		this.drawRange(0, opaque);
		gl.bindVertexArray(null);

		gl.cullFace(gl.BACK);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	/**
	 * One instanced draw over a span of the instance buffer.
	 *
	 * WebGL2 has no base-instance parameter — that lives in an extension half
	 * the browsers do not have — so the instance attributes are re-pointed at
	 * the span instead. The pointer calls are recorded into the bound vertex
	 * array, which is what makes this as cheap as passing an offset would be.
	 */
	private drawRange(first: number, count: number): void {
		if (count <= 0) return;
		const gl = this.gl;

		gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
		const base = first * HEX_INSTANCE_BYTES;
		for (let i = 0; i < 4; i++) {
			gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, HEX_INSTANCE_BYTES, base + i * 16);
		}

		gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, count);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
		const gl = this.gl;
		gl.deleteVertexArray(this.vao);
		gl.deleteBuffer(this.vertexBuffer);
		gl.deleteBuffer(this.indexBuffer);
		gl.deleteBuffer(this.instanceBuffer);
		gl.deleteProgram(this.program);
		if (this.depthProgram) gl.deleteProgram(this.depthProgram);
		if (this.shadowTexture) gl.deleteTexture(this.shadowTexture);
		if (this.shadowFramebuffer) gl.deleteFramebuffer(this.shadowFramebuffer);
	}
}

function mustCreate<T>(value: T | null, what: string): T {
	if (value === null) throw new RendererCreationError('webgl2', `Could not create a ${what}.`);
	return value;
}

function mustGetUniform(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	name: string,
): WebGLUniformLocation {
	const location = gl.getUniformLocation(program, name);
	if (location === null) {
		throw new RendererCreationError('webgl2', `Shader is missing the uniform "${name}".`);
	}
	return location;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = mustCreate(gl.createShader(type), 'shader');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
		gl.deleteShader(shader);
		const stage = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
		throw new RendererCreationError('webgl2', `The ${stage} shader did not compile: ${log}`);
	}
	return shader;
}

function linkProgram(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	fragmentSource: string,
): WebGLProgram {
	const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
	const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	const program = mustCreate(gl.createProgram(), 'program');

	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);

	// The shaders are only ever needed by this program; detaching lets the
	// driver free them as soon as the link is done.
	gl.detachShader(program, vertex);
	gl.detachShader(program, fragment);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program) ?? 'unknown error';
		gl.deleteProgram(program);
		throw new RendererCreationError('webgl2', `The program did not link: ${log}`);
	}
	return program;
}
