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
layout(location = 2) in vec4 aTranslation;  // xyz = position, w = yaw
layout(location = 3) in vec4 aScale;        // xyz = radius, height, radius
layout(location = 4) in vec4 aColor;

uniform mat4 uViewProjection;

out vec3 vNormal;
out vec3 vColor;

vec3 rotateY(vec3 v, float yaw) {
	float s = sin(yaw);
	float c = cos(yaw);
	return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

void main() {
	vec3 world = rotateY(aPosition * aScale.xyz, aTranslation.w) + aTranslation.xyz;

	// The inverse scale, not the scale: prisms are scaled non-uniformly
	// (radius and height differ), which shears a normal that is merely rotated.
	vNormal = normalize(rotateY(aNormal / aScale.xyz, aTranslation.w));
	vColor = aColor.rgb;

	gl_Position = uViewProjection * vec4(world, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vColor;

uniform vec4 uLight;    // xyz = direction towards the light, w = intensity
uniform vec3 uAmbient;

out vec4 outColor;

void main() {
	vec3 n = normalize(vNormal);
	float key = max(dot(n, uLight.xyz), 0.0) * uLight.w;

	// A weak bounce from the opposite side, so a face turned away from the sun
	// is shaded rather than black.
	float fill = max(dot(n, vec3(-uLight.xyz.x, 0.4, -uLight.xyz.z)), 0.0) * 0.22;

	vec3 lit = vColor * (uAmbient + key + fill);
	outColor = vec4(clamp(lit, 0.0, 1.0), 1.0);
}
`;
