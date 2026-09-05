/*
 * The object tree of a prefab, and the buttons that change its shape.
 *
 * One row an object, indented by depth. What it shows beside the name is the
 * component count, because an object with nothing on it is the thing most
 * likely to be a mistake — an empty named `grip` is deliberate, an empty named
 * `wanderer` is a prefab somebody has not finished.
 *
 * ## Why reparenting is buttons rather than dragging
 *
 * Indent makes an object a child of the sibling above it; outdent makes it a
 * sibling of its parent. Those two reach every arrangement a drag would, in a
 * pane this narrow, and they say what they did — a drop between two rows at a
 * particular indent is a guess about intent that the pointer has to make and
 * frequently gets wrong.
 */

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import FormatIndentDecreaseIcon from '@mui/icons-material/FormatIndentDecrease';
import FormatIndentIncreaseIcon from '@mui/icons-material/FormatIndentIncrease';

import {
	parentOf,
	type DraftNode,
} from './entitydraft.js';
import type { PlacedNode } from './gizmos.js';

export interface EntityTreeProps {
	root: DraftNode;
	placed: readonly PlacedNode[];
	selectedId: string | null;
	onSelect(id: string): void;
	onAdd(parentId: string): void;
	onRemove(id: string): void;
	onReorder(id: string, by: -1 | 1): void;
	onIndent(id: string): void;
	onOutdent(id: string): void;
}

export function EntityTree({
	root,
	placed,
	selectedId,
	onSelect,
	onAdd,
	onRemove,
	onReorder,
	onIndent,
	onOutdent,
}: EntityTreeProps) {
	const counts = new Map<string, number>();
	const walk = (node: DraftNode) => {
		counts.set(node.id, node.components.length);
		node.children.forEach(walk);
	};
	walk(root);

	const selected = selectedId;
	const parent = selected ? parentOf(root, selected) : null;
	const siblings = parent?.children ?? [];
	const at = siblings.findIndex((one) => one.id === selected);
	const isRoot = selected === root.id;

	return (
		<Box
			sx={{
				width: 260,
				borderRight: 1,
				borderColor: 'divider',
				display: 'flex',
				flexDirection: 'column',
				minHeight: 0,
			}}
		>
			<Box sx={{ px: 1.5, py: 1 }}>
				<Typography variant="overline" color="text.secondary">
					Hierarchy
				</Typography>
			</Box>
			<Divider />

			<Box sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
				{placed.map((node) => (
					<Box
						key={node.id}
						onClick={() => onSelect(node.id)}
						sx={{
							display: 'flex',
							alignItems: 'center',
							gap: 1,
							cursor: 'pointer',
							px: 1,
							py: 0.4,
							pl: 1 + node.depth * 1.6,
							bgcolor: node.id === selectedId ? 'action.selected' : 'transparent',
							'&:hover': { bgcolor: node.id === selectedId ? 'action.selected' : 'action.hover' },
						}}
					>
						<Typography variant="body2" noWrap sx={{ flex: 1 }}>
							{node.name}
						</Typography>
						{(counts.get(node.id) ?? 0) > 0 && (
							<Typography variant="caption" color="text.secondary">
								{counts.get(node.id)}
							</Typography>
						)}
					</Box>
				))}
			</Box>

			<Divider />
			<Stack direction="row" spacing={0.5} sx={{ p: 0.5 }}>
				<Tooltip title="Add a child object">
					<span>
						<IconButton size="small" disabled={!selected} onClick={() => selected && onAdd(selected)}>
							<AddIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Tooltip title={isRoot ? 'A prefab is one object; the root cannot go' : 'Remove'}>
					<span>
						<IconButton
							size="small"
							disabled={!selected || isRoot}
							onClick={() => selected && onRemove(selected)}
						>
							<DeleteIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Box sx={{ flex: 1 }} />
				<Tooltip title="Move up among its siblings">
					<span>
						<IconButton
							size="small"
							disabled={!selected || at <= 0}
							onClick={() => selected && onReorder(selected, -1)}
						>
							<ArrowUpwardIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Tooltip title="Move down among its siblings">
					<span>
						<IconButton
							size="small"
							disabled={!selected || at < 0 || at >= siblings.length - 1}
							onClick={() => selected && onReorder(selected, 1)}
						>
							<ArrowDownwardIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Tooltip title="Make it a child of the object above it">
					<span>
						<IconButton
							size="small"
							disabled={!selected || at <= 0}
							onClick={() => selected && onIndent(selected)}
						>
							<FormatIndentIncreaseIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Tooltip title="Make it a sibling of its parent">
					<span>
						<IconButton
							size="small"
							disabled={!selected || !parent || parent.id === root.id}
							onClick={() => selected && onOutdent(selected)}
						>
							<FormatIndentDecreaseIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
			</Stack>
		</Box>
	);
}
