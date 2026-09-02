/*
 * The editor shell: a toolbar, a scene list, the game, an inspector.
 *
 * The backend selector is here rather than buried in a settings dialog on
 * purpose. Two renderers that are meant to draw the same picture only stay
 * that way if switching between them is one click during ordinary work.
 */

import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useCallback, useState } from 'react';
import type { HexdelveClient } from '@hexdelve/client';
import type { BackendPreference } from '@hexdelve/engine';

import { Inspector } from './components/Inspector.js';
import { SceneOutline } from './components/SceneOutline.js';
import { Viewport } from './components/Viewport.js';

export function App() {
	const [client, setClient] = useState<HexdelveClient | null>(null);
	const [backend, setBackend] = useState<BackendPreference>('auto');
	const [running, setRunning] = useState(true);

	// Stable, because Viewport tears the client down when this identity changes.
	const onClientReady = useCallback((next: HexdelveClient | null) => setClient(next), []);

	return (
		<Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
			<AppBar position="static" color="default" sx={{ borderBottom: 1, borderColor: 'divider' }}>
				<Toolbar variant="dense" sx={{ gap: 2 }}>
					<Typography variant="h6" sx={{ mr: 1 }}>
						Hexdelve
					</Typography>
					<Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
						editor
					</Typography>

					<ToggleButtonGroup
						size="small"
						exclusive
						value={backend}
						onChange={(_, value: BackendPreference | null) => value && setBackend(value)}
					>
						<ToggleButton value="auto">Auto</ToggleButton>
						<ToggleButton value="webgpu">WebGPU</ToggleButton>
						<ToggleButton value="webgl2">WebGL2</ToggleButton>
					</ToggleButtonGroup>

					<Tooltip title={running ? 'Pause the frame loop' : 'Run the frame loop'}>
						<Button
							size="small"
							variant="outlined"
							startIcon={running ? <PauseIcon /> : <PlayArrowIcon />}
							onClick={() => setRunning((value) => !value)}
						>
							{running ? 'Pause' : 'Play'}
						</Button>
					</Tooltip>
				</Toolbar>
			</AppBar>

			<Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
				<SceneOutline />
				<Viewport backend={backend} running={running} onClientReady={onClientReady} />
				<Inspector client={client} />
			</Box>
		</Box>
	);
}
