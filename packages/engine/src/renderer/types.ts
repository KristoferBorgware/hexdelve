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

export interface Frame {
	readonly viewProjection: Mat4;
	readonly light: Light;
}

export interface RendererOptions {
	readonly canvas: HTMLCanvasElement;
	readonly backend?: BackendPreference;
	/** 4x multisampling, on by default. */
	readonly msaa?: boolean;
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
	 * Uploads the instance array. Call it when the scene changes, not every
	 * frame — a static field is uploaded once and drawn thereafter.
	 */
	setInstances(data: Float32Array, count: number): void;

	render(frame: Frame): void;

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
