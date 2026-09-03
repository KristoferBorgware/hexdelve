/*
 * The WebGPU backend — the one the client asks for first.
 *
 * Structurally the same picture as WebGL2 draws: one pipeline, the shared
 * prism in one vertex buffer, the instances in another, one uniform buffer.
 * What WebGPU makes explicit and WebGL hides is the render target, so this
 * file owns a depth texture and — when multisampling is on — a 4x colour
 * texture that resolves into the swapchain. Both are rebuilt on resize.
 */

import type { DepthRange } from '@hexdelve/shared';

import { hexPrismGeometry, HEX_VERTEX_STRIDE_BYTES } from '../../geometry/hexPrism.js';
import { HEX_INSTANCE_BYTES } from '../../scene/HexInstances.js';
import {
	instanceTotal,
	RendererCreationError,
	type Frame,
	type FrameCapture,
	type InstanceRanges,
	type Renderer,
	type RendererInfo,
	type RendererOptions,
} from '../types.js';
import { DEPTH_SHADER, HEX_SHADER } from './shaders.js';

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
// viewProjection, lightViewProjection, light, ambient, shadow params.
const UNIFORM_BYTES = 64 + 64 + 16 + 16 + 16;
const SHADOW_UNIFORM_BYTES = 64;
/**
 * A shadow map wants a plain, filterable depth format. depth24plus cannot be
 * sampled with comparison on every adapter, and depth32float can.
 */
const SHADOW_FORMAT: GPUTextureFormat = 'depth32float';

export class WebGPURenderer implements Renderer {
	readonly backend = 'webgpu' as const;
	readonly depthRange: DepthRange = 'zero-to-one';
	readonly info: RendererInfo;

	private readonly canvas: HTMLCanvasElement;
	private readonly device: GPUDevice;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly sampleCount: number;
	private readonly clearColor: readonly [number, number, number, number];

	/** One per pass: opaque, blended (depth-tested), overlay (not depth-tested). */
	private readonly pipeline: GPURenderPipeline;
	private readonly blendedPipeline: GPURenderPipeline;
	private readonly overlayPipeline: GPURenderPipeline;
	private readonly shadowPipeline: GPURenderPipeline | null;
	private readonly shadowBindGroup: GPUBindGroup | null;
	private readonly shadowUniformBuffer: GPUBuffer | null;
	private readonly shadowTexture: GPUTexture | null;
	private readonly shadowView: GPUTextureView | null;
	private readonly shadowMapSize: number;
	private readonly shadowUniformData = new Float32Array(SHADOW_UNIFORM_BYTES / 4);
	private readonly bindGroup: GPUBindGroup;
	private readonly uniformBuffer: GPUBuffer;
	private readonly uniformData = new Float32Array(UNIFORM_BYTES / 4);
	private readonly vertexBuffer: GPUBuffer;
	private readonly indexBuffer: GPUBuffer;
	private readonly indexCount: number;

	private instanceBuffer: GPUBuffer | null = null;
	private instanceCapacity = 0;
	private ranges: InstanceRanges = { opaque: 0, blended: 0, overlay: 0 };
	private pendingCapture: {
		resolve: (capture: FrameCapture) => void;
		reject: (cause: Error) => void;
	} | null = null;

	private depthTexture: GPUTexture | null = null;
	private msaaTexture: GPUTexture | null = null;
	private targetWidth = 0;
	private targetHeight = 0;

	private disposed = false;
	private deviceLost = false;

