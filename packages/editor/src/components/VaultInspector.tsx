/*
 * The vault bench's right-hand panel: the brush, the numbers, and the way out.
 *
 * The problems list is the part worth arguing for. `vaultProblems` is the same
 * function the placer runs before it will use a vault, so what is red here is
 * exactly what would have made the vault silently never appear in a level —
 * which is the failure mode a bench exists to prevent. A vault with no door
 * draws beautifully and is a room nobody can enter.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { VaultEntityKind, VaultTerrain } from '@hexdelve/client';

import { resize, toSource, type VaultDraft } from '../vault/store.js';
import type { Brush } from './Vaults.js';
import { ENTITY_COLOR, ENTITY_GLYPH, TERRAIN_COLOR } from './VaultCanvas.js';

const TERRAINS: { terrain: VaultTerrain; label: string; hint: string }[] = [
	{ terrain: 'wall', label: 'Wall', hint: 'Solid. Nothing may ever dig through it.' },
	{ terrain: 'floor', label: 'Floor', hint: 'Walkable.' },
	{ terrain: 'door', label: 'Door', hint: 'Walkable, and the only place a corridor may arrive.' },
	{ terrain: 'outside', label: 'Outside', hint: 'Not part of the vault — the level shows through.' },
];

const KINDS: VaultEntityKind[] = ['monster', 'loot', 'trap', 'light', 'marker'];

export interface VaultInspectorProps {
	draft: VaultDraft | null;
	problems: readonly string[];
	brush: Brush;
	onBrushChange(brush: Brush): void;
	tier: number;
	onTierChange(tier: number): void;
	onChange(draft: VaultDraft): void;
	onRevert(): void;
}

export function VaultInspector({
	draft,
	problems,
	brush,
	onBrushChange,
	tier,
	onTierChange,
	onChange,
	onRevert,
}: VaultInspectorProps) {
	const [copied, setCopied] = useState(false);

	if (!draft) {
		return (
			<Box component="aside" sx={panel}>
				<Typography variant="caption" color="text.secondary">
					No vault selected.
				</Typography>
			</Box>
		);
	}

	const number = (
		label: string,
		value: number,
		set: (next: number) => void,
		hint: string,
	): React.ReactElement => (
		<Tooltip title={hint}>
			<TextField
				size="small"
				type="number"
				label={label}
				value={value}
				onChange={(event) => set(Number(event.target.value))}
				sx={{ flex: 1 }}
			/>
		</Tooltip>
	);

	return (
		<Box component="aside" sx={panel}>
			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Brush
			</Typography>

			<Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
				{TERRAINS.map(({ terrain, label, hint }) => (
					<Tooltip key={terrain} title={hint}>
						<Chip
							size="small"
							clickable
							label={label}
							variant={
								brush.paint === 'terrain' && brush.terrain === terrain ? 'filled' : 'outlined'
							}
							onClick={() => onBrushChange({ paint: 'terrain', terrain })}
							icon={
								<Box
									sx={{
										width: 10,
										height: 10,
										ml: 0.75,
										borderRadius: '2px',
										bgcolor: TERRAIN_COLOR[terrain],
										outline: '1px solid rgba(255,255,255,0.2)',
									}}
								/>
							}
						/>
					</Tooltip>
				))}
			</Stack>

			<Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
				{KINDS.map((kind) => (
					<Chip
						key={kind}
						size="small"
						clickable
						label={`${ENTITY_GLYPH[kind]} ${kind}`}
						variant={brush.paint === 'entity' && brush.kind === kind ? 'filled' : 'outlined'}
						onClick={() => onBrushChange({ paint: 'entity', kind })}
						sx={{ color: ENTITY_COLOR[kind] }}
					/>
				))}
				<Chip
					size="small"
					clickable
					label="erase"
					variant={brush.paint === 'erase' ? 'filled' : 'outlined'}
					onClick={() => onBrushChange({ paint: 'erase' })}
				/>
			</Stack>

			<Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
				Tier — {tier >= 0 ? `+${tier}` : tier} levels out of depth
			</Typography>
			<Slider
				size="small"
				min={-5}
				max={20}
				step={1}
				value={tier}
				onChange={(_, value) => onTierChange(value as number)}
			/>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Vault
			</Typography>

			<TextField
				size="small"
				fullWidth
				label="Name"
				value={draft.name}
				onChange={(event) => onChange({ ...draft, name: event.target.value })}
				sx={{ mb: 1 }}
			/>
			<TextField
				size="small"
				fullWidth
				label="Id"
				value={draft.id}
				onChange={(event) => onChange({ ...draft, id: event.target.value })}
				sx={{ mb: 1.5 }}
			/>

			<Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
				{number('Width', draft.width, (next) => onChange(resize(draft, clamp(next), draft.height)), 'Cells across')}
				{number('Height', draft.height, (next) => onChange(resize(draft, draft.width, clamp(next))), 'Cells down')}
			</Stack>

			<Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
				{number('Min depth', draft.minDepth, (next) => onChange({ ...draft, minDepth: next }), 'Shallowest level this may appear on')}
				{number('Max depth', draft.maxDepth, (next) => onChange({ ...draft, maxDepth: next }), 'Deepest level this may appear on')}
			</Stack>

			<Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
				{number('Rating', draft.rating, (next) => onChange({ ...draft, rating: next }), 'How much more dangerous a level feels for containing this')}
				{number('Weight', draft.weight, (next) => onChange({ ...draft, weight: next }), 'Relative frequency among the vaults eligible at a depth')}
			</Stack>

			<Divider sx={{ my: 1.5 }} />

			<Typography variant="subtitle2" color="text.secondary" gutterBottom>
				Checks
			</Typography>

			{problems.length === 0 ? (
				<Typography variant="caption" color="success.main">
					Ready to place.
				</Typography>
			) : (
				problems.map((problem) => (
					<Typography key={problem} variant="caption" color="error.main" sx={{ display: 'block' }}>
						This vault {problem}.
					</Typography>
				))
			)}

			<Divider sx={{ my: 1.5 }} />

			<Button
				fullWidth
				size="small"
				variant="outlined"
				onClick={() => {
					void navigator.clipboard?.writeText(toSource(draft));
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				}}
			>
				{copied ? 'Copied' : 'Copy as source'}
			</Button>
			<Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
				Paste into <code>levelgen/vault/catalogue.ts</code> to ship it. The browser keeps the
				working copy; the repository keeps the vaults.
			</Typography>

			{draft.local && (
				<Button fullWidth size="small" sx={{ mt: 1 }} onClick={onRevert}>
					Revert to the shipped version
				</Button>
			)}
		</Box>
	);
}

const clamp = (value: number): number => Math.max(1, Math.min(40, Math.round(value) || 1));

const panel = {
	width: 320,
	flexShrink: 0,
	borderLeft: 1,
	borderColor: 'divider',
	bgcolor: 'background.paper',
	overflowY: 'auto',
	p: 2,
} as const;
