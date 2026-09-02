/*
 * GLSL ES 3.00 for the instanced hex prism.
 *
 * Deliberately the same maths as the WGSL in ../webgpu/shaders.ts, written
 * twice rather than generated, so a change to the lighting has to be made in
 * both places and the two pictures cannot quietly drift apart.
 */

/** The instance transform, shared by both programs so they cannot disagree. */
const INSTANCE_TRANSFORM = `
// v rotated by the unit quaternion q: v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
vec3 rotate(vec3 v, vec4 q) {
	vec3 t = 2.0 * cross(q.xyz, v);
	return v + q.w * t + cross(q.xyz, t);
}
`;

export const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aTranslation;  // xyz = position, w = alpha
layout(location = 3) in vec4 aRotation;     // quaternion, xyzw
layout(location = 4) in vec4 aScale;        // xyz = scale, w = flags
layout(location = 5) in vec4 aColor;

uniform mat4 uViewProjection;
uniform mat4 uLightViewProjection;

out vec3 vNormal;
out vec3 vColor;
out float vAlpha;
out float vFlags;
out vec4 vLightSpace;
${INSTANCE_TRANSFORM}
void main() {
	vec3 world = rotate(aPosition * aScale.xyz, aRotation) + aTranslation.xyz;

	// The inverse scale, not the scale: prisms are scaled non-uniformly — a
	// sword blade is long, narrow and thin — which shears a normal that is
	// merely rotated.
	vNormal = normalize(rotate(aNormal / aScale.xyz, aRotation));
	vColor = aColor.rgb;
	vAlpha = aTranslation.w;
	vFlags = aScale.w;
	vLightSpace = uLightViewProjection * vec4(world, 1.0);

	gl_Position = uViewProjection * vec4(world, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

in vec3 vNormal;
in vec3 vColor;
in float vAlpha;
in float vFlags;
in vec4 vLightSpace;

uniform vec4 uLight;    // xyz = direction towards the light, w = intensity
uniform vec3 uAmbient;
// x = 1 when there is a shadow map, y = depth bias, z = texel size
uniform vec3 uShadow;
uniform sampler2DShadow uShadowMap;

out vec4 outColor;

/*
 * How much of the sun reaches this fragment.
 *
 * The comparison sampler does the depth test in hardware and filters the
 * result, so each tap is already bilinear between four texels; nine of them on
 * a one-texel grid is a soft enough edge for a scene made of flat faces
 * without a Poisson disc or a noise texture.
 */
float sunlight() {
	if (uShadow.x < 0.5) return 1.0;

	vec3 coord = vLightSpace.xyz / vLightSpace.w;
	coord = coord * 0.5 + 0.5;

	// Outside the map is lit, not shadowed: the alternative is a hard black
	// edge at the boundary of whatever the light was fitted to.
	if (coord.z > 1.0 || coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) {
		return 1.0;
	}

	float reference = coord.z - uShadow.y;
	float sum = 0.0;
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 at = coord.xy + vec2(float(x), float(y)) * uShadow.z;
			sum += texture(uShadowMap, vec3(at, reference));
		}
	}
	return sum / 9.0;
}

void main() {
	// Flag bit 0: draw this prism at its own colour. The ground arrows and the
	// tile markers are readouts rather than things in the yard, and shading
	// them would make a white arrow change colour with the time of day.
	if (vFlags >= 1.0) {
		outColor = vec4(vColor, vAlpha);
		return;
	}

	vec3 n = normalize(vNormal);
	float facing = max(dot(n, uLight.xyz), 0.0);

	// A face turned away from the sun is already dark; running it through the
	// shadow test as well only adds acne along the terminator.
	float key = facing * uLight.w * (facing > 0.0 ? sunlight() : 1.0);

	// A weak bounce from the opposite side, so a face turned away from the sun
	// is shaded rather than black.
	float fill = max(dot(n, vec3(-uLight.xyz.x, 0.4, -uLight.xyz.z)), 0.0) * 0.22;

	vec3 lit = vColor * (uAmbient + key + fill);
	outColor = vec4(clamp(lit, 0.0, 1.0), vAlpha);
}
`;

/*
 * The shadow pass: the same instance transform, and nothing else. There is no
 * colour attachment, so the fragment shader exists only because GLSL insists
 * on one.
 */

export const DEPTH_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec4 aTranslation;
layout(location = 3) in vec4 aRotation;
layout(location = 4) in vec4 aScale;

uniform mat4 uLightViewProjection;
${INSTANCE_TRANSFORM}
void main() {
	vec3 world = rotate(aPosition * aScale.xyz, aRotation) + aTranslation.xyz;
	gl_Position = uLightViewProjection * vec4(world, 1.0);
}
`;

export const DEPTH_FRAGMENT_SHADER = `#version 300 es
precision highp float;
void main() {}
`;
