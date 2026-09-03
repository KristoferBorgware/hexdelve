/*
 * The contract both backends implement.
 *
 * The whole point of this file is that nothing above it — the client, the
 * editor, eventually the game — should be able to tell WebGPU from WebGL2.
 * Two things leak through on purpose, because pretending otherwise produces
 * silently wrong pictures rather than honest ones:
 *
 *   - `depthRange`, because the two APIs clip depth differently and the
 *     projection matrix has to be built for the right one;
 *   - `info`, because a user is entitled to know which one they got.
 */

import type { DepthRange, Mat4, Vec3Like } from '@hexdelve/shared';

export type BackendKind = 'webgpu' | 'webgl2';

/** What the caller asks for. `auto` prefers WebGPU and falls back to WebGL2. */
export type BackendPreference = 'auto' | BackendKind;

export interface RendererInfo {
	readonly backend: BackendKind;
	/** Human-readable adapter or GPU string, when the API will tell us. */
	readonly device: string;
	readonly msaaSamples: number;
	/** True when `auto` asked for WebGPU and had to settle for WebGL2. */
	readonly fellBack: boolean;
}

export interface Light {
	/** Unit vector pointing from the surface towards the key light. */
	readonly direction: Vec3Like;
	readonly intensity: number;
	/** Ambient colour, which doubles as the colour of the sky bounce. */
	readonly ambient: Vec3Like;
}

/**
 * Where the sun looks from, for the shadow pass.
 *
 * The caller supplies the matrix rather than the renderer deriving one,
 * because fitting it is a question about the scene — how far the world
 * extends and how much of it must be inside the map — and the renderer does
 * not know what is in the buffer it was handed.
 */
export interface ShadowView {
	readonly viewProjection: Mat4;
	/**
	 * Depth slack, in light-space units, before a surface shadows itself.
	 * Too little and a flat face stripes; too much and a foot floats free of
	 * its own shadow.
	 */
	readonly bias?: number;
}

export interface Frame {
	readonly viewProjection: Mat4;
	readonly light: Light;
	/** Omit or pass null to draw without shadows. */
	readonly shadow?: ShadowView | null;
}

/**
 * How the instance array is divided into passes.
 *
 * One buffer, drawn three times, because the order matters and the depth
 * buffer cannot sort transparency for us. Opaque first, so the depth buffer is
 * complete before anything reads it without writing. Then the blended pass —
 * smoke, the flecks a blow throws off, the tinted tile under the bat — which
 * tests depth so a puff behind a roof stays behind it, but does not write it,
 * since a transparent surface should not occlude what comes after. Then the
 * overlay, which skips the depth test entirely: the two ground arrows are a
 * readout of where he faces against where he is going, and a terrace half a
 * metre away would otherwise bury them.
 *
 * The three counts are consecutive spans of the same array, in this order.
 */
export interface InstanceRanges {
	readonly opaque: number;
	readonly blended: number;
	readonly overlay: number;
}

export function instanceTotal(ranges: InstanceRanges): number {
	return ranges.opaque + ranges.blended + ranges.overlay;
}

/** One frame's pixels, RGBA, eight bits a channel, top row first. */
export interface FrameCapture {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

export interface RendererOptions {
	readonly canvas: HTMLCanvasElement;
	readonly backend?: BackendPreference;
	/** 4x multisampling, on by default. */
	readonly msaa?: boolean;
	/** Shadow map resolution, square. 2048 by default; 0 turns shadows off. */
	readonly shadowMapSize?: number;
	/** Clear colour, r/g/b/a in 0..1. */
	readonly clearColor?: readonly [number, number, number, number];
	/**
	 * Called if the GPU takes the device away — a driver reset, a laptop
	 * switching graphics chip, a tab backgrounded too long, or a software
	 * adapter that was never really there. The renderer stops drawing at that
	 * point and cannot be revived: a context belongs to its canvas for the
	 * canvas's whole life, so recovering means a new canvas and a new renderer.
	 */
	readonly onDeviceLost?: (reason: string) => void;
}

export interface Renderer {
	readonly backend: BackendKind;
	readonly info: RendererInfo;
	/** False once the GPU has taken the device away. */
	readonly alive: boolean;
	/** The clip-space depth convention this backend needs projections built for. */
	readonly depthRange: DepthRange;

	/** Sizes the drawing buffer. `width`/`height` are CSS pixels. */
	resize(width: number, height: number, pixelRatio: number): void;

	/**
	 * Uploads the instance array, divided into the three passes above.
	 *
	 * Lab 9 rebuilds most of this every frame — a posed rig is a different set
	 * of prisms each time — so unlike a static field this is a per-frame call,
	 * and the buffer is sized to grow rather than reallocated.
	 */
	setInstances(data: Float32Array, ranges: InstanceRanges): void;

	render(frame: Frame): void;

	/**
	 * The pixels of the next frame drawn.
	 *
	 * Read off the GPU rather than off the page, which is the only way to get
	 * at a WebGPU picture: a WebGPU canvas does not preserve its drawing
	 * buffer, so toDataURL gives blank, and on a headless machine the
	 * compositor may never see the frame at all.
	 *
	 * What it is for is comparing the two backends. They are meant to draw the
	 * same picture from two shaders written twice, and until something diffs
	 * their output, "the same picture" rests entirely on whoever edited them
	 * last remembering to edit both.
	 */
	captureFrame(): Promise<FrameCapture>;

	dispose(): void;
}

/** Thrown when a backend cannot be created; carries which one was tried. */
export class RendererCreationError extends Error {
	constructor(
		readonly attempted: BackendKind,
		message: string,
		override readonly cause?: unknown,
	) {
		super(message);
		this.name = 'RendererCreationError';
	}
}
