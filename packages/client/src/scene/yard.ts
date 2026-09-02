/*
 * The yard — a terraced hex field with a cabin and an anvil on it.
 *
 * This is a placeholder scene, and it is worth saying what it is a placeholder
 * for. Lab 09 draws this world with Three.js from `labs/shared/`; the plan is
 * for that world to be rebuilt here on the engine's own renderer. Until then
 * this builds enough of it — the terraces, the log walls, a roof, an anvil —
 * to prove the instance path end to end and to give the editor something to
 * frame.
 *
 * Every prism is placed exactly the way the labs place them: hexes on the
 * axial grid from `@hexdelve/shared`, heights in whole terrace steps.
 */

import { HexInstances } from '@hexdelve/engine';
import {
	axialDisc,
	axialToWorld,
	jitter,
	makeRandom,
	rgbFromHex,
	type Rgb,
} from '@hexdelve/shared';

export const TILE_RADIUS = 1;
export const TERRACE_STEP = 0.19;
export const GROUND_Y = 0.16;

const GRASS = rgbFromHex(0x6f8f4a);
const GRASS_DARK = rgbFromHex(0x5c7a3c);
const LOG = rgbFromHex(0x8a6a44);
const ROOF = rgbFromHex(0x6b4b34);
const ANVIL = rgbFromHex(0x3a3f45);
const STONE = rgbFromHex(0x8d8d86);

export interface YardOptions {
	/** Tiles from the centre to the rim. */
	radius?: number;
	seed?: number;
}

/**
 * Builds the scene once and returns the packed instances. The result is static,
 * so a caller uploads it to the renderer once and then only moves the camera.
 */
export function buildYard(options: YardOptions = {}): HexInstances {
	const radius = options.radius ?? 8;
	const random = makeRandom(options.seed ?? 20260902);

	const instances = new HexInstances(estimateCapacity(radius));

	buildGround(instances, radius, random);
	buildCabin(instances, -3, -4);
	buildAnvil(instances, 2, 1);

	return instances;
}

function estimateCapacity(radius: number): number {
	const tiles = 3 * radius * (radius + 1) + 1;
	return tiles + 200;
}

function buildGround(instances: HexInstances, radius: number, random: () => number): void {
	for (const cell of axialDisc(radius)) {
		const { x, z } = axialToWorld(cell.q, cell.r, TILE_RADIUS);

		// Terraces rather than a smooth surface: the height of a tile is a
		// whole number of steps, which is what lets a character stand on one.
		const distance = Math.hypot(x, z);
		const terrace = Math.max(0, Math.round(2 - distance / 4 + (random() - 0.5) * 0.9));
		const height = GROUND_Y + terrace * TERRACE_STEP;

		const base: Rgb = terrace > 1 ? GRASS_DARK : GRASS;
		instances.pushUpright(x, 0, z, TILE_RADIUS, height, jitter(base, random, 0.06));
	}
}

/** Horizontal logs stacked into four walls, with a hex-shingled roof over them. */
function buildCabin(instances: HexInstances, q: number, r: number): void {
	const { x, z } = axialToWorld(q, r, TILE_RADIUS);
	const half = 2.1;
	const logRadius = 0.16;
	const courses = 7;

	for (let course = 0; course < courses; course++) {
		const y = GROUND_Y + 0.5 + logRadius + course * logRadius * 1.7;

		// Alternating courses, so the corners interlock the way lab 01 lays
		// them up: two logs along X, then two along Z, then back.
		if (course % 2 === 0) {
			pushLog(instances, x, y, z - half, half, 0, logRadius);
			pushLog(instances, x, y, z + half, half, 0, logRadius);
		} else {
			pushLog(instances, x - half, y, z, half, Math.PI / 2, logRadius);
			pushLog(instances, x + half, y, z, half, Math.PI / 2, logRadius);
		}
	}

	const eaves = GROUND_Y + 0.5 + courses * logRadius * 1.7;
	for (let row = 0; row < 5; row++) {
		const inset = row * 0.42;
		const y = eaves + row * 0.3;
		const width = half - inset;
		if (width <= 0.2) break;
		pushLog(instances, x, y, z - width, width + 0.3, 0, 0.13, ROOF);
		pushLog(instances, x, y, z + width, width + 0.3, 0, 0.13, ROOF);
	}

	// Chimney.
	for (let i = 0; i < 9; i++) {
		instances.push(x + half * 0.6, GROUND_Y + 0.6 + i * 0.24, z + half * 0.8, 0.22, 0.24, STONE);
	}
}

/**
 * A prism lying on its side: the unit prism's axis is +Y, so a length along
 * the ground is a height scaled up and the whole thing yawed into place.
 * Rotating it flat is not something the instance format can express — it only
 * carries a yaw — so a lying log is drawn as a low, wide prism instead, which
 * at this scale reads the same.
 */
function pushLog(
	instances: HexInstances,
	x: number,
	y: number,
	z: number,
	halfLength: number,
	yaw: number,
	radius: number,
	color: Rgb = LOG,
): void {
	const steps = Math.max(2, Math.round(halfLength / radius));
	for (let i = -steps; i <= steps; i++) {
		const t = (i / steps) * halfLength;
		instances.push(x + Math.cos(yaw) * t, y, z - Math.sin(yaw) * t, radius, radius * 1.9, color);
	}
}

function buildAnvil(instances: HexInstances, q: number, r: number): void {
	const { x, z } = axialToWorld(q, r, TILE_RADIUS);
	const base = GROUND_Y + 0.5;
	instances.pushUpright(x, base, z, 0.34, 0.5, LOG);
	instances.pushUpright(x, base + 0.5, z, 0.2, 0.28, ANVIL);
	instances.pushUpright(x, base + 0.78, z, 0.42, 0.22, ANVIL);
}
