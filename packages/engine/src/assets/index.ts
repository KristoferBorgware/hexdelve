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
	readEntity,
	ENTITY_KEYS,
	type AnimationRequest,
	type Attachment,
	type ClipRequest,
	type EntityAsset,
	type EntityDocument,
	type EntityKind,
	type Grounding,
	type ProceduralRequest,
} from './entity.js';
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
