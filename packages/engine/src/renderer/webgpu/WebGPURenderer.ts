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
	type InstanceRanges,
	type Renderer,
	type RendererInfo,
	type RendererOptions,
} from '../types.js';
import { HEX_SHADER } from './shaders.js';

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
const UNIFORM_BYTES = 64 + 16 + 16;

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
	private readonly bindGroup: GPUBindGroup;
	private readonly uniformBuffer: GPUBuffer;
	private readonly uniformData = new Float32Array(UNIFORM_BYTES / 4);
	private readonly vertexBuffer: GPUBuffer;
	private readonly indexBuffer: GPUBuffer;
	private readonly indexCount: number;

	private instanceBuffer: GPUBuffer | null = null;
	private instanceCapacity = 0;
	private ranges: InstanceRanges = { opaque: 0, blended: 0, overlay: 0 };

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

		return new WebGPURenderer(options, device, context, adapter);
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

		context.configure({ device, format: this.format, alphaMode: 'opaque' });

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

		const bindGroupLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: 'uniform' },
				},
			],
		});

		this.bindGroup = device.createBindGroup({
			layout: bindGroupLayout,
			entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
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

		this.uniformData.set(frame.viewProjection, 0);
		const d = frame.light.direction;
		this.uniformData[16] = d[0]!;
		this.uniformData[17] = d[1]!;
		this.uniformData[18] = d[2]!;
		this.uniformData[19] = frame.light.intensity;
		const ambient = frame.light.ambient;
		this.uniformData[20] = ambient[0]!;
		this.uniformData[21] = ambient[1]!;
		this.uniformData[22] = ambient[2]!;
		this.uniformData[23] = 0;
		this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

		const swapchainView = this.context.getCurrentTexture().createView();
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
		const pass = encoder.beginRenderPass({
			colorAttachments: [colorAttachment],
			depthStencilAttachment: {
				view: this.depthTexture.createView(),
				depthClearValue: 1,
				depthLoadOp: 'clear',
				depthStoreOp: 'discard',
			},
		});

		const { opaque, blended, overlay } = this.ranges;
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
		this.device.queue.submit([encoder.finish()]);
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
