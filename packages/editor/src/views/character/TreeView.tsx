/*
 * The tree, with what each leaf is currently worth.
 *
 * This is the reason the bench knows about blend trees at all. A tree's pose is
 * a sum of leaves, and when it looks wrong the question is always which leaf is
 * contributing what — a number you cannot get from the picture and would not
 * guess from the parameters, because a Blend1D's weights are a function of
 * where a value falls between two thresholds and an Additive's are a function
 * of a gain three levels up.
 *
 * The structure is read off the tree rather than described, the same way the
 * bone list is read off the skeleton: change the tree in `trees.ts` and this
 * draws the new one.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import type { ActiveLeaf, BlendNode } from '@hexdelve/engine';

export interface TreeViewProps {
	root: BlendNode;
	/** The last evaluation's leaf weights, polled by the panel. */
	active: readonly ActiveLeaf[];
}

interface Row {
	readonly node: BlendNode;
	readonly depth: number;
	/** The parameter value at which this child is the whole answer, if any. */
	readonly at: number | null;
	/** True when it hangs off the additive side of a layer or an additive. */
	readonly over: boolean;
	readonly key: string;
}

const KIND: Record<string, string> = {
	blend1d: 'Blend1D',
	additive: 'Additive',
	layer: 'Layer',
};

function flatten(node: BlendNode, depth: number, at: number | null, over: boolean, key: string, out: Row[]): void {
	out.push({ node, depth, at, over, key });
	if (node.kind === 'blend1d') {
		node.entries.forEach((entry, i) => {
			flatten(entry.node, depth + 1, entry.at, over, `${key}.${i}`, out);
		});
	} else if (node.kind !== 'leaf') {
		flatten(node.base, depth + 1, null, over, `${key}.b`, out);
		// The right-hand child of an additive or a layer is the one laid on top.
		flatten(node.over, depth + 1, null, true, `${key}.o`, out);
	}
}

export function TreeView({ root, active }: TreeViewProps) {
	const rows = useMemo(() => {
		const out: Row[] = [];
		flatten(root, 0, null, false, 'r', out);
		return out;
	}, [root]);

	const weights = useMemo(() => {
		const map = new Map<BlendNode, number>();
		for (const entry of active) map.set(entry.node, entry.weight);
		return map;
	}, [active]);

	return (
		<Box sx={{ mt: 0.5 }}>
			{rows.map((row) => {
				const isLeaf = row.node.kind === 'leaf';
				const weight = isLeaf ? (weights.get(row.node) ?? 0) : null;
				const off = weight !== null && weight < 0.005;

				return (
					<Box
						key={row.key}
						sx={{
							display: 'flex',
							alignItems: 'center',
							gap: 0.75,
							pl: row.depth * 1.1,
							py: 0.1,
							opacity: off ? 0.38 : 1,
						}}
					>
						{isLeaf ? (
							<>
								<Typography
									variant="caption"
									sx={{ flexGrow: 1, minWidth: 0, color: row.over ? 'secondary.main' : 'text.primary' }}
									noWrap
								>
									{row.node.label}
									{row.at !== null && (
										<Typography
											component="span"
											variant="caption"
											color="text.secondary"
											sx={{ ml: 0.5, fontVariantNumeric: 'tabular-nums' }}
										>
											@{row.at.toFixed(2)}
										</Typography>
									)}
								</Typography>
								<Box
									sx={{
										width: 54,
										height: 4,
										borderRadius: 2,
										flexShrink: 0,
										bgcolor: 'action.disabledBackground',
										overflow: 'hidden',
									}}
								>
									<Box
										sx={{
											width: `${Math.min(100, (weight ?? 0) * 100)}%`,
											height: '100%',
											bgcolor: row.over ? 'secondary.main' : 'primary.main',
										}}
									/>
								</Box>
								<Typography
									variant="caption"
									color="text.secondary"
									sx={{ width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
								>
									{Math.round((weight ?? 0) * 100)}%
								</Typography>
							</>
						) : (
							<Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
								<Box
									component="span"
									sx={{
										color: 'primary.main',
										fontWeight: 650,
										letterSpacing: '0.03em',
										mr: 0.6,
									}}
								>
									{KIND[row.node.kind]}
								</Box>
								{row.node.label}
							</Typography>
						)}
					</Box>
				);
			})}
		</Box>
	);
}
