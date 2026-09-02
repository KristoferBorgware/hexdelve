/*
 * GLSL ES 3.00 for the instanced hex prism.
 *
 * Deliberately the same maths as the WGSL in ../webgpu/shaders.ts, written
 * twice rather than generated, so a change to the lighting has to be made in
 * both places and the two pictures cannot quietly drift apart.
 */

export const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aTranslation;  // xyz = position, w = alpha
layout(location = 3) in vec4 aRotation;     // quaternion, xyzw
layout(location = 4) in vec4 aScale;        // xyz = scale, w = flags
layout(location = 5) in vec4 aColor;

uniform mat4 uViewProjection;

out vec3 vNormal;
out vec3 vColor;
out float vAlpha;
out float vFlags;

// v rotated by the unit quaternion q: v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
vec3 rotate(vec3 v, vec4 q) {
	vec3 t = 2.0 * cross(q.xyz, v);
	return v + q.w * t + cross(q.xyz, t);
}

void main() {
	vec3 world = rotate(aPosition * aScale.xyz, aRotation) + aTranslation.xyz;

	// The inverse scale, not the scale: prisms are scaled non-uniformly — a
	// sword blade is long, narrow and thin — which shears a normal that is
	// merely rotated.
	vNormal = normalize(rotate(aNormal / aScale.xyz, aRotation));
	vColor = aColor.rgb;
	vAlpha = aTranslation.w;
	vFlags = aScale.w;

	gl_Position = uViewProjection * vec4(world, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;
in float vAlpha;
in float vFlags;

uniform vec4 uLight;    // xyz = direction towards the light, w = intensity
uniform vec3 uAmbient;

out vec4 outColor;

void main() {
	// Flag bit 0: draw this prism at its own colour. The ground arrows and the
	// tile markers are readouts rather than things in the yard, and shading
	// them would make a white arrow change colour with the time of day.
	if (vFlags >= 1.0) {
		outColor = vec4(vColor, vAlpha);
		return;
	}

	vec3 n = normalize(vNormal);
	float key = max(dot(n, uLight.xyz), 0.0) * uLight.w;

	// A weak bounce from the opposite side, so a face turned away from the sun
	// is shaded rather than black.
	float fill = max(dot(n, vec3(-uLight.xyz.x, 0.4, -uLight.xyz.z)), 0.0) * 0.22;

	vec3 lit = vColor * (uAmbient + key + fill);
	outColor = vec4(clamp(lit, 0.0, 1.0), vAlpha);
}
`;
