/*
 * Assets as files rather than as source.
 *
 * The engine holds the readers for the same reason it holds the blend tree:
 * everything they touch — bones, poses, clips, prisms — is already here, and
 * nothing in them knows what a renderer is. What the engine does NOT hold is
 * any actual asset, or any pose function. Those belong to whoever owns the
 * characters, which is the client.
 */

export { AssetError, Node, type Vec3 } from './document.js';
export {
	fetchIO,
	memoryIO,
	readOnly,
	type AssetIO,
	type AssetIOKind,
	type AssetWriter,
} from './io.js';

export {
	ComponentRegistry,
	instantiate,
	type ComponentContext,
	type ComponentFactory,
	type InstantiateOptions,
} from './instantiate.js';

export {
	emptyPrefab,
	prefabScripts,
	type PrefabScript,
	prefabTypes,
	readPrefabNode,
	unknownComponent,
	type ComponentSpec,
	type PrefabNode,
} from './prefab.js';

export { loadSystem, type SystemAsset } from './system.js';

export { loadRig, type RigAnchor, type RigAsset, type RigView } from './rig.js';
export { loadMesh, type Anchor, type MeshAsset } from './mesh.js';
export { readClip, buildClipAsset, type ClipAsset, type ClipDocument } from './clip.js';
export {
	clipAnimation,
	poseFunctionAnimation,
	type AnimationAsset,
	type AnimationOptions,
} from './animation.js';
export { loadBlendTree, type BlendTreeAsset, type TreeParameter } from './blendtree.js';
export {
	componentAssets,
	entityAnimations,
	entityAttachment,
	entityBlendTrees,
	entityMesh,
	entityRig,
	findComponent,
	readAnimations,
	readAttachment,
	readEntity,
	ANIMATOR_KEYS,
	ATTACH_KEYS,
	ENTITY_KEYS,
	MESH_COMPONENT_KEYS,
	RIG_COMPONENT_KEYS,
	type AnimationRequest,
	type Attachment,
	type ClipRequest,
	type EntityAsset,
	type EntityDocument,
	type ProceduralRequest,
} from './entity.js';
export { assetsUnder, NO_ASSETS, type ComponentAssets } from './binding.js';
export {
	PoseFunctionRegistry,
	type PoseFunction,
	type PoseFunctionContext,
	type PoseSampler,
} from './poseFunctions.js';
export {
	AssetLibrary,
	AssetWriteError,
	normalise,
	resolve,
	type AssetLibraryOptions,
} from './library.js';
export {
	emitYaml,
	writeComponent,
	writeClip,
	writeEntity,
	type ClipFile,
	writePrefabNode,
	type Emittable,
} from './emit.js';
