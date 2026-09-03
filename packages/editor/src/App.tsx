/*
 * The editor shell: a toolbar, and one of six views under it.
 *
 * The YARD is the game, in a box — the client, unchanged, doing what a player
 * would see. The three BENCHES are the other thing an editor is for: one
 * subject, alone, held still. The character bench puts a rig on a stand with a
 * clock, because a running world will not hold a frame still; the prop bench
 * puts one piece of gear on the same stand, because a running world will not
 * show you a helmet at all — the three in the yard are lying in the grass at the
 * far end of it; and the level bench holds one generated dungeon while its
 * algorithm is compared against another one's, because a generator is a function
 * from a seed to a shape and the only way to judge the shape is to look at a lot
 * of them quickly. All three have scenes of their own for that reason and no
 * other.
 *
 * The ASSETS view is the odd one out, and the newest. Every other view here
 * previews something the code decided; that one edits the decision — the YAML
 * under public/assets, through the dev server, which is the only host in this
 * project that can write a file. It is also where the editor admits it cannot:
 * the built page published to Pages reads the same files and says so.
 *
 * The level bench is the one with no clock, which is why the transport is
 * disabled while it is up rather than left there doing nothing: a level does not
 * move, it is redrawn when something about it changes. The vault and asset views
 * are the same case for the same reason.
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

import { Assets } from './components/Assets.js';
import { Bench } from './components/Bench.js';
import { PropBenchView } from './components/PropBenchView.js';
import { Inspector } from './components/Inspector.js';
import { Levels } from './components/Levels.js';
import { Vaults } from './components/Vaults.js';
import { SceneOutline } from './components/SceneOutline.js';
import { Viewport } from './components/Viewport.js';

type View = 'yard' | 'bench' | 'props' | 'levels' | 'vaults' | 'assets';

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
						<ToggleButton value="assets">Assets</ToggleButton>
						<ToggleButton value="bench">Character</ToggleButton>
						<ToggleButton value="props">Props</ToggleButton>
						<ToggleButton value="levels">Level</ToggleButton>
						<ToggleButton value="vaults">Vault</ToggleButton>
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
							view === 'levels' || view === 'vaults' || view === 'assets'
								? 'Nothing here has a frame loop to run'
								: running
									? 'Pause the frame loop'
									: 'Run the frame loop'
						}
					>
						<span>
							<Button
								size="small"
								variant="outlined"
								disabled={view === 'levels' || view === 'vaults' || view === 'assets'}
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
				{view === 'props' && <PropBenchView backend={backend} running={running} />}
				{view === 'levels' && <Levels backend={backend} />}
				{view === 'vaults' && <Vaults />}
				{view === 'assets' && <Assets />}
			</Box>
		</Box>
	);
}
