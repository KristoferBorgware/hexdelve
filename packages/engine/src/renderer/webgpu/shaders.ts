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
	lightViewProjection : mat4x4<f32>,
	// xyz = direction towards the light, w = intensity
	light : vec4<f32>,
	// rgb = ambient, a unused
	ambient : vec4<f32>,
	// x = 1 when there is a shadow map, y = depth bias, z = texel size
	shadow : vec4<f32>,
};

@group(0) @binding(0) var<uniform> globals : Globals;
@group(0) @binding(1) var shadowMap : texture_depth_2d;
@group(0) @binding(2) var shadowSampler : sampler_comparison;

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
	@location(4) lightSpace : vec4<f32>,
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
	output.lightSpace = globals.lightViewProjection * vec4<f32>(world, 1.0);
	return output;
}

/*
 * How much of the sun reaches this fragment.
 *
 * WebGPU clips depth to 0..1 rather than -1..1, so only x and y are remapped
 * here — and y is flipped, because texture space runs down the screen and clip
 * space runs up it. That difference from the GLSL version is the API's, not a
 * choice.
 */
fn sunlight(lightSpace : vec4<f32>) -> f32 {
	if (globals.shadow.x < 0.5) {
		return 1.0;
	}

	let ndc = lightSpace.xyz / lightSpace.w;
	let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

	// Outside the map is lit, not shadowed: the alternative is a hard black
	// edge at the boundary of whatever the light was fitted to.
	if (ndc.z > 1.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		return 1.0;
	}

	let reference = ndc.z - globals.shadow.y;
	let texel = globals.shadow.z;
	var sum = 0.0;
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let at = uv + vec2<f32>(f32(x), f32(y)) * texel;
			sum = sum + textureSampleCompare(shadowMap, shadowSampler, at, reference);
		}
	}
	return sum / 9.0;
}

@fragment
fn fragmentMain(input : VertexOut) -> @location(0) vec4<f32> {
	// Flag bit 0: unlit, for readouts drawn into the world rather than things
	// standing in it.
	if (input.flags >= 1.0) {
		return vec4<f32>(input.color, input.alpha);
	}

	let n = normalize(input.normal);
	let facing = max(dot(n, globals.light.xyz), 0.0);

	// A face turned away from the sun is already dark; running it through the
	// shadow test as well only adds acne along the terminator.
	var shade = 1.0;
	if (facing > 0.0) {
		shade = sunlight(input.lightSpace);
	}
	let key = facing * globals.light.w * shade;
	let fill = max(dot(n, vec3<f32>(-globals.light.x, 0.4, -globals.light.z)), 0.0) * 0.22;

	let lit = input.color * (globals.ambient.rgb + key + fill);
	return vec4<f32>(clamp(lit, vec3<f32>(0.0), vec3<f32>(1.0)), input.alpha);
}
`;

/*
 * The shadow pass: the same instance transform and no fragment stage at all.
 * WebGPU allows a pipeline with only a vertex stage when the pass writes depth
 * and nothing else, which is exactly what this is.
 */
export const DEPTH_SHADER = /* wgsl */ `
struct DepthGlobals {
	lightViewProjection : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> globals : DepthGlobals;

struct VertexIn {
	@location(0) position : vec3<f32>,
	@location(1) normal : vec3<f32>,
	@location(2) translation : vec4<f32>,
	@location(3) rotation : vec4<f32>,
	@location(4) scale : vec4<f32>,
	@location(5) color : vec4<f32>,
};

fn rotate(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
	let t = 2.0 * cross(q.xyz, v);
	return v + q.w * t + cross(q.xyz, t);
}

@vertex
fn vertexMain(input : VertexIn) -> @builtin(position) vec4<f32> {
	let world = rotate(input.position * input.scale.xyz, input.rotation)
		+ input.translation.xyz;
	return globals.lightViewProjection * vec4<f32>(world, 1.0);
}
`;
