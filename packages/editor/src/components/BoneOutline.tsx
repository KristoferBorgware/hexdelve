/*
 * The bench's left-hand panel: which creature, and what it is made of.
 *
 * Unlike the scene outline next door, this list is not hand-written — it is
 * the skeleton, indented by how deep each bone sits. That is the same bargain
 * `buildSkeletonView` makes in the engine: the rig is plain data, so add a bone
 * to the array and it appears here, in the viewport, and in the readout, with
 * no new code anywhere. Which is the property that has to hold before the bench
 * can be somewhere bones are authored rather than only inspected.
 */

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import type { BenchRig } from '../bench/rigs.js';

export interface BoneOutlineProps {
	/** Everything on the manifest that has bones, for the subject picker. */
	rigs: readonly BenchRig[];
	rig: BenchRig;
	onRigChange(rig: BenchRig): void;
	selected: string | null;
	onSelect(bone: string | null): void;
}

interface Row {
	name: string;
	depth: number;
	parent: string | null;
}

export function BoneOutline({ rigs, rig, onRigChange, selected, onSelect }: BoneOutlineProps) {
	const rows = useMemo<Row[]>(() => {
		const depths = new Map<string, number>();
		return rig.skeleton.map((bone) => {
			const depth = bone.parent === null ? 0 : (depths.get(bone.parent) ?? 0) + 1;
			depths.set(bone.name, depth);
			return { name: bone.name, depth, parent: bone.parent };
		});
	}, [rig]);

	return (
		<Box
			component="nav"
			sx={{
				width: 236,
				flexShrink: 0,
				borderRight: 1,
				borderColor: 'divider',
				bgcolor: 'background.paper',
				overflowY: 'auto',
				py: 2,
			}}
		>
			<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }}>
				Subject
			</Typography>

			<Box sx={{ px: 2, mt: 1 }}>
				<TextField
					select
					fullWidth
					size="small"
					value={rig.id}
					onChange={(event) => {
						const next = rigs.find((candidate) => candidate.id === event.target.value);
						if (next) onRigChange(next);
					}}
				>
					{rigs.map((candidate) => (
						<MenuItem key={candidate.id} value={candidate.id}>
							{candidate.label}
						</MenuItem>
					))}
				</TextField>
			</Box>

			<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2, mt: 2.5 }}>
				Bones · {rows.length}
			</Typography>

			<List dense sx={{ mt: 0.5 }}>
				{rows.map((row) => (
					<ListItemButton
						key={row.name}
						selected={selected === row.name}
						// Clicking the selected bone again clears it, so the
						// marker in the viewport can be put away without
						// hunting for an empty row to click.
						onClick={() => onSelect(selected === row.name ? null : row.name)}
						sx={{ pl: 2 + row.depth * 1.25, py: 0.15 }}
					>
						<ListItemText
							primary={row.name}
							slotProps={{ primary: { variant: 'body2' } }}
						/>
					</ListItemButton>
				))}
			</List>
		</Box>
	);
}
