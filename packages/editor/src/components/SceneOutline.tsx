/*
 * The left-hand panel: what is in the yard.
 *
 * Still a hand-written list rather than a real scene graph, because there is
 * still no graph to walk — the world is one instance buffer and the actors are
 * rigs, not nodes. It names what is actually out there now, and will be driven
 * by the scene once there is a scene to drive it from.
 */

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import GrassIcon from '@mui/icons-material/Grass';
import CabinIcon from '@mui/icons-material/Cabin';
import HardwareIcon from '@mui/icons-material/Hardware';
import LightModeIcon from '@mui/icons-material/LightMode';
import VideocamIcon from '@mui/icons-material/Videocam';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import PestControlIcon from '@mui/icons-material/PestControl';
import ShieldIcon from '@mui/icons-material/Shield';
import { useState } from 'react';

const NODES = [
	{ id: 'wanderer', label: 'Wanderer', detail: '17 bones, free movement', icon: <DirectionsWalkIcon /> },
	{ id: 'bat', label: 'The bat', detail: '20 bones, hunts the grid', icon: <PestControlIcon /> },
	{ id: 'gear', label: 'Gear', detail: 'helmet, sword, shield', icon: <ShieldIcon /> },
	{ id: 'ground', label: 'Ground', detail: 'hex field, terraced', icon: <GrassIcon /> },
	{ id: 'cabin', label: 'Buildings', detail: 'smithy and log cabin', icon: <CabinIcon /> },
	{ id: 'anvil', label: 'Anvil', detail: 'stump and face', icon: <HardwareIcon /> },
	{ id: 'sun', label: 'Sun', detail: 'directional', icon: <LightModeIcon /> },
	{ id: 'camera', label: 'Camera', detail: 'orthographic, isometric', icon: <VideocamIcon /> },
];

export function SceneOutline() {
	const [selected, setSelected] = useState('wanderer');

	return (
		<Box
			component="nav"
			sx={{
				width: 236,
				flexShrink: 0,
				borderRight: 1,
				borderColor: 'divider',
				bgcolor: 'background.paper',
				overflowY: 'auto',
				py: 2,
			}}
		>
			<Typography variant="subtitle2" color="text.secondary" sx={{ px: 2 }}>
				Scene
			</Typography>
			<List dense sx={{ mt: 0.5 }}>
				{NODES.map((node) => (
					<ListItemButton
						key={node.id}
						selected={selected === node.id}
						onClick={() => setSelected(node.id)}
					>
						<ListItemIcon sx={{ minWidth: 34, color: 'text.secondary' }}>{node.icon}</ListItemIcon>
						<ListItemText primary={node.label} secondary={node.detail} />
					</ListItemButton>
				))}
			</List>
		</Box>
	);
}
