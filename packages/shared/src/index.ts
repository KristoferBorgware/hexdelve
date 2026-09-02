/*
 * @hexdelve/shared — the base every other package sits on.
 *
 * Nothing in here touches a GPU, the DOM or a framework: it is the maths, the
 * hex coordinate system and the small utilities that the engine, the client
 * and the editor all need to agree about. It has no dependencies and never
 * should.
 */

export * as vec3 from './math/vec3.js';
export * as mat4 from './math/mat4.js';

export type { Vec3, Vec3Like } from './math/vec3.js';
export type { Mat4, Mat4Like, DepthRange } from './math/mat4.js';

export * from './hex/axial.js';
export * from './random.js';
export * from './color.js';
