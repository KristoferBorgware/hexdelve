import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { theme } from './theme.js';

const container = document.getElementById('root');
if (!container) throw new Error('The page is missing its #root element.');

createRoot(container).render(
	<StrictMode>
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<App />
		</ThemeProvider>
	</StrictMode>,
);
