/*
 * @hexdelve/engine — everything between a canvas and a picture.
 *
 * The engine knows how to draw hexagonal prisms on a GPU, how to look at them,
 * and how to keep time. It knows nothing about a game: no characters, no
 * grid rules, no input. Those belong to the client, which is what makes the
 * client the package worth distributing.
 */

export {
	hexPrismGeometry,
	hexCorner,
	HEX_VERTEX_STRIDE_BYTES,
	HEX_VERTEX_STRIDE_FLOATS,
	type HexPrismGeometry,
} from './geometry/hexPrism.js';

export {
	HexInstances,
	HEX_INSTANCE_BYTES,
	HEX_INSTANCE_FLOATS,
	HEX_FLAG_NONE,
	HEX_FLAG_UNLIT,
	type ColorInput,
	type PrismOptions,
} from './scene/HexInstances.js';

export {
	Model,
	buildSkeletonView,
	type Part,
	type PartOptions,
	type EmitOptions,
	type SkeletonViewOptions,
} from './scene/Model.js';

export {
	directionalShadowMatrix,
	type ShadowFit,
} from './scene/shadow.js';

export {
	OrbitCamera,
	ISO_PITCH,
	type OrbitCameraOptions,
	type CameraProjection,
} from './scene/OrbitCamera.js';

/* The animation system: poses, clips, forward kinematics and two-bone IK. */
export {
	createPose,
	copyPose,
	clearPose,
	addPose,
	lerpPose,
	lerpPoseMasked,
	denseToSparse,
	sparseToDense,
	makeMask,
	setSparse,
	mixSparse,
	type DensePose,
	type SparsePose,
	type SparseBone,
} from './anim/pose.js';

export {
	buildClip,
	poseClip,
	mirrorPose,
	samplePose,
	bindClip,
	sampleBound,
	evalTrack,
	type Clip,
	type ClipSpec,
	type ClipEvent,
	type BoundClip,
	type Easing,
	type PoseKey,
	type PoseEntry,
	type RawKey,
} from './anim/clip.js';

export {
	solveWorld,
	attachmentPosition,
	boneNames,
	boneIndex,
	findBone,
	parentMap,
	type Bone,
	type BoneTip,
	type BoneWorld,
	type Skeleton,
	type WorldPose,
} from './anim/skeleton.js';

export {
	solveTwoBone,
	levelBone,
	type IkChain,
	type IkResult,
} from './anim/ik.js';

export {
	measureGroundSpeed,
	type GroundVelocity,
	type GroundSpeedOptions,
} from './anim/measure.js';

/*
 * Blend trees: a pose from a set of numbers rather than from a clip name.
 * Engine-side because everything it touches is — poses, clips, skeletons — and
 * nothing in it knows what a renderer is.
 */
export {
	BlendTree,
	clipSource,
	poseSource,
	leaf,
	blend1d,
	additive,
	layer,
	nodeChildren,
	type PoseSource,
	type BlendNode,
	type LeafNode,
	type LeafOptions,
	type Blend1DNode,
	type Blend1DEntry,
	type AdditiveNode,
	type LayerNode,
	type ActiveLeaf,
	type BlendTreeOptions,
	type Parameters,
} from './anim/blendtree.js';

export { Ticker, type TickerOptions, type FixedUpdate, type FrameUpdate } from './core/Ticker.js';

export { createRenderer, isWebGPUAvailable } from './renderer/createRenderer.js';

export {
	RendererCreationError,
	type BackendKind,
	type BackendPreference,
	type Frame,
	type Light,
	type Renderer,
	type RendererInfo,
	type RendererOptions,
	type InstanceRanges,
	type ShadowView,
	type FrameCapture,
} from './renderer/types.js';

export { instanceTotal } from './renderer/types.js';

export { WebGPURenderer } from './renderer/webgpu/WebGPURenderer.js';
export { WebGL2Renderer } from './renderer/webgl2/WebGL2Renderer.js';