	/**
	 * Asks the browser for an adapter and a device. Throws rather than
	 * returning null so `createRenderer` can decide whether to fall back.
	 */
	static async create(options: RendererOptions): Promise<WebGPURenderer> {
		if (!('gpu' in navigator) || !navigator.gpu) {
			throw new RendererCreationError('webgpu', 'This browser does not expose navigator.gpu.');
		}

		let adapter: GPUAdapter | null;
		try {
			adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
		} catch (cause) {
			throw new RendererCreationError('webgpu', 'Requesting a GPU adapter failed.', cause);
		}
		if (!adapter) {
			throw new RendererCreationError('webgpu', 'No WebGPU adapter is available.');
		}

		let device: GPUDevice;
		try {
			device = await adapter.requestDevice();
		} catch (cause) {
			throw new RendererCreationError('webgpu', 'Requesting a GPU device failed.', cause);
		}

		const context = options.canvas.getContext('webgpu');
		if (!context) {
			device.destroy();
			throw new RendererCreationError('webgpu', 'The canvas would not give a webgpu context.');
		}

		/*
		 * Build everything inside an error scope.
		 *
		 * A pipeline that fails validation is not thrown, and it is not null
		 * either: WebGPU hands back an object marked invalid and only complains
		 * when something tries to use it. That turns one mistake in a shader
		 * into a wall of "invalid due to a previous error" once a frame, with
		 * the actual cause nowhere in sight — and, worse, an `auto` renderer
		 * that reports webgpu and draws nothing rather than falling back.
		 *
		 * So the scope is popped here and a failure becomes a creation error,
		 * which is what `createRenderer` already knows how to fall back from.
		 */
		device.pushErrorScope('validation');
		const renderer = new WebGPURenderer(options, device, context, adapter);
		const failure = await device.popErrorScope();
		if (failure) {
			renderer.dispose();
			throw new RendererCreationError(
				'webgpu',
				`A WebGPU pipeline failed validation: ${failure.message}`,
			);
		}

		return renderer;
	}

