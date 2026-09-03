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
 * Under it, for a tiled stack, the tileset itself — every spec, its six sockets
 * and its weight. Tuning a tileset is tuning those numbers, and reading them
 * off a source file while looking at a level in another window is exactly the
 * loop a bench exists to close.
 */

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DUNGEON_TILES, LEVEL_STACKS, type LevelStack } from '@hexdelve/client';

export interface StackOutlineProps {
	stack: LevelStack;
	onStackChange(stack: LevelStack): void;
}

const SOCKET_LABEL: Record<string, string> = {
	'.': 'wall',
	c: 'corridor',
	r: 'room',
};

const SOCKET_COLOR: Record<string, string> = {
	'.': '#4a453d',
	c: '#8a7f5e',
	r: '#b39a6a',
};

export function StackOutline({ stack, onStackChange }: StackOutlineProps) {
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
						Six sockets per tile, east first then anticlockwise. Rotations are expanded
						by the solver, so a straight hall is three tiles and a chamber is one.
					</Typography>

					<Box sx={{ px: 2, mt: 1 }}>
						{DUNGEON_TILES.map((spec) => (
							<Box
								key={spec.name}
								sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.35 }}
							>
								<Box sx={{ display: 'flex', gap: 0.3 }}>
									{[...spec.edges].map((socket, index) => (
										<Tooltip key={index} title={`edge ${index}: ${SOCKET_LABEL[socket]}`}>
											<Box
												sx={{
													width: 8,
													height: 8,
													borderRadius: '2px',
													bgcolor: SOCKET_COLOR[socket],
												}}
											/>
										</Tooltip>
									))}
								</Box>
								<Typography variant="caption" sx={{ flexGrow: 1 }}>
									{spec.name}
								</Typography>
								<Chip
									size="small"
									variant="outlined"
									label={spec.weight}
									sx={{ height: 18, '& .MuiChip-label': { px: 0.7, fontSize: 11 } }}
								/>
							</Box>
						))}
					</Box>
				</>
			)}
		</Box>
	);
}
