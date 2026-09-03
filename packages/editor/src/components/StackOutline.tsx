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
 * Under it, whatever the stack itself wants to show. Nothing does at the
 * moment: a wave function used to put its sample and its learned patterns here,
 * and went with the stack. The hook is worth keeping — a stack that grows a
 * thing worth looking at grows a section here and nothing else changes.
 */

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { LEVEL_STACKS, type LevelStack } from '@hexdelve/client';

export interface StackOutlineProps {
	stack: LevelStack;
	onStackChange(stack: LevelStack): void;
}


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

		</Box>
	);
}
