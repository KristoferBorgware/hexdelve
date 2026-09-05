/*
 * The ground: a field of hexagons worked out from four numbers.
 *
 * Nothing about the shape of it is authored. A radius says how far it goes, a
 * base and a step say how high a terrace stands, and a seed decides the grass.
 * Move any of them and the prisms are built again — which is the whole reason
 * this is a script with parameters rather than a mesh file: how big the world
 * is is a thing somebody drags in an editor, and no file can hold the answer.
 *
 * ## The shape
 *
 * A cone you can walk up, because neighbouring tiles never differ by more than
 * one terrace, and a mesa with sheer sides, because they differ by three — so
 * one is a hill and the other is a wall, and the same climb rule decides both
 * without either being special-cased anywhere.
 *
 * ## What it answers
 *
 * Everything that moves asks it something: a route is laid across `passable`, a
 * foot is planted on `groundAt`, a step is refused by a terrace it cannot
 * climb. How big a climb counts comes in with the question rather than being
 * known here, because a man walks up one and a bat clears two.
 *
 * ## What stands on it
 *
 * Buildings block the tiles under them, and they say so themselves through
 * `block` — a terrain carrying a list of what is on it would be a second place
 * for those to be written down. Blocking is kept apart from the tiles so that
 * rebuilding the ground does not forget what is standing on it.
 */

import { Model, MeshRenderer, param, Script } from '@hexdelve/engine';
import {
	axialToWorld,
	jitter,
	makeRandom,
	rgbFromHex,
	SQRT3,
	worldToAxial,
	type Axial,
	type Random,
	type Rgb,
} from '@hexdelve/shared';
import { tileKey, type Footprint, type Tile } from '@hexdelve/client';

/** The four shades a terrace can be, lowest first. */
const SHADES = [0x79a256, 0x84ab61, 0x90b46f, 0x9dbd7e];

export class Terrain extends Script {
	/** How many rings of hexagons the ground reaches. */
	radius = param(8, { min: 1, max: 24, step: 1, label: 'Radius', hint: 'Rings of hexagons' });

	/** World Y of a tile at level zero. */
	baseY = param(0.16, { min: 0, max: 2, step: 0.01, label: 'Base' });

	/** How much one terrace lifts a tile. */
	stepH = param(0.19, { min: 0.01, max: 1, step: 0.01, label: 'Terrace' });

	/** Decides the grass tufts and the shade of every tile. */
	seed = param(37, { min: 0, max: 9999, step: 1, label: 'Seed' });

	readonly tiles = new Map<string, Tile>();

	/** Tiles something is standing on. Kept apart, so a rebuild does not lose them. */
	private readonly blocked = new Set<string>();

	/** What the parameters were when the ground was last built. */
	private built = '';

	override onLoad(): void {
		this.rebuild();
	}

	/**
	 * Build again if anything was moved.
	 *
	 * Checked once a frame rather than on a setter, because a parameter is a
	 * plain field somebody assigns — an editor writes it, a reload re-applies
	 * it — and there is no write to hook. Comparing four numbers is cheaper
	 * than the machinery that would notice them changing.
	 */
	override tick(): void {
		if (this.signature() !== this.built) this.rebuild();
	}

	private signature(): string {
		return `${this.radius}|${this.baseY}|${this.stepH}|${this.seed}`;
	}

	/* --------------------------------------------------------------- asking -- */

	tileAt(q: number, r: number): Tile | null {
		return this.tiles.get(tileKey(q, r)) ?? null;
	}

	groundAt(x: number, z: number): number {
		const cell = worldToAxial(x, z);
		return this.tileAt(cell.q, cell.r)?.top ?? this.baseY;
	}

	passable(cell: Axial, from: Axial | null, maxClimb = 1): boolean {
		const tile = this.tileAt(cell.q, cell.r);
		if (!tile) return false;
		if (this.blocked.has(tileKey(cell.q, cell.r))) return false;
		if (!from) return true;
		const previous = this.tileAt(from.q, from.r);
		return !previous || Math.abs(tile.level - previous.level) <= maxClimb;
	}

	block(footprint: Footprint): void {
		const sin = Math.sin(footprint.yaw);
		const cos = Math.cos(footprint.yaw);
		for (const tile of this.tiles.values()) {
			const dx = tile.x - footprint.x;
			const dz = tile.z - footprint.z;
			const lx = dx * cos - dz * sin;
			const lz = dx * sin + dz * cos;
			if (
				Math.abs(lx) < footprint.halfX + footprint.margin &&
				Math.abs(lz) < footprint.halfZ + footprint.margin
			) {
				this.blocked.add(tileKey(tile.q, tile.r));
			}
		}
	}

	blockCell(q: number, r: number): void {
		this.blocked.add(tileKey(q, r));
	}

	/* -------------------------------------------------------------- building -- */

	/**
	 * How high the ground stands at a point, before it is cut into terraces.
	 *
	 * The flat working area, the cone and the mesa, in that order — so the
	 * mesa wins where they overlap and the yard has one sheer side.
	 */
	private levelAt(x: number, z: number): number {
		if (Math.hypot(x, z) < 2.4) return 1;
		const cone = Math.hypot(x - 7.5, z + 5.0);
		let level = Math.max(0, Math.min(3, Math.round((7.0 - cone) / 1.75)));
		if (Math.hypot(x + 6.5, z - 4.5) < 3.2) level = Math.max(level, 3);
		return level;
	}

	private rebuild(): void {
		const random: Random = makeRandom(this.seed);
		const shade = (color: number, spread = 0.05): Rgb =>
			jitter(rgbFromHex(color), random, spread);

		this.tiles.clear();
		const model = new Model();

		/*
		 * The plinth the whole yard stands on, so the world has an edge rather
		 * than floating tiles. Its bone is `root` like every other part: a mesh
		 * with no rig is drawn in its own space and the name goes unread.
		 */
		model.add('root', [0, -1.4 + 0.7, 0], [SQRT3 * this.radius + 1.6, 1.4, SQRT3 * this.radius + 1.6], rgbFromHex(0x4a3b2c), {
			euler: [0, (90 * Math.PI) / 180, 0],
		});

		for (let q = -this.radius; q <= this.radius; q++) {
			for (let r = -this.radius; r <= this.radius; r++) {
				if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 > this.radius) continue;
				const { x, z } = axialToWorld(q, r);
				const level = this.levelAt(x, z);
				const top = this.baseY + level * this.stepH;
				this.tiles.set(tileKey(q, r), { q, r, level, top, x, z });

				model.add('root', [x, top / 2, z], [0.985, top, 0.985], shade(SHADES[level]!, 0.05));
				if (random() < 0.06) {
					const tuftY = top + 0.1;
					model.add(
						'root',
						[x + (random() - 0.5) * 0.8, tuftY, z + (random() - 0.5) * 0.8],
						[0.085, 0.2, 0.085],
						shade(0x5c8040, 0.06),
						{ euler: [0, random() * 60 * (Math.PI / 180), 0] },
					);
				}
			}
		}

		const renderer = this.object.getComponent(MeshRenderer);
		if (renderer) renderer.model = model;
		this.built = this.signature();
	}
}