	private constructor(
		options: RendererOptions,
		device: GPUDevice,
		context: GPUCanvasContext,
		adapter: GPUAdapter,
	) {
		this.canvas = options.canvas;
		this.device = device;
		this.context = context;
		this.sampleCount = options.msaa === false ? 1 : 4;
		this.clearColor = options.clearColor ?? [0.77, 0.84, 0.78, 1];
		this.format = navigator.gpu.getPreferredCanvasFormat();

		// A device can go away long after it was handed over — a driver reset,
		// a GPU switch, or an adapter that only ever claimed to work. Nothing
		// throws when it happens; the picture simply stops changing. So say so.
		void device.lost.then((info) => {
			if (this.disposed) return;
			this.deviceLost = true;
			const reason = `${info.reason}: ${info.message}`;
			console.error(`[hexdelve] the WebGPU device was lost — ${reason}`);
			options.onDeviceLost?.(reason);
		});

		device.addEventListener('uncapturederror', (event) => {
			console.error('[hexdelve] WebGPU error:', (event as GPUUncapturedErrorEvent).error.message);
		});

		context.configure({
			device,
			format: this.format,
			alphaMode: 'opaque',
			// COPY_SRC so a frame can be read back off the GPU. It costs nothing
			// unless something asks, and it is the only way to see a WebGPU
			// picture at all: the canvas does not preserve its drawing buffer.
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});

		const geometry = hexPrismGeometry();
		this.indexCount = geometry.indexCount;

		this.vertexBuffer = createBufferWith(device, geometry.vertices, GPUBufferUsage.VERTEX);
		this.indexBuffer = createBufferWith(device, geometry.indices, GPUBufferUsage.INDEX);

		this.uniformBuffer = device.createBuffer({
			label: 'hexdelve:globals',
			size: UNIFORM_BYTES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const module = device.createShaderModule({ label: 'hexdelve:hex', code: HEX_SHADER });

		this.shadowMapSize = Math.min(
			options.shadowMapSize ?? 2048,
			device.limits.maxTextureDimension2D,
		);

		/*
		 * The shadow map exists even when shadows are off for a frame, because
		 * the bind group layout names it and a layout cannot have a hole in it.
		 * A 1x1 texture would do for that, but the size is fixed at
		 * construction anyway and this keeps one code path.
		 */
		if (this.shadowMapSize > 0) {
			this.shadowTexture = device.createTexture({
				label: 'hexdelve:shadow',
				size: { width: this.shadowMapSize, height: this.shadowMapSize },
				format: SHADOW_FORMAT,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
			this.shadowView = this.shadowTexture.createView();
			this.shadowUniformBuffer = device.createBuffer({
				label: 'hexdelve:shadow-globals',
				size: SHADOW_UNIFORM_BYTES,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			});
		} else {
			this.shadowTexture = null;
			this.shadowView = null;
			this.shadowUniformBuffer = null;
		}

		// Comparison filtering: the sampler does the depth test and blends the
		// results of four of them, which is a 2x2 percentage-closer filter for
		// the price of one tap.
		const shadowSampler = device.createSampler({
			label: 'hexdelve:shadow-sampler',
			compare: 'less-equal',
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});

		const bindGroupLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: 'uniform' },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: 'depth' },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: 'comparison' },
				},
			],
		});

		this.bindGroup = device.createBindGroup({
			layout: bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: this.uniformBuffer } },
				{ binding: 1, resource: this.shadowView! },
				{ binding: 2, resource: shadowSampler },
			],
		});

		const describePipeline = (
			label: string,
			blend: boolean,
			depthWrite: boolean,
			depthCompare: GPUCompareFunction,
		): GPURenderPipelineDescriptor => ({
			label,
			layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
			vertex: {
				module,
				entryPoint: 'vertexMain',
				buffers: [
					{
						arrayStride: HEX_VERTEX_STRIDE_BYTES,
						stepMode: 'vertex',
						attributes: [
							{ shaderLocation: 0, offset: 0, format: 'float32x3' },
							{ shaderLocation: 1, offset: 12, format: 'float32x3' },
						],
					},
					{
						arrayStride: HEX_INSTANCE_BYTES,
						stepMode: 'instance',
						attributes: [
							{ shaderLocation: 2, offset: 0, format: 'float32x4' },
							{ shaderLocation: 3, offset: 16, format: 'float32x4' },
							{ shaderLocation: 4, offset: 32, format: 'float32x4' },
							{ shaderLocation: 5, offset: 48, format: 'float32x4' },
						],
					},
				],
			},
			fragment: {
				module,
				entryPoint: 'fragmentMain',
				targets: [
					{
						format: this.format,
						...(blend
							? {
									blend: {
										color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
										alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
									},
								}
							: {}),
					},
				],
			},
			primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
			depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: depthWrite, depthCompare },
			multisample: { count: this.sampleCount },
		});

		/*
		 * WebGPU bakes blending and depth state into the pipeline rather than
		 * letting them be set between draws, so the three passes are three
		 * pipelines over one shader module and one vertex layout.
		 *
		 * The overlay pipeline compares 'always' instead of turning the depth
		 * test off: there is no such switch here, and a comparison that always
		 * passes is exactly what the WebGL2 side's disable(DEPTH_TEST) does.
		 */
		this.pipeline = device.createRenderPipeline(
			describePipeline('hexdelve:hex', false, true, 'less'),
		);
		this.blendedPipeline = device.createRenderPipeline(
			describePipeline('hexdelve:hex-blended', true, false, 'less'),
		);
		this.overlayPipeline = device.createRenderPipeline(
			describePipeline('hexdelve:hex-overlay', true, false, 'always'),
		);

		if (this.shadowMapSize > 0) {
			const depthModule = device.createShaderModule({
				label: 'hexdelve:shadow',
				code: DEPTH_SHADER,
			});
			const shadowLayout = device.createBindGroupLayout({
				entries: [
					{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
				],
			});
			this.shadowBindGroup = device.createBindGroup({
				layout: shadowLayout,
				entries: [{ binding: 0, resource: { buffer: this.shadowUniformBuffer! } }],
			});

			const colour = describePipeline('hexdelve:hex', false, true, 'less');
			this.shadowPipeline = device.createRenderPipeline({
				label: 'hexdelve:shadow-pipeline',
				layout: device.createPipelineLayout({ bindGroupLayouts: [shadowLayout] }),
				// The same vertex layout, so the same instance buffer feeds it.
				vertex: { ...colour.vertex, module: depthModule, entryPoint: 'vertexMain' },
				// No fragment stage at all: the pass writes depth and nothing else.
				primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' },
				depthStencil: { format: SHADOW_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
			});
		} else {
			this.shadowPipeline = null;
			this.shadowBindGroup = null;
		}

		this.info = {
			backend: 'webgpu',
			device: describeAdapter(adapter),
			msaaSamples: this.sampleCount,
			fellBack: false,
		};
	}

	get alive(): boolean {
		return !this.disposed && !this.deviceLost;
	}

	resize(width: number, height: number, pixelRatio: number): void {
		if (!this.alive) return;

		const limit = this.device.limits.maxTextureDimension2D;
		const w = Math.min(Math.max(1, Math.floor(width * pixelRatio)), limit);
		const h = Math.min(Math.max(1, Math.floor(height * pixelRatio)), limit);
		if (w === this.targetWidth && h === this.targetHeight) return;

		this.canvas.width = w;
		this.canvas.height = h;
		this.targetWidth = w;
		this.targetHeight = h;

		this.depthTexture?.destroy();
		this.depthTexture = this.device.createTexture({
			label: 'hexdelve:depth',
			size: { width: w, height: h },
			format: DEPTH_FORMAT,
			sampleCount: this.sampleCount,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});

		this.msaaTexture?.destroy();
		this.msaaTexture =
			this.sampleCount > 1
				? this.device.createTexture({
						label: 'hexdelve:msaa',
						size: { width: w, height: h },
						format: this.format,
						sampleCount: this.sampleCount,
						usage: GPUTextureUsage.RENDER_ATTACHMENT,
					})
				: null;
	}

	setInstances(data: Float32Array, ranges: InstanceRanges): void {
		if (!this.alive) return;
		this.ranges = ranges;
		const count = instanceTotal(ranges);
		if (count === 0) return;

		if (count > this.instanceCapacity) {
			this.instanceBuffer?.destroy();
			this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, 256);
			this.instanceBuffer = this.device.createBuffer({
				label: 'hexdelve:instances',
				size: this.instanceCapacity * HEX_INSTANCE_BYTES,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			});
		}

		this.device.queue.writeBuffer(
			this.instanceBuffer!,
			0,
			data.buffer,
			data.byteOffset,
			count * HEX_INSTANCE_BYTES,
		);
	}

	render(frame: Frame): void {
		if (!this.alive || !this.depthTexture) return;

		const { opaque, blended, overlay } = this.ranges;
		const shadow = this.shadowPipeline && frame.shadow ? frame.shadow : null;

		this.uniformData.set(frame.viewProjection, 0);
		if (shadow) this.uniformData.set(shadow.viewProjection, 16);
		else this.uniformData.fill(0, 16, 32);

		const d = frame.light.direction;
		this.uniformData[32] = d[0]!;
		this.uniformData[33] = d[1]!;
		this.uniformData[34] = d[2]!;
		this.uniformData[35] = frame.light.intensity;

		const ambient = frame.light.ambient;
		this.uniformData[36] = ambient[0]!;
		this.uniformData[37] = ambient[1]!;
		this.uniformData[38] = ambient[2]!;
		this.uniformData[39] = 0;

		this.uniformData[40] = shadow ? 1 : 0;
		this.uniformData[41] = shadow?.bias ?? 0.0025;
		this.uniformData[42] = 1 / this.shadowMapSize;
		this.uniformData[43] = 0;
		this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

		const swapchainTexture = this.context.getCurrentTexture();
		const swapchainView = swapchainTexture.createView();
		const [r, g, b, a] = this.clearColor;

		const colorAttachment: GPURenderPassColorAttachment = this.msaaTexture
			? {
					view: this.msaaTexture.createView(),
					resolveTarget: swapchainView,
					clearValue: { r, g, b, a },
					loadOp: 'clear',
					// The multisampled texture is only ever an intermediate;
					// discarding it lets the driver skip writing it back.
					storeOp: 'discard',
				}
			: {
					view: swapchainView,
					clearValue: { r, g, b, a },
					loadOp: 'clear',
					storeOp: 'store',
				};

		const encoder = this.device.createCommandEncoder({ label: 'hexdelve:frame' });

		/*
		 * The scene from the sun, depth only, before anything else.
		 *
		 * Only the opaque range casts. Smoke that shadowed the yard would be a
		 * lie about what smoke does, and the ground arrows are a readout — one
		 * that cast a shadow would be a very strange object indeed.
		 *
		 * Front faces are culled rather than back ones, so what is written is
		 * the far side of each prism. That is further from the light than the
		 * surface being tested, which removes most of the bias a flat face
		 * would otherwise need to stop shadowing itself.
		 */
		if (shadow && opaque > 0 && this.instanceBuffer) {
			this.shadowUniformData.set(shadow.viewProjection, 0);
			this.device.queue.writeBuffer(this.shadowUniformBuffer!, 0, this.shadowUniformData);

			const shadowPass = encoder.beginRenderPass({
				label: 'hexdelve:shadow-pass',
				colorAttachments: [],
				depthStencilAttachment: {
					view: this.shadowView!,
					depthClearValue: 1,
					depthLoadOp: 'clear',
					depthStoreOp: 'store',
				},
			});
			shadowPass.setPipeline(this.shadowPipeline!);
			shadowPass.setBindGroup(0, this.shadowBindGroup!);
			shadowPass.setVertexBuffer(0, this.vertexBuffer);
			shadowPass.setVertexBuffer(1, this.instanceBuffer);
			shadowPass.setIndexBuffer(this.indexBuffer, 'uint16');
			shadowPass.drawIndexed(this.indexCount, opaque);
			shadowPass.end();
		}

		const pass = encoder.beginRenderPass({
			colorAttachments: [colorAttachment],
			depthStencilAttachment: {
				view: this.depthTexture.createView(),
				depthClearValue: 1,
				depthLoadOp: 'clear',
				depthStoreOp: 'discard',
			},
		});

		if (opaque + blended + overlay > 0 && this.instanceBuffer) {
			pass.setBindGroup(0, this.bindGroup);
			pass.setVertexBuffer(0, this.vertexBuffer);
			pass.setVertexBuffer(1, this.instanceBuffer);
			pass.setIndexBuffer(this.indexBuffer, 'uint16');

			// firstInstance is core here, so the three spans are three draws
			// over one buffer with no rebinding.
			const draw = (pipeline: GPURenderPipeline, first: number, count: number): void => {
				if (count <= 0) return;
				pass.setPipeline(pipeline);
				pass.drawIndexed(this.indexCount, count, 0, 0, first);
			};

			draw(this.pipeline, 0, opaque);
			draw(this.blendedPipeline, opaque, blended);
			draw(this.overlayPipeline, opaque + blended, overlay);
		}

		pass.end();

		/*
		 * A readback, if one was asked for.
		 *
		 * The copy is encoded into this same command buffer rather than issued
		 * afterwards, so it is submitted with the frame it belongs to and there
		 * is no window in which the texture could be presented and recycled
		 * first. With multisampling the attachment is the MSAA texture and the
		 * swapchain is its resolve target, so this reads the resolved image
		 * either way.
		 */
		const capture = this.pendingCapture;
		let readback: { buffer: GPUBuffer; width: number; height: number; bytesPerRow: number } | null =
			null;
		if (capture) {
			this.pendingCapture = null;
			const width = this.targetWidth;
			const height = this.targetHeight;
			// A texture-to-buffer copy wants its rows aligned to 256 bytes, so
			// the buffer is wider than the image and is trimmed on the way out.
			const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
			const buffer = this.device.createBuffer({
				label: 'hexdelve:readback',
				size: bytesPerRow * height,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
			});
			encoder.copyTextureToBuffer(
				{ texture: swapchainTexture },
				{ buffer, bytesPerRow, rowsPerImage: height },
				{ width, height },
			);
			readback = { buffer, width, height, bytesPerRow };
		}

		this.device.queue.submit([encoder.finish()]);

		if (capture && readback) void this.resolveCapture(capture, readback);
	}

	/**
	 * Map the readback buffer and hand over the pixels.
	 *
	 * The preferred canvas format is usually bgra8unorm, so the bytes come back
	 * with red and blue the other way round from what the contract promises.
	 * Swizzling here rather than making the caller ask which format it got is
	 * the whole point of having a contract.
	 */
	private async resolveCapture(
		capture: { resolve: (c: FrameCapture) => void; reject: (e: Error) => void },
		readback: { buffer: GPUBuffer; width: number; height: number; bytesPerRow: number },
	): Promise<void> {
		const { buffer, width, height, bytesPerRow } = readback;
		try {
			await buffer.mapAsync(GPUMapMode.READ);
			const mapped = new Uint8Array(buffer.getMappedRange());
			const stride = width * 4;
			const pixels = new Uint8Array(stride * height);
			const swap = this.format.startsWith('bgra');

			for (let y = 0; y < height; y++) {
				const from = y * bytesPerRow;
				const to = y * stride;
				for (let x = 0; x < stride; x += 4) {
					pixels[to + x] = mapped[from + x + (swap ? 2 : 0)]!;
					pixels[to + x + 1] = mapped[from + x + 1]!;
					pixels[to + x + 2] = mapped[from + x + (swap ? 0 : 2)]!;
					pixels[to + x + 3] = mapped[from + x + 3]!;
				}
			}

			buffer.unmap();
			capture.resolve({ width, height, pixels });
		} catch (cause) {
			// A device lost between the submit and the map takes the readback
			// with it. Say so rather than hanging on a promise nobody resolves.
			capture.reject(cause instanceof Error ? cause : new Error(String(cause)));
		} finally {
			buffer.destroy();
		}
	}

	captureFrame(): Promise<FrameCapture> {
		if (!this.alive) return Promise.reject(new Error('The WebGPU device is gone.'));
		return new Promise((resolve, reject) => {
			this.pendingCapture = { resolve, reject };
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.depthTexture?.destroy();
		this.msaaTexture?.destroy();
		this.instanceBuffer?.destroy();
		this.vertexBuffer.destroy();
		this.indexBuffer.destroy();
		this.uniformBuffer.destroy();
		this.context.unconfigure();
		// Destroying a device that is already lost is a no-op, but asking for
		// it is not, so guard it rather than relying on the implementation.
		if (!this.deviceLost) this.device.destroy();
	}
}

/** Copies a typed array into a fresh GPU buffer of exactly its size. */
function createBufferWith(
	device: GPUDevice,
	data: Float32Array | Uint16Array,
	usage: GPUBufferUsageFlags,
): GPUBuffer {
	// mappedAtCreation needs a size that is a multiple of 4; the index array is
	// 16-bit, so it can land one short.
	const size = Math.ceil(data.byteLength / 4) * 4;
	const buffer = device.createBuffer({ size, usage, mappedAtCreation: true });
	const view =
		data instanceof Float32Array
			? new Float32Array(buffer.getMappedRange())
			: new Uint16Array(buffer.getMappedRange());
	view.set(data as never);
	buffer.unmap();
	return buffer;
}

function describeAdapter(adapter: GPUAdapter): string {
	// `info` is the standard property; older implementations only had the
	// promise-based `requestAdapterInfo`, which we cannot await here.
	const info = (adapter as { info?: GPUAdapterInfo }).info;
	if (!info) return 'WebGPU adapter';
	const parts = [info.vendor, info.architecture, info.description].filter(Boolean);
	return parts.length > 0 ? parts.join(' ') : 'WebGPU adapter';
}
