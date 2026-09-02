/*
 * Where the sun has to stand to see the whole scene.
 *
 * A directional light has a direction and no position, so a shadow map needs
 * one invented for it: a box, aimed down the light, big enough to hold
 * everything that might cast. Fitting it to a sphere rather than to the exact
 * bounds is deliberate — a sphere looks the same from every angle, so the box
 * does not change size as the sun moves, and a shadow does not swim or change
 * resolution as the light turns.
 */

import { mat4, vec3, type DepthRange, type Mat4, type Vec3Like } from '@hexdelve/shared';

const eye = vec3.vec3();
const centre = vec3.vec3();
const up = vec3.vec3();
const view: Mat4 = mat4.mat4();
const projection: Mat4 = mat4.mat4();

export interface ShadowFit {
	/** Centre of the sphere the map must cover. */
	readonly center: Vec3Like;
	/** Radius of that sphere, in metres. */
	readonly radius: number;
}

/**
 * The light's view-projection for a shadow pass.
 *
 * @param direction unit vector pointing from the scene TOWARDS the light — the
 *                  same convention the shading uses, so one number describes
 *                  the sun rather than two that can disagree.
 */
export function directionalShadowMatrix(
	out: Mat4,
	direction: Vec3Like,
	fit: ShadowFit,
	depthRange: DepthRange,
): Mat4 {
	vec3.normalize(eye, direction);

	// Straight up would make the view matrix's own up vector parallel to the
	// line of sight, and there is then no way to say which way is up.
	const vertical = Math.abs(eye[1]!) > 0.99;
	vec3.set(up, vertical ? 0 : 0, vertical ? 0 : 1, vertical ? 1 : 0);

	vec3.copy(centre, fit.center);
	const distance = fit.radius * 2;
	vec3.scaleAndAdd(eye, centre, eye, distance);

	mat4.lookAt(view, eye, centre, up);
	mat4.ortho(
		projection,
		-fit.radius,
		fit.radius,
		-fit.radius,
		fit.radius,
		0.1,
		distance + fit.radius,
		depthRange,
	);
	return mat4.multiply(out, projection, view);
}
