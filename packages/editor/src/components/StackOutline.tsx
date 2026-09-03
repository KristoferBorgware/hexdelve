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
 * Under it, for the wave function, the thing it learned from and some of what
 * it learned. That used to be a tileset — thirteen specs with sockets on their
 * edges — and the sockets were the mistake: a hexagon is the atom of this game,
 * so a wall cannot live on an edge. The overlapping model has no tileset at
 * all. It has A PICTURE OF A DUNGEON, and every pattern it works from is a
 * window of that picture.
 *
 * So the panel shows the picture, and then the windows, heaviest first, drawn
 * by the same `learn` the solver runs on rather than redrawn from the sample
 * here. That is the whole value of showing them: what is on screen is what the
 * solver is about to place, and a sample edited into something the model cannot
 * work with says so here before it says so in the level.
 */

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import {
	LEVEL_STACKS,
	patternShape,
	readSample,
	sampleToAxial,
	wfcPatterns,
	type LevelStack,
} from '@hexdelve/client';

import { HexMap, type HexMapCell } from './HexMap.js';

export interface StackOutlineProps {
	stack: LevelStack;
	onStackChange(stack: LevelStack): void;
}

/** How many of the learned patterns to draw. The tail is a long one. */
const PATTERNS_SHOWN = 24;

export function StackOutline({ stack, onStackChange }: StackOutlineProps) {
	/*
	 * The sample and the pattern set, memoised. Learning is a scan of the
	 * sample and an O(T^2) propagator — nothing, once, and not something to
	 * repeat on every re-render of a panel that re-renders whenever a slider
	 * moves.
	 */
	const learned = useMemo(() => {
		const sample = readSample();
		const cells: HexMapCell[] = [];
		for (let row = 0; row < sample.height; row++) {
			for (let col = 0; col < sample.width; col++) {
				const { q, r } = sampleToAxial(col, row);
				cells.push({ q, r, floor: sample.floor[col + row * sample.width] === 1 });
			}
		}

		const set = wfcPatterns(1, 'rotations');
		const shape = patternShape(1);
		const total = set.weights.reduce((sum, weight) => sum + weight, 0);
		const order = set.weights
			.map((weight, index) => ({ weight, index }))
			.sort((a, b) => b.weight - a.weight)
			.slice(0, PATTERNS_SHOWN);

		const patterns = order.map(({ weight, index }) => ({
			index,
			share: weight / total,
			cells: shape.map((offset, i) => ({
				q: offset.q,
				r: offset.r,
				floor: set.patterns[index]!.cells[i] === 1,
			})),
		}));

		return { sample: cells, patterns, count: set.patterns.length, total };
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
						Sample
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block' }}>
						The whole tileset. Everything the solver knows is read out of this drawing —
						there are no tiles, no sockets and no adjacency table written down anywhere.
					</Typography>

					<Box sx={{ px: 2, mt: 1 }}>
						<HexMap cells={learned.sample} width={232} title="the sample dungeon" />
					</Box>

					<Divider sx={{ my: 1.5 }} />

					<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }}>
						Patterns
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block' }}>
						{learned.count} of them, at reach 1 with rotations — a cell and its six
						neighbours, counted wherever the sample had one. The {PATTERNS_SHOWN} heaviest
						are below; a cell takes the value at the centre of whichever it settles on.
					</Typography>

					<Box
						sx={{
							px: 2,
							mt: 1,
							display: 'grid',
							gridTemplateColumns: 'repeat(4, 1fr)',
							gap: 1,
						}}
					>
						{learned.patterns.map((pattern) => (
							<Stack key={pattern.index} sx={{ alignItems: 'center' }}>
								<HexMap
									cells={pattern.cells}
									width={44}
									title={`pattern ${pattern.index}`}
								/>
								<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
									{(pattern.share * 100).toFixed(1)}%
								</Typography>
							</Stack>
						))}
					</Box>
				</>
			)}
		</Box>
	);
}
