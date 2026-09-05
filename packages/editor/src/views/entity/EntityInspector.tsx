/*
 * What the selected object is: its name, where it sits, and what is on it.
 *
 * The three sections are the three halves of an object. A name, because that is
 * how everything else refers to it. A transform, because an object's whole
 * contribution to the picture may be where it puts its children. And the
 * components, because everything a thing DOES is something attached to it.
 *
 * ## Where the fields on a component come from
 *
 * Two different places, and the difference is worth seeing. A SCRIPT declares
 * its parameters in its own source with `param()`, so the controls here are
 * drawn from the compiled class — every field it declares, with its type, its
 * bounds and its default, whether or not the prefab sets it. Anything else is a
 * bag of fields the engine has never heard of, and the only honest thing to
 * show is what the file actually carries.
 *
 * A field left unset is left OUT of the file rather than written with the
 * default in it. The two load the same today and stop agreeing the moment the
 * default changes, and the one that stays right is the absent one — so a
 * control shows the default greyed until somebody sets it, and clearing a
 * control removes the key.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteIcon from '@mui/icons-material/Delete';
import { useState } from 'react';
import type { ParameterMeta } from '@hexdelve/engine';

import type { DraftComponent, DraftNode } from './entitydraft.js';

export interface EntityInspectorProps {
	node: DraftNode | null;
	/** The component types this build can instantiate, plus `script`. */
	componentTypes: readonly string[];
	/** The script classes the editor has compiled, by name. */
	scriptNames: readonly string[];
	/** What a named script declares, or empty when it is not compiled. */
	parametersOfScript(name: string): readonly ParameterMeta[];
	onRename(name: string): void;
	onTransform(part: 'at' | 'euler', axis: 0 | 1 | 2, value: number): void;
	onAddComponent(type: string): void;
	onRemoveComponent(componentId: string): void;
	onField(componentId: string, key: string, value: unknown): void;
}

const AXES = ['X', 'Y', 'Z'] as const;

export function EntityInspector(props: EntityInspectorProps) {
	const { node } = props;
	const [adding, setAdding] = useState('');

	if (!node) {
		return (
			<Panel>
				<Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
					Nothing selected.
				</Typography>
			</Panel>
		);
	}

	return (
		<Panel>
			<Section title="Object">
				<TextField
					size="small"
					fullWidth
					label="Name"
					value={node.name}
					onChange={(event) => props.onRename(event.target.value)}
				/>
			</Section>

			<Section title="Transform">
				<Vector
					label="Position"
					values={node.at}
					onChange={(axis, value) => props.onTransform('at', axis, value)}
				/>
				<Vector
					label="Rotation"
					values={node.euler}
					onChange={(axis, value) => props.onTransform('euler', axis, value)}
				/>
			</Section>

			<Section title="Components">
				{node.components.length === 0 && (
					<Typography variant="body2" color="text.secondary">
						Nothing attached. An object with no components is a place to hang others from.
					</Typography>
				)}

				{node.components.map((component) => (
					<ComponentCard
						key={component.id}
						component={component}
						parameters={
							component.type === 'script'
								? props.parametersOfScript(String(component.fields['script'] ?? ''))
								: null
						}
						scriptNames={props.scriptNames}
						onRemove={() => props.onRemoveComponent(component.id)}
						onField={(key, value) => props.onField(component.id, key, value)}
					/>
				))}

				<Stack direction="row" spacing={1}>
					<TextField
						select
						size="small"
						fullWidth
						label="Add a component"
						value={adding}
						onChange={(event) => setAdding(event.target.value)}
					>
						{props.componentTypes.map((type) => (
							<MenuItem key={type} value={type}>
								{type}
							</MenuItem>
						))}
					</TextField>
					<Button
						size="small"
						variant="outlined"
						disabled={!adding}
						onClick={() => {
							props.onAddComponent(adding);
							setAdding('');
						}}
					>
						Add
					</Button>
				</Stack>
			</Section>
		</Panel>
	);
}

function Panel({ children }: { children: React.ReactNode }) {
	return (
		<Box
			sx={{
				width: 340,
				borderLeft: 1,
				borderColor: 'divider',
				overflow: 'auto',
				display: 'flex',
				flexDirection: 'column',
			}}
		>
			{children}
		</Box>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<>
			<Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
				<Typography variant="overline" color="text.secondary">
					{title}
				</Typography>
				<Stack spacing={1.5} sx={{ mt: 1 }}>
					{children}
				</Stack>
			</Box>
			<Divider />
		</>
	);
}

/** Three numbers on one line, labelled the way the file writes them. */
function Vector({
	label,
	values,
	onChange,
}: {
	label: string;
	values: readonly [number, number, number];
	onChange(axis: 0 | 1 | 2, value: number): void;
}) {
	return (
		<Box>
			<Typography variant="caption" color="text.secondary">
				{label}
			</Typography>
			<Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
				{AXES.map((axis, index) => (
					<TextField
						key={axis}
						size="small"
						label={axis}
						type="number"
						value={values[index]}
						onChange={(event) => {
							const next = Number(event.target.value);
							// A half-typed number is not a transform. Leaving the
							// field alone lets somebody type `-` or `0.` on the way
							// to a value without the object jumping to NaN.
							if (Number.isFinite(next)) onChange(index as 0 | 1 | 2, next);
						}}
						slotProps={{ htmlInput: { step: 0.01 } }}
					/>
				))}
			</Stack>
		</Box>
	);
}

