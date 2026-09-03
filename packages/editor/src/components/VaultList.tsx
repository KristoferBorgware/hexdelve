/*
 * The vault bench's left-hand panel: which room, and where it belongs.
 *
 * Sorted by the depth a vault first becomes available at, because that is the
 * axis a dungeon is organised along and the question being asked of this list
 * is almost always "what can appear down there".
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';

import type { VaultDraft } from '../vault/store.js';

export interface VaultListProps {
	drafts: readonly VaultDraft[];
	selected: number;
	onSelect(index: number): void;
	onAdd(): void;
	onDuplicate(): void;
	onRemove(): void;
}

export function VaultList({
	drafts,
	selected,
	onSelect,
	onAdd,
	onDuplicate,
	onRemove,
}: VaultListProps) {
	const order = drafts
		.map((draft, index) => ({ draft, index }))
		.sort((a, b) => a.draft.minDepth - b.draft.minDepth || a.draft.name.localeCompare(b.draft.name));

	return (
		<Box
			component="nav"
			sx={{
				width: 252,
				flexShrink: 0,
				borderRight: 1,
				borderColor: 'divider',
				bgcolor: 'background.paper',
				overflowY: 'auto',
				py: 2,
			}}
		>
			<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }}>
				Vaults
			</Typography>
			<Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block' }}>
				Rooms drawn by hand, stamped into a level before anything carves it.
			</Typography>

			<List dense disablePadding sx={{ mt: 1 }}>
				{order.map(({ draft, index }) => (
					<ListItemButton
						key={draft.id}
						selected={index === selected}
						onClick={() => onSelect(index)}
						sx={{ alignItems: 'flex-start', py: 0.75 }}
					>
						<ListItemText
							primary={
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
									<Typography variant="body2" sx={{ flexGrow: 1 }}>
										{draft.name}
									</Typography>
									{draft.local && (
										<Tooltip title="Edited here, and not yet in the repository">
											<Chip
												size="small"
												label="local"
												sx={{ height: 16, '& .MuiChip-label': { px: 0.6, fontSize: 10 } }}
											/>
										</Tooltip>
									)}
								</Box>
							}
							secondary={`${draft.width}×${draft.height} · depth ${draft.minDepth}–${draft.maxDepth} · rating ${draft.rating}`}
							slotProps={{ secondary: { variant: 'caption' } }}
						/>
					</ListItemButton>
				))}
			</List>

			<Divider sx={{ my: 1.5 }} />

			<Stack direction="row" spacing={1} sx={{ px: 2 }}>
				<Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={onAdd}>
					New
				</Button>
				<Tooltip title="Copy this vault as a starting point">
					<span>
						<Button size="small" variant="outlined" onClick={onDuplicate}>
							<ContentCopyIcon fontSize="small" />
						</Button>
					</span>
				</Tooltip>
				<Tooltip title="Remove it from this browser">
					<span>
						<Button size="small" variant="outlined" color="error" onClick={onRemove}>
							<DeleteIcon fontSize="small" />
						</Button>
					</span>
				</Tooltip>
			</Stack>
		</Box>
	);
}
