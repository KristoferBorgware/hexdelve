/*
 * The code editor, loaded when something asks for one.
 *
 * Monaco is four megabytes. Five of the editor's seven views have no text in
 * them at all, and the one the editor opens on is the yard — so paying for a
 * language service before anybody has asked to see a file would be the whole
 * cost of this feature charged to the people not using it.
 *
 * So the pane itself is behind a dynamic import, and this is the component
 * every view actually names. The types are imported for their own sake, which
 * costs nothing: a type import is erased, so naming `CodeEditorProps` here
 * does not pull `MonacoPane` — and with it Monaco — into this chunk.
 */

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Suspense, lazy } from 'react';

import type { CodeEditorProps } from './MonacoPane.js';

export type { CodeEditorProps, CodeLanguage, CodeMarker } from './MonacoPane.js';

const Pane = lazy(async () => ({ default: (await import('./MonacoPane.js')).MonacoPane }));

export function CodeEditor(props: CodeEditorProps) {
	return (
		<Suspense
			fallback={
				<Box sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center' }}>
					<CircularProgress size={22} />
				</Box>
			}
		>
			<Pane {...props} />
		</Suspense>
	);
}