function ComponentCard({
	component,
	parameters,
	scriptNames,
	onRemove,
	onField,
}: {
	component: DraftComponent;
	/** Null for anything that is not a script, which declares nothing. */
	parameters: readonly ParameterMeta[] | null;
	scriptNames: readonly string[];
	onRemove(): void;
	onField(key: string, value: unknown): void;
}) {
	const isScript = component.type === 'script';
	const named = String(component.fields['script'] ?? '');

	return (
		<Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
			<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
				<Typography variant="subtitle2" sx={{ flex: 1 }}>
					{isScript && named ? `script · ${named}` : component.type}
				</Typography>
				<Tooltip title="Remove this component">
					<IconButton size="small" onClick={onRemove}>
						<DeleteIcon fontSize="small" />
					</IconButton>
				</Tooltip>
			</Stack>

			<Stack spacing={1.5} sx={{ mt: 1 }}>
				{isScript && (
					<TextField
						select
						size="small"
						fullWidth
						label="Script"
						value={scriptNames.includes(named) ? named : ''}
						helperText={
							named && !scriptNames.includes(named)
								? `'${named}' is not among the compiled scripts`
								: undefined
						}
						error={Boolean(named) && !scriptNames.includes(named)}
						onChange={(event) => onField('script', event.target.value)}
					>
						{scriptNames.map((one) => (
							<MenuItem key={one} value={one}>
								{one}
							</MenuItem>
						))}
					</TextField>
				)}

				{parameters?.map((parameter) => (
					<Parameter
						key={parameter.key}
						meta={parameter}
						set={Object.hasOwn(component.fields, parameter.key)}
						value={component.fields[parameter.key]}
						onChange={(value) => onField(parameter.key, value)}
					/>
				))}

				{/*
				 * A component the engine cannot introspect shows what the file
				 * carries and nothing invented: `actor` and `item` are the
				 * game's, and this has never heard of either.
				 */}
				{parameters === null &&
					Object.entries(component.fields).map(([key, value]) => (
						<TextField
							key={key}
							size="small"
							fullWidth
							label={key}
							value={String(value)}
							onChange={(event) => onField(key, coerce(event.target.value, value))}
						/>
					))}
			</Stack>
		</Box>
	);
}

/**
 * One control for one declared field.
 *
 * The placeholder is the class's own default, so an unset field shows what it
 * will do rather than showing empty. Clearing the box takes the key out of the
 * file, which is what "unset" means.
 */
function Parameter({
	meta,
	set,
	value,
	onChange,
}: {
	meta: ParameterMeta;
	set: boolean;
	value: unknown;
	onChange(value: unknown): void;
}) {
	const label = meta.options.label ?? meta.key;

	if (meta.type === 'boolean') {
		return (
			<TextField
				select
				size="small"
				fullWidth
				label={label}
				value={set ? String(Boolean(value)) : ''}
				helperText={meta.options.hint}
				onChange={(event) =>
					onChange(event.target.value === '' ? undefined : event.target.value === 'true')
				}
			>
				<MenuItem value="">default ({String(meta.default)})</MenuItem>
				<MenuItem value="true">true</MenuItem>
				<MenuItem value="false">false</MenuItem>
			</TextField>
		);
	}

	return (
		<TextField
			size="small"
			fullWidth
			label={label}
			type={meta.type === 'number' ? 'number' : 'text'}
			value={set ? String(value ?? '') : ''}
			placeholder={String(meta.default)}
			helperText={meta.options.hint}
			slotProps={{
				inputLabel: { shrink: true },
				htmlInput: {
					...(meta.options.min === undefined ? {} : { min: meta.options.min }),
					...(meta.options.max === undefined ? {} : { max: meta.options.max }),
					...(meta.options.step === undefined ? {} : { step: meta.options.step }),
				},
			}}
			onChange={(event) => {
				const text = event.target.value;
				if (text === '') {
					onChange(undefined);
					return;
				}
				if (meta.type !== 'number') {
					onChange(text);
					return;
				}
				const next = Number(text);
				if (Number.isFinite(next)) onChange(next);
			}}
		/>
	);
}

/**
 * A typed value out of a text box, for a field nothing declared.
 *
 * The type it had is the only clue there is about the type it wants, so a field
 * that was a number stays one. A prefab whose `lift` became the string `'0.2'`
 * would put a NaN in a transform and lose the object rather than say anything.
 */
function coerce(text: string, was: unknown): unknown {
	if (typeof was === 'number') {
		const next = Number(text);
		return Number.isFinite(next) ? next : was;
	}
	if (typeof was === 'boolean') return text === 'true';
	return text;
}
