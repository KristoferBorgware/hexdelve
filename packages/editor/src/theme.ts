/*
 * One dark theme, keyed off the same greens the labs and the landing page use,
 * so the editor does not look like it came from somewhere else.
 */

import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
	palette: {
		mode: 'dark',
		primary: { main: '#8fbc5c' },
		secondary: { main: '#c8a44a' },
		background: { default: '#1b201c', paper: '#232a24' },
		divider: 'rgba(180, 200, 180, 0.14)',
	},
	shape: { borderRadius: 8 },
	typography: {
		fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
		fontSize: 13,
		h6: { fontSize: 15, fontWeight: 620, letterSpacing: '-0.01em' },
		subtitle2: { fontSize: 11, fontWeight: 650, letterSpacing: '0.08em', textTransform: 'uppercase' },
	},
	components: {
		MuiPaper: { defaultProps: { elevation: 0 } },
	},
});
