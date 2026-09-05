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

/*
 * The scene graph: what a thing IS, as against what it looks like.
 *
 * A game object is a place in a tree with components attached, and every piece
 * of behaviour is one of those components. Engine-side because nothing in it
 * knows what a renderer is — a scene is solved, and what a frame is drawn into
 * is somebody else's question.
 */
export { GameObject, type GameObjectOptions } from './scene/GameObject.js';

/*
 * The components the engine itself defines. A game's own live in the game:
 * `actor` and `item` are hexdelve's vocabulary, where a script is the engine's
 * answer to how an object gets behaviour.
 */
export { Component, type ComponentClass } from './scene/components/Component.js';
export { Animator } from './scene/components/Animator.js';
export { Attach } from './scene/components/Attach.js';
export { FootIK, type GroundHeight } from './scene/components/FootIK.js';
export { MeshRenderer } from './scene/components/MeshRenderer.js';
export { Particles } from './scene/components/Particles.js';
export { Rig } from './scene/components/Rig.js';
export { registerSceneComponents } from './scene/components/factories.js';
export { Script, type ScriptBinding } from './scene/components/Script.js';

/*
 * What a component exposes, and the walk that collects it — the editor's side
 * of the object model. A component declares the fields it is willing to have
 * set with `param`; a tree view reads them off whatever is selected.
 */
export {
	applyParameters,
	learnParameters,
	liveParameters,
	param,
	parameterKeys,
	parametersOf,
	readParameters,
	resolveParameters,
	writeParameter,
	type ComponentType,
	type LiveParameter,
	type ParameterMeta,
	type ParameterOptions,
	type ParameterType,
	type Widen,
} from './scene/components/parameters.js';
export {
	inspectComponent,
	inspectComponents,
	inspectObject,
	type ComponentView,
	type ObjectView,
} from './scene/components/inspect.js';

export { Scene, type SceneOptions } from './scene/Scene.js';

/*
 * Particles: hexagons thrown out of an emitter and driven over their lives.
 *
 * Engine-side for the reason everything else here is — an effect is a pile of
 * prisms with a clock on it, and nothing in it knows what a bat is. The shape
 * of one is `ParticleEffect`, the running of one is `ParticleSystem`, and
 * putting one on an object is the `Particles` component above.
 */
export {
	defaultEffect,
	exactly,
	sampleCurve,
	sampleGradient,
	type AlphaSpec,
	type ColorSpec,
	type ColorStop,
	type EmitShape,
	type EmitShapeKind,
	type EmitSpec,
	type MotionSpec,
	type ParticleEffect,
	type ParticleSpec,
	type Range,
	type SizeSpec,
	type SpinSpec,
	type Stop,
} from './particles/effect.js';
export {
	ParticleSystem,
	PARTICLE_FLOATS,
	type ParticleSystemOptions,
} from './particles/ParticleSystem.js';

export {
	Transform,
	composeWorld,
	type Point,
	type WorldTransform,
} from './scene/Transform.js';

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

export {
	calibrateSpeed,
	type SpeedCalibration,
	type SpeedSample,
	type CalibrateSpeedOptions,
} from './anim/calibrate.js';

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

/*
 * Assets read from files rather than typed into modules — the entity file and
 * everything it links to. Engine-side because everything the readers touch
 * (bones, poses, clips, prisms) already is, and nothing in them knows what a
 * renderer is.
 */
export {
	AssetError,
	AssetLibrary,
	buildClipAsset,
	clipAnimation,
	ENTITY_KEYS,
	AssetWriteError,
	loadBlendTree,
	loadMesh,
	loadRig,
	Node as AssetNode,
	normalise as normaliseAssetPath,
	poseFunctionAnimation,
	PoseFunctionRegistry,
	readClip,
	readEntity,
	resolve as resolveAssetPath,
	type Anchor,
	type AnimationAsset,
	type AnimationOptions,
	type AnimationRequest,
	type AssetLibraryOptions,
	fetchIO,
	memoryIO,
	readOnly,
	type AssetIO,
	type AssetIOKind,
	type AssetWriter,
	type Attachment,
	type BlendTreeAsset,
	type ClipAsset,
	type ClipDocument,
	type ClipRequest,
	type ComponentAssets,
	type EntityAsset,
	type EntityDocument,
	type MeshAsset,
	type PoseFunction,
	type PoseFunctionContext,
	type PoseSampler,
	type ProceduralRequest,
	type RigAnchor,
	type RigAsset,
	type RigView,
	type TreeParameter,
	type Vec3 as AssetVec3,
	assetsUnder,
	componentAssets,
	entityAnimations,
	entityAttachment,
	entityBlendTrees,
	entityMesh,
	entityRig,
	findComponent,
	readAnimations,
	readAttachment,
	ANIMATOR_KEYS,
	ATTACH_KEYS,
	MESH_COMPONENT_KEYS,
	NO_ASSETS,
	PARTICLES_COMPONENT_KEYS,
	parseParticleEffect,
	particleEffectDocument,
	readParticleEffect,
	writeParticleEffect,
	RIG_COMPONENT_KEYS,
	ComponentRegistry,
	instantiate,
	loadSystem,
	emitYaml,
	hexLiteral,
	Literal,
	writeComponent,
	writeEntity,
	writePrefabNode,
	type Emittable,
	emptyPrefab,
	prefabScripts,
	type PrefabScript,
	prefabTypes,
	readPrefabNode,
	unknownComponent,
	type ComponentContext,
	type ComponentFactory,
	type ComponentSpec,
	type InstantiateOptions,
	type PrefabNode,
	type SystemAsset,
} from './assets/index.js';

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

/*
 * Scripting: behaviour as a component, and the host that runs it.
 *
 * In the engine rather than beside it, because a script is not a game concept.
 * `actor` and `item` are hexdelve's vocabulary and the engine has never heard
 * of them; a SCRIPT is the engine's own answer to how a game object gets
 * behaviour, the same way `Component` is. Splitting it out asked every reader
 * to hold a boundary that protected nobody — the game and the engine go
 * together here and always will.
 *
 * What is NOT here, and must not arrive: the compiler and the hot reload. Those
 * are authoring tools, they live in the editor, and a production runtime that
 * carried a WebAssembly toolchain would have stopped being one.
 */
export * from './scripting/index.js';
