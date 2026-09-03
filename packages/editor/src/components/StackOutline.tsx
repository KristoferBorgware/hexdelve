/*
 * The level bench's left-hand panel: which algorithm, and what it does.
 *
 * The bone outline next door lists a rig because a rig is data. This lists a
 * PIPELINE for the same reason: `LevelStack.steps` is the algorithm written out
 * in order, and putting it on screen beside the picture is what turns "the WFC
 * one looks better" into "the WFC one looks better and here is the step the
 * other one has no equivalent of". A stack that grows a step grows a line here
 * and nothing is touched.
 *
 * Under it, for a tiled stack, the tileset itself — every spec drawn as the
 * hexagon it is, with its sockets on the edges they belong to, once per
 * distinct rotation. Tuning a tileset is tuning those weights and those six
 * characters, and reading them off a source file while looking at a level in
 * another window is exactly the loop a bench exists to close.
 *
 * The rotations are expanded by the same `expandTiles` the solver runs on, not
 * redrawn from the spec here. That is the whole value of showing them: `hall`
 * appearing three times and `chamber` once is not a claim this panel is making,
 * it is what the solver is about to place. A sign error in the rotation would
 * show up here as six halls instead of three, which is the only cheap way to
 * catch it — the levels a wrong rotation produces look perfectly reasonable.
 */

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { DUNGEON_TILES, expandTiles, LEVEL_STACKS, type LevelStack } from '@hexdelve/client';

import { SOCKET_COLOR, SOCKET_LABEL, TileGlyph } from './TileGlyph.js';

export interface StackOutlineProps {
	stack: LevelStack;
	onStackChange(stack: LevelStack): void;
}

/** Back from the solver's socket numbers to the characters the spec was written in. */
const SOCKET_CHARACTER = ['.', 'c', 'r'];

export function StackOutline({ stack, onStackChange }: StackOutlineProps) {
	/*
	 * Grouped by spec, in the solver's own order. Cheap — sixty-one tiles — and
	 * memoised anyway, because this runs on every re-render of a panel that
	 * re-renders whenever a slider moves.
	 */
	const rotations = useMemo(() => {
		const tiles = expandTiles();
		const bySpec = new Map<string, string[]>();
		for (const tile of tiles) {
			const sockets = tile.sockets.map((socket) => SOCKET_CHARACTER[socket] ?? '.').join('');
			const held = bySpec.get(tile.spec.name);
			if (held) held.push(sockets);
			else bySpec.set(tile.spec.name, [sockets]);
		}
		return { bySpec, total: tiles.length };
	}, []);

	return (
		<Box
			component="nav"
			sx={{
				width: 268,
				flexShrink: 0,
				borderRight: 1,
				borderColor: 'divider',
				bgcolor: 'background.paper',
				overflowY: 'auto',
				py: 2,
			}}
		>
			<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }}>
				Stack
			</Typography>

			<List dense disablePadding sx={{ mt: 0.5 }}>
				{LEVEL_STACKS.map((candidate) => (
					<ListItemButton
						key={candidate.id}
						selected={candidate.id === stack.id}
						onClick={() => onStackChange(candidate)}
						sx={{ alignItems: 'flex-start', py: 1 }}
					>
						<ListItemText
							primary={candidate.label}
							secondary={candidate.source}
							slotProps={{
								primary: { variant: 'body2' },
								secondary: { variant: 'caption', sx: { wordBreak: 'break-word' } },
							}}
						/>
					</ListItemButton>
				))}
			</List>

			<Box sx={{ px: 2, mt: 1.5 }}>
				<Typography variant="caption" color="text.secondary">
					{stack.blurb}
				</Typography>
			</Box>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }} gutterBottom>
				Pipeline
			</Typography>

			<Box component="ol" sx={{ pl: 4, pr: 2, m: 0 }}>
				{stack.steps.map((step) => (
					<Typography key={step} component="li" variant="caption" sx={{ mb: 0.4 }}>
						{step}
					</Typography>
				))}
			</Box>

			{stack.id === 'wfc-hex' && (
				<>
					<Divider sx={{ my: 1.5 }} />

					<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }}>
						Tileset
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block' }}>
						Thirteen specs, drawn once per distinct rotation — {rotations.total} tiles in all.
						Heavy edges are wall; the solver may put two tiles side by side only where the
						edges they show each other agree.
					</Typography>

					<Stack direction="row" spacing={1.5} sx={{ px: 2, mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
						{Object.entries(SOCKET_LABEL).map(([socket, label]) => (
							<Box key={socket} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
								<Box
									sx={{
										width: 14,
										height: socket === '.' ? 4 : 3,
										borderRadius: '2px',
										bgcolor: SOCKET_COLOR[socket],
										outline: socket === '.' ? '1px solid #4a453d' : 'none',
									}}
								/>
								<Typography variant="caption" color="text.secondary">
									{label}
								</Typography>
							</Box>
						))}
					</Stack>

					<Box sx={{ px: 2, mt: 1.5 }}>
						{DUNGEON_TILES.map((spec) => {
							const turns = rotations.bySpec.get(spec.name) ?? [];
							return (
								<Box key={spec.name} sx={{ mb: 1.5 }}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										<Typography variant="caption" sx={{ flexGrow: 1 }}>
											{spec.name}
											<Typography component="span" variant="caption" color="text.secondary">
												{' '}
												&times;{turns.length}
											</Typography>
										</Typography>
										<Tooltip title="Relative frequency, per rotation">
											<Chip
												size="small"
												variant="outlined"
												label={spec.weight}
												sx={{ height: 18, '& .MuiChip-label': { px: 0.7, fontSize: 11 } }}
											/>
										</Tooltip>
									</Box>
									<Stack direction="row" sx={{ mt: 0.4, flexWrap: 'wrap', gap: 0.6 }}>
										{turns.map((sockets, index) => (
											<TileGlyph
												key={index}
												sockets={sockets}
												kind={spec.kind}
												size={30}
												title={`${spec.name} ${index} — ${[...sockets]
													.map((socket, d) => `${d}:${SOCKET_LABEL[socket]}`)
													.join(', ')}`}
											/>
										))}
									</Stack>
								</Box>
							);
						})}
					</Box>
				</>
			)}
		</Box>
	);
}
