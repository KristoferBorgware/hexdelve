/*
 * The camera every Hexdelve scene is looked at through: a point on the ground,
 * a distance, and two angles. Isometric in feel rather than in projection —
 * a narrow field of view from a long way out, which keeps the hexes reading as
 * hexes without the depth cues going flat.
 */

import { mat4, vec3, type DepthRange, type Mat4, type Vec3 } from '@hexdelve/shared';

const UP = vec3.vec3(0, 1, 0);

export interface OrbitCameraOptions {
	target?: Vec3;
	distance?: number;
	/** Radians about +Y. Zero looks along -Z. */
	yaw?: number;
	/** Radians above the horizon. Clamped away from the poles. */
	pitch?: number;
	fovY?: number;
	near?: number;
	far?: number;
}

export class OrbitCamera {
	readonly target: Vec3;
	distance: number;
	yaw: number;
	pitch: number;
	fovY: number;
	near: number;
	far: number;

	minDistance = 3;
	maxDistance = 120;
	minPitch = 0.08;
	maxPitch = Math.PI / 2 - 0.05;

	private readonly eyeScratch = vec3.vec3();
	private readonly view: Mat4 = mat4.mat4();
	private readonly projection: Mat4 = mat4.mat4();
	private readonly viewProjection: Mat4 = mat4.mat4();

	constructor(options: OrbitCameraOptions = {}) {
		this.target = options.target ?? vec3.vec3(0, 0, 0);
		this.distance = options.distance ?? 22;
		this.yaw = options.yaw ?? Math.PI * 0.25;
		this.pitch = options.pitch ?? 0.62;
		this.fovY = options.fovY ?? 0.6;
		this.near = options.near ?? 0.1;
		this.far = options.far ?? 500;
	}

	/** Where the eye currently sits. The returned vector is reused. */
	eye(): Vec3 {
		const cosPitch = Math.cos(this.pitch);
		return vec3.set(
			this.eyeScratch,
			this.target[0]! + this.distance * cosPitch * Math.sin(this.yaw),
			this.target[1]! + this.distance * Math.sin(this.pitch),
			this.target[2]! + this.distance * cosPitch * Math.cos(this.yaw),
		);
	}

	orbit(deltaYaw: number, deltaPitch: number): void {
		this.yaw += deltaYaw;
		this.pitch = clamp(this.pitch + deltaPitch, this.minPitch, this.maxPitch);
	}

	/** Multiplicative so a wheel notch moves the same proportion at any range. */
	zoom(factor: number): void {
		this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
	}

	/** Slides the target across the ground plane, in the camera's own frame. */
	pan(right: number, forward: number): void {
		const sin = Math.sin(this.yaw);
		const cos = Math.cos(this.yaw);
		this.target[0] = this.target[0]! + right * cos - forward * sin;
		this.target[2] = this.target[2]! - right * sin - forward * cos;
	}

	/**
	 * The combined matrix for a frame. `depthRange` comes from the renderer,
	 * because WebGPU and WebGL do not agree about clip space.
	 */
	matrix(aspect: number, depthRange: DepthRange): Mat4 {
		mat4.lookAt(this.view, this.eye(), this.target, UP);
		mat4.perspective(this.projection, this.fovY, aspect, this.near, this.far, depthRange);
		return mat4.multiply(this.viewProjection, this.projection, this.view);
	}
}

function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}
