import { ipcRenderer, contextBridge } from 'electron';

const isLocalSource = () => {
	// Check if the execution environment is local
	const origin = window.location.origin;

	// Allow local sources: file protocol, localhost, or 0.0.0.0
	return (
		origin.startsWith('file://') ||
		origin.includes('localhost') ||
		origin.includes('127.0.0.1') ||
		origin.includes('0.0.0.0')
	);
};

window.addEventListener('DOMContentLoaded', () => {
	// Listen for messages from the main process
	ipcRenderer.on('main:data', (event, data) => {
		// Forward the message to the renderer using window.postMessage
		window.postMessage(
			{
				...data,
				type: `electron:${data.type}`
			},
			window.location.origin
		);
	});
});

contextBridge.exposeInMainWorld('electronAPI', {
	onLog: (callback: (message: string) => void) => {
		if (!isLocalSource()) {
			throw new Error('Access restricted: This operation is only allowed in a local environment.');
		}

		ipcRenderer.on('main:log', (_, message: string) => callback(message));
	},

	send: async ({ type, data }: { type: string; data?: any }) => {
		return await ipcRenderer.invoke('renderer:data', { type, data });
	},

	installPackage: async () => {
		if (!isLocalSource()) {
			throw new Error('Access restricted: This operation is only allowed in a local environment.');
		}

		await ipcRenderer.invoke('install');
	},

	getInstallStatus: async () => {
		return await ipcRenderer.invoke('install:status');
	},

	removePackage: async () => {
		if (!isLocalSource()) {
			throw new Error('Access restricted: This operation is only allowed in a local environment.');
		}

		await ipcRenderer.invoke('remove');
	},

	getServerStatus: async () => {
		if (!isLocalSource()) {
			throw new Error('Access restricted: This operation is only allowed in a local environment.');
		}

		return await ipcRenderer.invoke('server:status');
	},

	startServer: async () => {
		if (!isLocalSource()) {
			throw new Error('Access restricted: This operation is only allowed in a local environment.');
		}

		await ipcRenderer.invoke('server:start');
	},

	stopServer: async () => {
		if (!isLocalSource()) {
			throw new Error('Access restricted: This operation is only allowed in a local environment.');
		}

		await ipcRenderer.invoke('server:stop');
	},

	getServerUrl: async () => {
		return await ipcRenderer.invoke('server:url');
	},

	// New function to trigger connecting to an external server
	connectExternalServer: async (url?: string) => {
		if (!isLocalSource()) {
			throw new Error('Access restricted: This operation is only allowed in a local environment.');
		}
		await ipcRenderer.invoke('connect-external', url); // Pass optional URL
	},

	notification: async (title: string, body: string) => {
		await ipcRenderer.invoke('notification', { title, body });
	}
});
