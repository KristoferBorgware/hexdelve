/*
 * WGSL for the instanced hex prism.
 *
 * The same lighting as the GLSL in ../webgl2/shaders.ts. Two differences are
 * forced by the API rather than chosen: the uniforms arrive as one struct in a
 * bind group instead of loose uniform calls, and clip-space depth runs 0..1,
 * which is handled in the projection matrix rather than here.
 */

export const HEX_SHADER = /* wgsl */ `
struct Globals {
	viewProjection : mat4x4<f32>,
	// xyz = direction towards the light, w = intensity
	light : vec4<f32>,
	// rgb = ambient, a unused
	ambient : vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals : Globals;

struct VertexIn {
	@location(0) position : vec3<f32>,
	@location(1) normal : vec3<f32>,
	// xyz = position, w = alpha
	@location(2) translation : vec4<f32>,
	// quaternion, xyzw
	@location(3) rotation : vec4<f32>,
	// xyz = scale, w = flags
	@location(4) scale : vec4<f32>,
	@location(5) color : vec4<f32>,
};

struct VertexOut {
	@builtin(position) clipPosition : vec4<f32>,
	@location(0) normal : vec3<f32>,
	@location(1) color : vec3<f32>,
	@location(2) alpha : f32,
	@location(3) @interpolate(flat) flags : f32,
};

// v rotated by the unit quaternion q.
fn rotate(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
	let t = 2.0 * cross(q.xyz, v);
	return v + q.w * t + cross(q.xyz, t);
}

@vertex
fn vertexMain(input : VertexIn) -> VertexOut {
	let world = rotate(input.position * input.scale.xyz, input.rotation)
		+ input.translation.xyz;

	var output : VertexOut;
	output.clipPosition = globals.viewProjection * vec4<f32>(world, 1.0);

	// Inverse scale, because the prisms are scaled non-uniformly.
	output.normal = normalize(rotate(input.normal / input.scale.xyz, input.rotation));
	output.color = input.color.rgb;
	output.alpha = input.translation.w;
	output.flags = input.scale.w;
	return output;
}

@fragment
fn fragmentMain(input : VertexOut) -> @location(0) vec4<f32> {
	// Flag bit 0: unlit, for readouts drawn into the world rather than things
	// standing in it.
	if (input.flags >= 1.0) {
		return vec4<f32>(input.color, input.alpha);
	}

	let n = normalize(input.normal);
	let key = max(dot(n, globals.light.xyz), 0.0) * globals.light.w;
	let fill = max(dot(n, vec3<f32>(-globals.light.x, 0.4, -globals.light.z)), 0.0) * 0.22;

	let lit = input.color * (globals.ambient.rgb + key + fill);
	return vec4<f32>(clamp(lit, vec3<f32>(0.0), vec3<f32>(1.0)), input.alpha);
}
`;
