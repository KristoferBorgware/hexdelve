/*
 * The object tree of a prefab, and the buttons that change its shape.
 *
 * A real tree rather than a list of indented rows: `RichTreeView` brings the
 * things a hand-rolled outline does not have and that a hierarchy needs as soon
 * as it is more than one deep — branches that collapse, arrow keys that walk
 * them, type-ahead, and the `tree`/`treeitem` roles that make the depth of a
 * row audible rather than only visible.
 *
 * Rows carry the number of components on the object, because an object with
 * nothing on it is the one most likely to be a mistake: an empty `grip` is
 * deliberate, an empty `wanderer` is a prefab somebody has not finished.
 *
 * ## Why reparenting is buttons rather than dragging
 *
 * Dragging rows about is a paid feature of this component, and the two buttons
 * reach every arrangement it would: indent makes an object a child of the
 * sibling above it, outdent makes it a sibling of its parent. They also say
 * what they did, where a drop between two rows at a particular indent is a
 * guess about intent that the pointer has to make and frequently gets wrong.
 *
 * ## Expansion
 *
 * Everything starts open and stays where it is put. A prefab is small enough
 * that hiding any of it by default hides the thing somebody came to find, and
 * an object added under a closed branch would otherwise be selected, renamed
 * and invisible — so a new id arrives expanded.
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
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import { TreeItem, type TreeItemProps } from '@mui/x-tree-view/TreeItem';
import { useTreeItemModel } from '@mui/x-tree-view/hooks';
import { forwardRef, useEffect, useMemo, useState } from 'react';

import { parentOf, subtreeIds, type DraftNode } from './entitydraft.js';

export interface EntityTreeProps {
	root: DraftNode;
	selectedId: string | null;
	onSelect(id: string): void;
	onAdd(parentId: string): void;
	onRemove(id: string): void;
	onReorder(id: string, by: -1 | 1): void;
	onIndent(id: string): void;
	onOutdent(id: string): void;
}

/**
 * One row, in the shape the tree wants.
 *
 * Built rather than handed the draft directly: the draft's arrays are readonly
 * and its nodes carry components the tree has no use for, and a row that
 * carried the whole object would redraw every time any field on it changed.
 */
interface Row {
	id: string;
	label: string;
	count: number;
	children: Row[];
}

function toRows(node: DraftNode): Row {
	return {
		id: node.id,
		label: node.name,
		count: node.components.length,
		children: node.children.map(toRows),
	};
}

/**
 * A row, with the number of components on it at the end.
 *
 * The count comes off the item model rather than out of a lookup closed over
 * here, so a row knows what it is showing without the tree having to hand it
 * down through props it does not otherwise have.
 */
const CountedItem = forwardRef(function CountedItem(
	props: TreeItemProps,
	ref: React.Ref<HTMLLIElement>,
) {
	const row = useTreeItemModel<Row>(props.itemId);
	const count = row?.count ?? 0;

	return (
		<TreeItem
			{...props}
			ref={ref}
			label={
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<Typography variant="body2" noWrap sx={{ flex: 1 }}>
						{row?.label ?? props.label}
					</Typography>
					{count > 0 && (
						<Typography variant="caption" color="text.secondary">
							{count}
						</Typography>
					)}
				</Box>
			}
		/>
	);
});

export function EntityTree({
	root,
	selectedId,
	onSelect,
	onAdd,
	onRemove,
	onReorder,
	onIndent,
	onOutdent,
}: EntityTreeProps) {
	const rows = useMemo(() => [toRows(root)], [root]);
	const ids = useMemo(() => subtreeIds(root), [root]);

	const [expanded, setExpanded] = useState<string[]>(ids);

	// Anything new starts open. Whatever was closed stays closed.
	useEffect(() => {
		setExpanded((current) => {
			const known = new Set(current);
			const added = ids.filter((id) => !known.has(id) && !closedOnce.has(id));
			return added.length === 0 ? current : [...current, ...added];
		});
		// `closedOnce` is a ref-like set held outside React state on purpose: it
		// records a decision rather than describing the view, so changing it must
		// not redraw anything.
	}, [ids]);

	const [closedOnce] = useState(() => new Set<string>());

	const parent = selectedId ? parentOf(root, selectedId) : null;
	const siblings = parent?.children ?? [];
	const at = siblings.findIndex((one) => one.id === selectedId);
	const isRoot = selectedId === root.id;

	return (
		<Box
			sx={{
				width: 280,
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
				<RichTreeView
					items={rows}
					selectedItems={selectedId}
					expandedItems={expanded}
					getItemLabel={(item: Row) => item.label}
					onSelectedItemsChange={(_event, id) => {
						if (typeof id === 'string') onSelect(id);
					}}
					onExpandedItemsChange={(_event, next) => {
						// Remember what was shut, so a redraw does not reopen it.
						for (const id of expanded) if (!next.includes(id)) closedOnce.add(id);
						for (const id of next) closedOnce.delete(id);
						setExpanded(next);
					}}
					slots={{ item: CountedItem }}
				/>
			</Box>

			<Divider />
			<Stack direction="row" spacing={0.5} sx={{ p: 0.5 }}>
				<Tooltip title="Add a child object">
					<span>
						<IconButton
							size="small"
							disabled={!selectedId}
							onClick={() => selectedId && onAdd(selectedId)}
						>
							<AddIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Tooltip title={isRoot ? 'A prefab is one object; the root cannot go' : 'Remove'}>
					<span>
						<IconButton
							size="small"
							disabled={!selectedId || isRoot}
							onClick={() => selectedId && onRemove(selectedId)}
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
							disabled={!selectedId || at <= 0}
							onClick={() => selectedId && onReorder(selectedId, -1)}
						>
							<ArrowUpwardIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Tooltip title="Move down among its siblings">
					<span>
						<IconButton
							size="small"
							disabled={!selectedId || at < 0 || at >= siblings.length - 1}
							onClick={() => selectedId && onReorder(selectedId, 1)}
						>
							<ArrowDownwardIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Tooltip title="Make it a child of the object above it">
					<span>
						<IconButton
							size="small"
							disabled={!selectedId || at <= 0}
							onClick={() => selectedId && onIndent(selectedId)}
						>
							<FormatIndentIncreaseIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
				<Tooltip title="Make it a sibling of its parent">
					<span>
						<IconButton
							size="small"
							disabled={!selectedId || !parent || parent.id === root.id}
							onClick={() => selectedId && onOutdent(selectedId)}
						>
							<FormatIndentDecreaseIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
			</Stack>
		</Box>
	);
}
