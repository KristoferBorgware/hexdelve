/*
 * The left-hand panel. There is no scene graph to list yet — the world is one
 * static instance buffer — so this stands in for one with the pieces the yard
 * is actually made of, and will be driven by the scene once there is a scene.
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
import { useState } from 'react';

const NODES = [
	{ id: 'ground', label: 'Ground', detail: 'hex field, terraced', icon: <GrassIcon /> },
	{ id: 'cabin', label: 'Log cabin', detail: 'walls, roof, chimney', icon: <CabinIcon /> },
	{ id: 'anvil', label: 'Anvil', detail: 'stump and face', icon: <HardwareIcon /> },
	{ id: 'sun', label: 'Sun', detail: 'directional', icon: <LightModeIcon /> },
	{ id: 'camera', label: 'Camera', detail: 'orbit', icon: <VideocamIcon /> },
];

export function SceneOutline() {
	const [selected, setSelected] = useState('ground');

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
