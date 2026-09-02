/*
 * The camera every Hexdelve scene is looked at through: a point on the ground,
 * a distance, and two angles. Isometric in feel rather than in projection —
 * a narrow field of view from a long way out, which keeps the hexes reading as
 * hexes without the depth cues going flat.
 */

import { mat4, vec3, type DepthRange, type Mat4, type Vec3 } from '@hexdelve/shared';

const UP = vec3.vec3(0, 1, 0);

/**
 * Perspective for a scene someone is inspecting; orthographic for the game,
 * which is drawn the way the labs draw it — a fixed isometric pitch, no
 * convergence, so a hexagon is the same hexagon wherever it sits on screen.
 */
export type CameraProjection = 'perspective' | 'orthographic';

/** The isometric pitch: the angle at which a unit cube's diagonal is vertical. */
export const ISO_PITCH = Math.atan(1 / Math.SQRT2);

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
	projection?: CameraProjection;
	/** Orthographic only: half the world height the viewport spans at zoom 1. */
	viewHeight?: number;
	/** Orthographic only: larger is closer in. */
	zoom?: number;
}

export class OrbitCamera {
	readonly target: Vec3;
	distance: number;
	yaw: number;
	pitch: number;
	fovY: number;
	near: number;
	far: number;
	projection: CameraProjection;
	viewHeight: number;
	zoom: number;

	minDistance = 3;
	maxDistance = 120;
	minPitch = 0.08;
	maxPitch = Math.PI / 2 - 0.05;

	private readonly eyeScratch = vec3.vec3();
	private readonly view: Mat4 = mat4.mat4();
	private readonly projectionMatrix: Mat4 = mat4.mat4();
	private readonly viewProjection: Mat4 = mat4.mat4();

	constructor(options: OrbitCameraOptions = {}) {
		this.target = options.target ?? vec3.vec3(0, 0, 0);
		this.distance = options.distance ?? 22;
		this.yaw = options.yaw ?? Math.PI * 0.25;
		this.pitch = options.pitch ?? 0.62;
		this.fovY = options.fovY ?? 0.6;
		this.near = options.near ?? 0.1;
		this.far = options.far ?? 500;
		this.projection = options.projection ?? 'perspective';
		this.viewHeight = options.viewHeight ?? 5.5;
		this.zoom = options.zoom ?? 1;
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

	/**
	 * Multiplicative, so a wheel notch moves the same proportion at any range.
	 *
	 * Which quantity it moves depends on the projection, because they are not
	 * the same thing: dollying an orthographic camera changes nothing at all
	 * about the picture, since parallel rays do not converge. So perspective
	 * moves the eye and orthographic scales the frustum.
	 */
	dolly(factor: number): void {
		if (this.projection === 'orthographic') {
			this.zoom = clamp(this.zoom / factor, this.minZoom, this.maxZoom);
		} else {
			this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
		}
	}

	minZoom = 0.6;
	maxZoom = 4;

	/** Slides the target across the ground plane, in the camera's own frame. */
	pan(right: number, forward: number): void {
		const sin = Math.sin(this.yaw);
		const cos = Math.cos(this.yaw);
		this.target[0] = this.target[0]! + right * cos - forward * sin;
		this.target[2] = this.target[2]! - right * sin - forward * cos;
	}

	/**
	 * Where a point on the screen lands on a horizontal plane.
	 *
	 * The basis is read out of the view matrix rather than derived a second
	 * time from the yaw and pitch, and that is the whole point of this living
	 * here. A second derivation is a second chance to get a sign wrong, and
	 * that is exactly what happened: the camera's up vector had its horizontal
	 * half negated, which left the cursor tracking correctly across the screen
	 * and moving the aim only a third as far up and down it. Reading the basis
	 * out of the matrix the renderer actually draws with means the two cannot
	 * disagree about where the camera is pointing.
	 *
	 * @param ndcX  -1 at the left edge of the viewport, +1 at the right
	 * @param ndcY  -1 at the bottom, +1 at the top
	 * @returns the point, or null if the ray runs away from the plane
	 */
	groundPoint(
		ndcX: number,
		ndcY: number,
		aspect: number,
		planeY: number,
	): { x: number; z: number } | null {
		const eye = this.eye();
		mat4.lookAt(this.view, eye, this.target, UP);
		const m = this.view;

		// Columns of the rotation: right, up, and back along the view.
		const rightX = m[0]!;
		const rightY = m[4]!;
		const rightZ = m[8]!;
		const upX = m[1]!;
		const upY = m[5]!;
		const upZ = m[9]!;
		const forwardX = -m[2]!;
		const forwardY = -m[6]!;
		const forwardZ = -m[10]!;

		let ox: number;
		let oy: number;
		let oz: number;
		let dx: number;
		let dy: number;
		let dz: number;

		if (this.projection === 'orthographic') {
			// Every ray is parallel, so the screen position moves the origin
			// and the direction is the same for all of them.
			const halfHeight = this.viewHeight / this.zoom;
			const halfWidth = halfHeight * aspect;
			ox = eye[0]! + rightX * ndcX * halfWidth + upX * ndcY * halfHeight;
			oy = eye[1]! + rightY * ndcX * halfWidth + upY * ndcY * halfHeight;
			oz = eye[2]! + rightZ * ndcX * halfWidth + upZ * ndcY * halfHeight;
			dx = forwardX;
			dy = forwardY;
			dz = forwardZ;
		} else {
			// Rays all leave the eye; the screen position tilts the direction.
			const tan = Math.tan(this.fovY / 2);
			ox = eye[0]!;
			oy = eye[1]!;
			oz = eye[2]!;
			dx = forwardX + rightX * ndcX * tan * aspect + upX * ndcY * tan;
			dy = forwardY + rightY * ndcX * tan * aspect + upY * ndcY * tan;
			dz = forwardZ + rightZ * ndcX * tan * aspect + upZ * ndcY * tan;
		}

		if (Math.abs(dy) < 1e-9) return null;
		const t = (planeY - oy) / dy;
		if (t < 0) return null;

		return { x: ox + dx * t, z: oz + dz * t };
	}

	/**
	 * The combined matrix for a frame. `depthRange` comes from the renderer,
	 * because WebGPU and WebGL do not agree about clip space.
	 */
	matrix(aspect: number, depthRange: DepthRange): Mat4 {
		mat4.lookAt(this.view, this.eye(), this.target, UP);
		if (this.projection === 'orthographic') {
			const halfHeight = this.viewHeight / this.zoom;
			const halfWidth = halfHeight * aspect;
			mat4.ortho(
				this.projectionMatrix,
				-halfWidth,
				halfWidth,
				-halfHeight,
				halfHeight,
				this.near,
				this.far,
				depthRange,
			);
		} else {
			mat4.perspective(this.projectionMatrix, this.fovY, aspect, this.near, this.far, depthRange);
		}
		return mat4.multiply(this.viewProjection, this.projectionMatrix, this.view);
	}
}

function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}
