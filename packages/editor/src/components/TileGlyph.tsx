/*
 * One tile of the dungeon tileset, drawn.
 *
 * The panel used to list a tile as six coloured dots in a row, which states the
 * sockets without showing them: nothing in a row of dots says that `hall` opens
 * east and west, or that `bend-tight` turns through sixty degrees rather than a
 * hundred and twenty. A hexagon with its sockets ON THE EDGES THEY BELONG TO
 * says both at a glance, and it is the same picture the viewport draws — which
 * is the point, because the thing being checked is whether the tile in the
 * tileset is the tile that came out.
 *
 * The geometry is the game's, not a diagram's. Corner `k` sits at angle
 * `60k` from +Z, exactly as `hexCorner` places it in the engine, and world
 * (x, z) maps to screen (x, y) unchanged — z grows southward on the grid and y
 * grows downward on screen, so the two agree without a flip.
 *
 * The one line worth checking is which edge is which. Direction `d` faces
 * `90 + 60d` degrees, side `k` faces `60k + 30`, so **edge `d` is the side
 * between corners `d + 1` and `d + 2`**. Get that wrong and every glyph is
 * still a plausible hexagon with the right number of walls, rotated one step —
 * a mistake that looks like nothing at all. `hall` is the check: it must open
 * left and right, flat against the vertical edges.
 */

import Box from '@mui/material/Box';

/**
 * Wall, corridor, room, in the order the socket characters read.
 *
 * The wall is a mid grey rather than the near-black the viewport draws, and
 * that is the one place this glyph deliberately disagrees with the picture it
 * illustrates. `rock` is six wall edges on a dark body on a dark panel: at the
 * scene's own colours it is a smudge, and the tile that fills two-thirds of
 * every level would be the one tile nobody could see.
 */
export const SOCKET_COLOR: Record<string, string> = {
	'.': '#4f4738',
	c: '#d9a441',
	r: '#efe2c2',
};

export const SOCKET_LABEL: Record<string, string> = {
	'.': 'wall',
	c: 'corridor',
	r: 'room',
};

/** How the body reads: solid rock, or floor you can stand on. */
const KIND_FILL: Record<string, string> = {
	rock: '#22201b',
	floor: '#5d5547aa',
};

export interface TileGlyphProps {
	/** Six socket characters, edge 0 first, then anticlockwise. */
	sockets: string;
	kind: 'rock' | 'floor';
	size?: number;
	title?: string;
}

/** Corner `k` of a unit hex, in the same convention as the engine's geometry. */
function corner(k: number, radius: number): [number, number] {
	const angle = (Math.PI / 3) * k;
	return [radius * Math.sin(angle), radius * Math.cos(angle)];
}

export function TileGlyph({ sockets, kind, size = 30, title }: TileGlyphProps) {
	// A whisker of headroom, so a stroked edge is not clipped by the viewBox.
	const radius = 1;
	const extent = 1.18;
	const corners = Array.from({ length: 6 }, (_, k) => corner(k, radius));
	const body = corners.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ');

	return (
		<Box
			component="svg"
			viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
			width={size}
			height={size}
			sx={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
			role="img"
			aria-label={title ?? sockets}
		>
			{title && <title>{title}</title>}

			<polygon points={body} fill={KIND_FILL[kind]} />

			{[...sockets].map((socket, d) => {
				const [ax, ay] = corners[(d + 1) % 6]!;
				const [bx, by] = corners[(d + 2) % 6]!;
				return (
					<line
						key={d}
						x1={ax}
						y1={ay}
						x2={bx}
						y2={by}
						stroke={SOCKET_COLOR[socket]}
						// A wall is drawn heavier than an opening, so the shape of
						// the tile survives being three millimetres across on a
						// panel — colour alone does not, and it is the only cue
						// anyone reading this in a screenshot has.
						strokeWidth={socket === '.' ? 0.42 : 0.3}
						strokeLinecap="round"
					/>
				);
			})}
		</Box>
	);
}
