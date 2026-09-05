/*
 * A set of hexagons, drawn.
 *
 * Two things in the level panel are a set of hexagons with a value each — the
 * sample dungeon the wave function learns from, and every pattern it learned —
 * and they differ only in how many cells there are and how big to draw them. So
 * this takes a list of cells and fits them into a viewBox, and both callers are
 * one line.
 *
 * It draws in the game's own coordinates. `axialToWorld` places the centres and
 * `hexCorner` shapes them, which is what makes a pattern here the same picture
 * the viewport draws rather than a diagram of one — and, in particular, what
 * would make a rotation that turned the wrong way visible instead of merely
 * wrong. World `z` maps to screen `y` unchanged: z grows southward on the grid
 * and y grows downward on screen, so the two agree without a flip.
 */

import Box from '@mui/material/Box';
import { useMemo } from 'react';
import { hexCorner } from '@hexdelve/engine';
import { axialToWorld } from '@hexdelve/shared';

export interface HexMapCell {
	q: number;
	r: number;
	/** True for floor. Anything else is drawn as solid. */
	floor: boolean;
}

export interface HexMapProps {
	cells: readonly HexMapCell[];
	/** Width in pixels; the height follows from the cells' own proportions. */
	width: number;
	floorColor?: string;
	rockColor?: string;
	title?: string;
}

const CORNERS = Array.from({ length: 6 }, (_, k) => hexCorner(k));

/** Just inside 1, so neighbouring hexes read as separate cells rather than a wash. */
const FILL_RADIUS = 0.92;

export function HexMap({
	cells,
	width,
	floorColor = '#e6d9bb',
	rockColor = '#2b2823',
	title,
}: HexMapProps) {
	const { paths, viewBox, height } = useMemo(() => {
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;

		const placed = cells.map((cell) => {
			const { x, z } = axialToWorld(cell.q, cell.r);
			minX = Math.min(minX, x - 1);
			maxX = Math.max(maxX, x + 1);
			minY = Math.min(minY, z - 1);
			maxY = Math.max(maxY, z + 1);
			return { x, y: z, floor: cell.floor };
		});

		// One path per colour rather than one element per cell: the sample is
		// nearly nine hundred hexagons, and nine hundred <polygon> nodes in a
		// side panel is a measurable amount of DOM for a picture nobody clicks.
		const build = (floor: boolean): string =>
			placed
				.filter((cell) => cell.floor === floor)
				.map(
					(cell) =>
						'M' +
						CORNERS.map(
							(corner) =>
								`${(cell.x + corner.x * FILL_RADIUS).toFixed(3)},` +
								`${(cell.y + corner.z * FILL_RADIUS).toFixed(3)}`,
						).join('L') +
						'Z',
				)
				.join('');

		const spanX = maxX - minX || 1;
		const spanY = maxY - minY || 1;
		return {
			paths: { rock: build(false), floor: build(true) },
			viewBox: `${minX} ${minY} ${spanX} ${spanY}`,
			height: (width * spanY) / spanX,
		};
	}, [cells, width]);

	return (
		<Box
			component="svg"
			viewBox={viewBox}
			width={width}
			height={height}
			sx={{ display: 'block', flexShrink: 0 }}
			role="img"
			aria-label={title ?? 'hexagons'}
		>
			{title && <title>{title}</title>}
			<path d={paths.rock} fill={rockColor} />
			<path d={paths.floor} fill={floorColor} />
		</Box>
	);
}
