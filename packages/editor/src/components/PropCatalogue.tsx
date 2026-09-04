/*
 * The prop bench's left-hand panel: the catalogue, and what a prop is made of.
 *
 * The catalogue is the whole point of the view — every prop in the game, in
 * one list, grouped by the family whose numbers it will want. It is generated
 * from `BENCH_PROPS`, so a fourth prop appears here, in the viewport and in the
 * inspector the moment it is added to the client, with no new code anywhere.
 *
 * Under it are the parts, which stand in the same relation to a prop as bones
 * do to a rig: the thing it is actually built out of. A part has no name — it
 * is a prism, a colour and a size — so the list names it by its shade, which
 * the client's palettes do have names for. Picking one marks it in the
 * viewport, which is how you find out which of five `steel` pieces is the nose
 * guard.
 */

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import { partRows, type BenchProp, type PropKind } from '../bench/props.js';

export interface PropCatalogueProps {
	/** Every prop on the manifest, in its order. */
	props: readonly BenchProp[];
	prop: BenchProp;
	onPropChange(prop: BenchProp): void;
	selectedPart: number | null;
	onSelectPart(index: number | null): void;
}

const KIND_LABELS: Record<PropKind, string> = {
	weapon: 'Weapons',
	armour: 'Armour',
	shield: 'Shields',
	gear: 'Gear',
};

/** The catalogue, grouped — in the order the kinds first appear in it. */
function groupsOf(props: readonly BenchProp[]): { kind: PropKind; props: BenchProp[] }[] {
	const out: { kind: PropKind; props: BenchProp[] }[] = [];
	for (const entry of props) {
		const group = out.find((candidate) => candidate.kind === entry.kind);
		if (group) group.props.push(entry);
		else out.push({ kind: entry.kind, props: [entry] });
	}
	return out;
}

export function PropCatalogue({
	props,
	prop,
	onPropChange,
	selectedPart,
	onSelectPart,
}: PropCatalogueProps) {
	const parts = useMemo(() => partRows(prop), [prop]);
	const groups = useMemo(() => groupsOf(props), [props]);

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
				Catalogue · {props.length}
			</Typography>

			<List dense sx={{ mt: 0.5 }}>
				{groups.map((group) => (
					<Box key={group.kind} component="li" sx={{ listStyle: 'none' }}>
						{/*
						 * `component="div"` because this is already inside a list
						 * item. MUI renders a ListSubheader as an <li> by default,
						 * and an <li> inside an <li> is invalid HTML — React says
						 * so once per group, every time the bench is opened, in
						 * the one console anybody watches while working here.
						 */}
						<ListSubheader
							component="div"
							disableSticky
							sx={{ bgcolor: 'transparent', lineHeight: 2, fontSize: 11, letterSpacing: '0.06em' }}
						>
							{KIND_LABELS[group.kind]}
						</ListSubheader>
						<List dense disablePadding>
							{group.props.map((candidate) => (
								<ListItemButton
									key={candidate.id}
									selected={candidate.id === prop.id}
									onClick={() => onPropChange(candidate)}
									sx={{ py: 0.3 }}
								>
									<ListItemText
										primary={candidate.label}
										secondary={candidate.blurb}
										slotProps={{
											primary: { variant: 'body2' },
											secondary: { variant: 'caption' },
										}}
									/>
								</ListItemButton>
							))}
						</List>
					</Box>
				))}
			</List>

			<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2, mt: 2 }}>
				Parts · {parts.length}
			</Typography>

			<List dense sx={{ mt: 0.5 }}>
				{parts.map((part) => (
					<ListItemButton
						key={part.index}
						selected={selectedPart === part.index}
						// Clicking the selected part again clears it, so the
						// marker can be put away without hunting for an empty
						// row to click.
						onClick={() => onSelectPart(selectedPart === part.index ? null : part.index)}
						sx={{ py: 0.1, gap: 1 }}
					>
						<Box
							sx={{
								width: 10,
								height: 10,
								borderRadius: '2px',
								flexShrink: 0,
								bgcolor: part.swatch,
								outline: '1px solid rgba(0, 0, 0, 0.35)',
							}}
						/>
						<ListItemText
							primary={part.label}
							secondary={part.size}
							slotProps={{
								primary: { variant: 'body2' },
								secondary: { variant: 'caption', sx: { fontVariantNumeric: 'tabular-nums' } },
							}}
						/>
					</ListItemButton>
				))}
			</List>
		</Box>
	);
}
