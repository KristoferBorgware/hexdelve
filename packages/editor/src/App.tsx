/*
 * The editor shell: a toolbar, and one of three views under it.
 *
 * The YARD is the game, in a box — the client, unchanged, doing what a player
 * would see. The other two are benches, and a bench is this editor's word for a
 * view that holds one thing still while it is judged, because a running world
 * will not. The CHARACTER bench holds a rig at a frame you choose; the LEVEL
 * bench holds a generated dungeon while its algorithm is compared against
 * another one's.
 *
 * The level bench has no clock, which is why the transport is disabled while it
 * is up rather than left there doing nothing: a level does not move, it is
 * redrawn when something about it changes.
 *
 * The backend selector and the transport are shared, and sit here rather than
 * being buried in a settings dialog on purpose. Two renderers that are meant to
 * draw the same picture only stay that way if switching between them is one
 * click during ordinary work — and that is as true of a wing beat as of a yard.
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

import { Bench } from './components/Bench.js';
import { Inspector } from './components/Inspector.js';
import { Levels } from './components/Levels.js';
import { SceneOutline } from './components/SceneOutline.js';
import { Viewport } from './components/Viewport.js';

type View = 'yard' | 'bench' | 'levels';

export function App() {
	const [client, setClient] = useState<HexdelveClient | null>(null);
	const [backend, setBackend] = useState<BackendPreference>('auto');
	const [running, setRunning] = useState(true);
	const [view, setView] = useState<View>('yard');

	// Stable, because Viewport tears the client down when this identity changes.
	const onClientReady = useCallback((next: HexdelveClient | null) => setClient(next), []);

	return (
		<Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
			<AppBar position="static" color="default" sx={{ borderBottom: 1, borderColor: 'divider' }}>
				<Toolbar variant="dense" sx={{ gap: 2 }}>
					<Typography variant="h6" sx={{ mr: 1 }}>
						Hexdelve
					</Typography>
					<Typography variant="body2" color="text.secondary">
						editor
					</Typography>

					<ToggleButtonGroup
						size="small"
						exclusive
						value={view}
						sx={{ ml: 1 }}
						onChange={(_, value: View | null) => value && setView(value)}
					>
						<ToggleButton value="yard">Yard</ToggleButton>
						<ToggleButton value="bench">Character</ToggleButton>
						<ToggleButton value="levels">Level</ToggleButton>
					</ToggleButtonGroup>

					<Box sx={{ flexGrow: 1 }} />

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

					<Tooltip
						title={
							view === 'levels'
								? 'A level has no frame loop to run'
								: running
									? 'Pause the frame loop'
									: 'Run the frame loop'
						}
					>
						<span>
							<Button
								size="small"
								variant="outlined"
								disabled={view === 'levels'}
								startIcon={running ? <PauseIcon /> : <PlayArrowIcon />}
								onClick={() => setRunning((value) => !value)}
							>
								{running ? 'Pause' : 'Play'}
							</Button>
						</span>
					</Tooltip>
				</Toolbar>
			</AppBar>

			<Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
				{view === 'yard' && (
					<>
						<SceneOutline />
						<Viewport backend={backend} running={running} onClientReady={onClientReady} />
						<Inspector client={client} />
					</>
				)}
				{view === 'bench' && <Bench backend={backend} running={running} />}
				{view === 'levels' && <Levels backend={backend} />}
			</Box>
		</Box>
	);
}
