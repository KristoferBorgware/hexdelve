/*
 * The vault, drawn as hexagons and painted on.
 *
 * A vault is a grid of cells, so this is a grid of cells rather than a GPU
 * viewport — the other three benches show meshes and are 3D for that reason,
 * and a layout editor is not. What the room will LOOK like is the level bench's
 * job; what it IS gets edited here.
 *
 * It draws in the game's own coordinates: odd-r offset to axial to world, then
 * `hexCorner` for the outline. So the picture is the hexes the generator will
 * stamp, in the arrangement it will stamp them — a vault that reads as a
 * straight wall here is a straight wall in the level, staggered edges and all.
 *
 * Hit testing is the reverse of that, exactly: screen to world by the viewBox's
 * own scale, then `worldToAxial`, then back to offset. Not a nearest-centre
 * search — hexagons do not tile a square grid, and the cell whose centre is
 * closest to a point near a corner is regularly not the cell the point is in.
 */

import Box from '@mui/material/Box';
import { useCallback, useMemo, useRef } from 'react';
import { hexCorner } from '@hexdelve/engine';
import { axialToWorld, worldToAxial } from '@hexdelve/shared';
import type { VaultEntityKind, VaultTerrain } from '@hexdelve/client';

import type { VaultDraft } from '../vault/store.js';

export const TERRAIN_COLOR: Record<VaultTerrain, string> = {
	wall: '#4a4034',
	floor: '#9a8a63',
	door: '#d0a850',
	outside: '#14161a',
};

export const ENTITY_COLOR: Record<VaultEntityKind, string> = {
	monster: '#e05252',
	loot: '#f0c64a',
	trap: '#b060d0',
	light: '#fff0b0',
	marker: '#7ea6ff',
};

export const ENTITY_GLYPH: Record<VaultEntityKind, string> = {
	monster: 'M',
	loot: 'L',
	trap: 'T',
	light: '*',
	marker: 'X',
};

const CORNERS = Array.from({ length: 6 }, (_, k) => hexCorner(k));
const FILL_RADIUS = 0.94;

export interface VaultCanvasProps {
	draft: VaultDraft;
	/** Called with the cell under the pointer, on press and on drag. */
	onPaint(col: number, row: number): void;
	/** Pixels across. The height follows from the vault's proportions. */
	width?: number;
}

function offsetToAxial(col: number, row: number): { q: number; r: number } {
	return { q: col - ((row - (row & 1)) >> 1), r: row };
}

function axialToOffset(q: number, r: number): { col: number; row: number } {
	return { col: q + ((r - (r & 1)) >> 1), row: r };
}

export function VaultCanvas({ draft, onPaint, width = 620 }: VaultCanvasProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const painting = useRef(false);

	const view = useMemo(() => {
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;

		const cells: { col: number; row: number; x: number; y: number }[] = [];
		for (let row = 0; row < draft.height; row++) {
			for (let col = 0; col < draft.width; col++) {
				const { q, r } = offsetToAxial(col, row);
				const { x, z } = axialToWorld(q, r);
				minX = Math.min(minX, x - 1);
				maxX = Math.max(maxX, x + 1);
				minY = Math.min(minY, z - 1);
				maxY = Math.max(maxY, z + 1);
				cells.push({ col, row, x, y: z });
			}
		}

		const spanX = maxX - minX || 1;
		const spanY = maxY - minY || 1;
		return { cells, minX, minY, spanX, spanY, height: (width * spanY) / spanX };
	}, [draft.width, draft.height, width]);

	const entityAt = useMemo(() => {
		const map = new Map<string, VaultEntityKind>();
		for (const entity of draft.entities) map.set(`${entity.col},${entity.row}`, entity.kind);
		return map;
	}, [draft.entities]);

	/** Which cell a pointer is over, or null when it is off the vault. */
	const cellUnder = useCallback(
		(event: { clientX: number; clientY: number }): { col: number; row: number } | null => {
			const svg = svgRef.current;
			if (!svg) return null;
			const rect = svg.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return null;

			// The viewBox and the element have the same aspect by construction,
			// so this is a pure scale rather than anything preserveAspectRatio
			// might have done to it.
			const x = view.minX + ((event.clientX - rect.left) / rect.width) * view.spanX;
			const z = view.minY + ((event.clientY - rect.top) / rect.height) * view.spanY;

			const axial = worldToAxial(x, z);
			const { col, row } = axialToOffset(axial.q, axial.r);
			if (col < 0 || row < 0 || col >= draft.width || row >= draft.height) return null;
			return { col, row };
		},
		[view, draft.width, draft.height],
	);

	const paintAt = useCallback(
		(event: { clientX: number; clientY: number }): void => {
			const cell = cellUnder(event);
			if (cell) onPaint(cell.col, cell.row);
		},
		[cellUnder, onPaint],
	);

	return (
		<Box
			component="svg"
			ref={svgRef}
			viewBox={`${view.minX} ${view.minY} ${view.spanX} ${view.spanY}`}
			width={width}
			height={view.height}
			sx={{ display: 'block', touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }}
			onPointerDown={(event) => {
				// Capture, so a drag that leaves the element keeps painting
				// rather than stopping at the edge of the grid.
				(event.target as Element).setPointerCapture?.(event.pointerId);
				painting.current = true;
				paintAt(event);
			}}
			onPointerMove={(event) => {
				if (painting.current) paintAt(event);
			}}
			onPointerUp={() => {
				painting.current = false;
			}}
			onPointerCancel={() => {
				painting.current = false;
			}}
		>
			{view.cells.map((cell) => {
				const terrain = draft.terrain[cell.col + cell.row * draft.width]!;
				const entity = entityAt.get(`${cell.col},${cell.row}`);
				const points = CORNERS.map(
					(corner) =>
						`${(cell.x + corner.x * FILL_RADIUS).toFixed(3)},` +
						`${(cell.y + corner.z * FILL_RADIUS).toFixed(3)}`,
				).join(' ');

				return (
					<g key={`${cell.col},${cell.row}`}>
						<polygon
							points={points}
							fill={TERRAIN_COLOR[terrain]}
							stroke="#0b0d10"
							strokeWidth={0.06}
						/>
						{entity && (
							<text
								x={cell.x}
								y={cell.y}
								fill={ENTITY_COLOR[entity]}
								fontSize={1.1}
								fontWeight={700}
								textAnchor="middle"
								dominantBaseline="central"
								style={{ pointerEvents: 'none' }}
							>
								{ENTITY_GLYPH[entity]}
							</text>
						)}
					</g>
				);
			})}
		</Box>
	);
}
