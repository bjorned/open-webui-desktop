import {
	app,
	nativeImage,
	desktopCapturer,
	session,
	clipboard,
	shell,
	Tray,
	Menu,
	MenuItem,
	BrowserWindow,
	globalShortcut,
	Notification,
	ipcMain,
	ipcRenderer,
	MenuItemConstructorOptions
} from 'electron';
import path from 'path';
import started from 'electron-squirrel-startup';

import {
	installPackage,
	removePackage,
	logEmitter,
	startServer,
	stopAllServers,
	validateInstallation
} from './utils';

// Restrict app to a single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
	app.quit(); // Quit if another instance is already running
} else {
	// Handle second-instance logic
	app.on('second-instance', (event, argv, workingDirectory) => {
		// This event happens if a second instance is launched
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore(); // Restore if minimized
			mainWindow.show(); // Show existing window
			mainWindow.focus(); // Focus the existing window
		}
	});

	// Handle creating/removing shortcuts on Windows during installation/uninstallation
	if (started) {
		app.quit();
	}

	app.setAboutPanelOptions({
		applicationName: 'Open WebUI',
		iconPath: path.join(__dirname, 'assets/icon.png'),
		applicationVersion: app.getVersion(),
		version: app.getVersion(),
		website: 'https://openwebui.com',
		copyright: `© ${new Date().getFullYear()} Open WebUI (Timothy Jaeryang Baek)`
	});

	// Main application logic
	let mainWindow: BrowserWindow | null = null;
	let tray: Tray | null = null;
	let isQuitting = false; // Use a local variable instead of attaching to app

	let SERVER_URL: string | null = null;
	let SERVER_STATUS = 'stopped';

	const USE_EXTERNAL_SERVER = true; // Force loading external URL on start
	const EXTERNAL_SERVER_URL = 'http://localhost:8080'; 

	logEmitter.on('log', (message) => {
		mainWindow?.webContents.send('main:log', message);
	});

	const loadDefaultView = () => {
		// Load index.html or dev server URL
		if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
			mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
		} else {
			mainWindow.loadFile(
				path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
			);
		}
	};

	const updateTrayMenu = (status: string, url: string | null) => {
		const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
			{
				label: 'Show Open WebUI',
				accelerator: 'CommandOrControl+Alt+O',
				click: () => {
					mainWindow?.show(); // Show the main window when clicked
				}
			},
			{
				type: 'separator'
			},
			{
				label: status, // Dynamic status message
				enabled: !!url,
				click: () => {
					if (url) {
						shell.openExternal(url); // Open the URL in the default browser
					}
				}
			},

			...(SERVER_STATUS === 'started'
				? [
						{
							label: 'Stop Server',
							click: async () => {
								await stopAllServers();
								SERVER_STATUS = 'stopped';
								mainWindow.webContents.send('main:data', {
									type: 'server:status',
									data: SERVER_STATUS
								});
								updateTrayMenu('Open WebUI: Stopped', null); // Update tray menu with stopped status
							}
						}
					]
				: SERVER_STATUS === 'starting'
					? [
							{
								label: 'Starting Server...',
								enabled: false
							}
						]
					: [
							{
								label: 'Start Server',
								click: async () => {
									await startServerHandler();
								}
							}
						]),

			{
				type: 'separator'
			},
			{
				label: 'Copy Server URL',
				enabled: !!url, // Enable if URL exists
				click: () => {
					if (url) {
						clipboard.writeText(url); // Copy the URL to clipboard
					}
				}
			},
			{
				type: 'separator'
			},
			{
				label: 'Quit Open WebUI',
				accelerator: 'CommandOrControl+Q',
				click: () => {
					isQuitting = true; // Mark as quitting using local variable
					app.quit(); // Quit the application
				}
			}
		];

		const trayMenu = Menu.buildFromTemplate(trayMenuTemplate);
		tray?.setContextMenu(trayMenu);
	};

	const startServerHandler = async () => {
		SERVER_STATUS = 'starting';
		mainWindow.webContents.send('main:data', {
			type: 'server:status',
			data: SERVER_STATUS
		});
		updateTrayMenu('Open WebUI: Starting...', null);

		try {
			// Actually start the local server now
			SERVER_URL = await startServer(); 
			SERVER_STATUS = 'started';

			// Send status updates to the renderer
			mainWindow.webContents.send('main:data', {
				type: 'install:status', // Assuming install is implicitly true if server starts
				data: true
			});
			mainWindow.webContents.send('main:data', {
				type: 'server:status',
				data: SERVER_STATUS
			});

			// Handle 0.0.0.0 case if necessary (server might return this)
			if (SERVER_URL.startsWith('http://0.0.0.0')) {
				SERVER_URL = SERVER_URL.replace('http://0.0.0.0', 'http://localhost');
			}

			// Load the URL returned by the local server
			mainWindow.loadURL(SERVER_URL);

			const urlObj = new URL(SERVER_URL);
			const port = urlObj.port || '8080'; // Default port if not specified
			updateTrayMenu(`Open WebUI: Running on port ${port}`, SERVER_URL); 

		} catch (error) {
			console.error('Failed to start local server:', error);
			SERVER_STATUS = 'failed';
			mainWindow.webContents.send('main:data', {
				type: 'server:status',
				data: SERVER_STATUS
			});

			mainWindow.webContents.send('main:log', `Failed to start server: ${error}`);
			updateTrayMenu('Open WebUI: Failed to Start', null); // Update tray menu with failure status
		}
	};

	const onReady = async () => {
		console.log(process.resourcesPath);
		console.log(app.getName());
		console.log(app.getPath('userData'));
		console.log(app.getPath('appData'));

		mainWindow = new BrowserWindow({
			width: 1000,
			height: 600,
			minWidth: 425,
			minHeight: 600,
			icon: path.join(__dirname, 'assets/icon.png'),
			webPreferences: {
				preload: path.join(__dirname, 'preload.js')
			},
			...(process.platform === 'win32'
				? {
						frame: false
					}
				: {}),
			titleBarStyle: process.platform === 'win32' ? 'default' : 'hidden',
			trafficLightPosition: { x: 10, y: 10 },
			// expose window controlls in Windows/Linux
			...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {})
		});
		mainWindow.setIcon(path.join(__dirname, 'assets/icon.png'));

		// Enables navigator.mediaDevices.getUserMedia API. See https://www.electronjs.org/docs/latest/api/desktop-capturer
		session.defaultSession.setDisplayMediaRequestHandler(
			(request, callback) => {
				desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
					// Grant access to the first screen found.
					callback({ video: sources[0], audio: 'loopback' });
				});
			},
			{ useSystemPicker: true }
		);

		// --- Load Correct View --- 
		if (USE_EXTERNAL_SERVER) {
			// Load external server directly
			console.log(`[External Server] Attempting to load: ${EXTERNAL_SERVER_URL}`);
			SERVER_URL = EXTERNAL_SERVER_URL;
			SERVER_STATUS = 'started';
			mainWindow.loadURL(EXTERNAL_SERVER_URL);

			// Send initial status immediately so frontend might skip launching screen
			mainWindow.webContents.send('main:data', {
				type: 'install:status',
				data: true
			});
			mainWindow.webContents.send('main:data', {
				type: 'server:status',
				data: SERVER_STATUS
			});

			// Listener for successful load (just for logging and updating tray)
			mainWindow.webContents.on('did-finish-load', () => {
				// Check if the final loaded URL is the one we intended
				const currentURL = mainWindow.webContents.getURL();
				// console.log(`[Event] did-finish-load: URL = ${currentURL}`); // REMOVED LOG
				if (currentURL.startsWith(EXTERNAL_SERVER_URL)) {
					// console.log(`[External Server] Successfully loaded: ${EXTERNAL_SERVER_URL}`); // REMOVED LOG
					updateTrayMenu(`Open WebUI: Connected to ${EXTERNAL_SERVER_URL}`, EXTERNAL_SERVER_URL);
				} else if (currentURL.startsWith('http://localhost:8080')) {
					// console.log(`[Fallback] Successfully loaded via fallback: ${currentURL}`); // REMOVED LOG
					// Tray menu updated in the fallback logic itself
				}
			});

			// Add error handling for loadURL
			mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
				// Only handle failures for the main frame load
				if (!isMainFrame) return;

				// console.error(`[Event] did-fail-load: URL=${validatedURL}, ErrorCode=${errorCode}, Desc=${errorDescription}`); // REMOVED LOG
				
				// Fallback to localhost if external server fails
				if (validatedURL === EXTERNAL_SERVER_URL) {
					const fallbackURL = 'http://localhost:8080';
					// console.log(`[Fallback] Attempting to load ${fallbackURL} due to previous error...`); // REMOVED LOG
					mainWindow.loadURL(fallbackURL)
						.then(() => {
							// Success log now handled by did-finish-load
							SERVER_URL = fallbackURL;
							updateTrayMenu(`Open WebUI: Fallback on ${fallbackURL}`, fallbackURL);
						})
						.catch(err => {
							// console.error(`[Fallback] Also failed to load ${fallbackURL}:`, err); // REMOVED LOG
							// Optionally load a local error page here
							// mainWindow.loadFile(path.join(__dirname, 'error.html'));
							updateTrayMenu('Open WebUI: Failed to load server', null);
						});
				}
			});

		} else {
			// Load local Svelte app/dev server
			loadDefaultView();
			if (!app.isPackaged) {
				mainWindow.webContents.openDevTools();
			}

			// Wait for the renderer to finish loading
			mainWindow.webContents.once('did-finish-load', async () => {
				console.log('[Local View] Renderer finished loading');

				// Check installation and potentially start the server
				if (await validateInstallation()) {
					mainWindow.webContents.send('main:data', {
						type: 'install:status',
						data: true
					});
					// Automatically start server if installed but stopped?
					// if (SERVER_STATUS === 'stopped') { 
					// 	 await startServerHandler(); 
					// }
				} else {
					mainWindow.webContents.send('main:data', {
						type: 'install:status',
						data: false
					});
				}
			});
		}
		// --- End Load Correct View --- 

		globalShortcut.register('Alt+CommandOrControl+O', () => {
			mainWindow?.show();

			if (mainWindow?.isMinimized()) mainWindow?.restore();
			mainWindow?.focus();
		});

		const defaultMenu = Menu.getApplicationMenu();
		let menuTemplate: (MenuItemConstructorOptions | MenuItem)[] = defaultMenu ? defaultMenu.items.map((item) => item) : [];
		menuTemplate.push({
			label: 'Action',
			submenu: [
				// {
				// 	label: 'Home',
				// 	accelerator: process.platform === 'darwin' ? 'Cmd+H' : 'Ctrl+H',
				// 	click: () => {
				// 		loadDefaultView();
				// 	}
				// },
				{
					label: 'Uninstall',
					click: () => {
						loadDefaultView();
						removePackage();
					}
				}
			] as MenuItemConstructorOptions[] // Explicitly type submenu
		});
		const updatedMenu = Menu.buildFromTemplate(menuTemplate);
		Menu.setApplicationMenu(updatedMenu);

		// Create a system tray icon
		const image = nativeImage.createFromPath(path.join(__dirname, 'assets/tray.png'));
		tray = new Tray(image.resize({ width: 16, height: 16 }));

		const trayMenu = Menu.buildFromTemplate([
			{
				label: 'Show Open WebUI',
				accelerator: 'CommandOrControl+Alt+O',

				click: () => {
					mainWindow.show(); // Show the main window when clicked
				}
			},
			{
				type: 'separator'
			},
			{
				label: 'Quit Open WebUI',
				accelerator: 'CommandOrControl+Q',
				click: async () => {
					await stopAllServers();
					isQuitting = true; // Mark as quitting using local variable
					app.quit(); // Quit the application
				}
			}
		]);

		tray.setToolTip('Open WebUI');
		tray.setContextMenu(trayMenu);

		// Handle the close event
		mainWindow.on('close', (event) => {
			if (!isQuitting) { // Check local variable
				event.preventDefault(); // Prevent the default close behavior
				mainWindow.hide(); // Hide the window instead of closing it
			}
		});
	};

	ipcMain.handle('install', async (event) => {
		// console.log('Installing package...'); // REMOVED LOG
		if (USE_EXTERNAL_SERVER) {
			console.warn('Attempted to install package while USE_EXTERNAL_SERVER is true.');
			// Optionally send back an error or status update
			return; // Don't proceed with installation
		}

		try {
			const res = await installPackage();
			if (res) {
				mainWindow.webContents.send('main:data', {
					type: 'install:status',
					data: true
				});

				await startServerHandler();
			}
		} catch (error) {
			mainWindow.webContents.send('main:data', {
				type: 'install:status',
				data: false
			});
		}
	});

	ipcMain.handle('install:status', async (event) => {
		// console.log('[IPC] install:status'); // REMOVED LOG
		if (USE_EXTERNAL_SERVER) return true;
		return await validateInstallation();
	});

	ipcMain.handle('remove', async (event) => {
		// console.log('Resetting package...'); // REMOVED LOG
		removePackage();
	});

	ipcMain.handle('server:status', async (event) => {
		// console.log('[IPC] server:status'); // REMOVED LOG
		if (USE_EXTERNAL_SERVER) return 'started';
		return SERVER_STATUS;
	});

	ipcMain.handle('server:start', async (event) => {
		// console.log('Starting server...'); // REMOVED LOG

		await startServerHandler();
	});

	ipcMain.handle('server:stop', async (event) => {
		// console.log('Stopping server...'); // REMOVED LOG

		await stopAllServers();
		SERVER_STATUS = 'stopped';
		mainWindow.webContents.send('main:data', {
			type: 'server:status',
			data: SERVER_STATUS
		});
		updateTrayMenu('Open WebUI: Stopped', null); // Update tray menu with stopped status
	});

	ipcMain.handle('server:url', async (event) => {
		return SERVER_URL;
	});

	ipcMain.handle('renderer:data', async (event, { type, data }) => {
		// console.log('Received data from renderer:', type, data); // REMOVED LOG

		if (type === 'info') {
			return {
				platform: process.platform,
				version: app.getVersion()
			};
		}

		if (type === 'window:isFocused') {
			return {
				isFocused: mainWindow?.isFocused()
			};
		}

		// --- ADDED CHECK FOR 'app:data' ---
		// If the loaded page asks for 'app:data', return an empty object
		// to potentially prevent ReferenceError if the page expects something.
		if (type === 'app:data') {
			console.log('[IPC] Received request for app:data, returning empty object.');
			return {}; 
		}
		// --- END CHECK --- 

		return { type, data };
	});

	ipcMain.handle('notification', async (event, { title, body }) => {
		// console.log('Received notification:', title, body); // REMOVED LOG
		const notification = new Notification({
			title: title,
			body: body
		});
		notification.show();
	});

	app.on('before-quit', async () => {
		await stopAllServers();
		isQuitting = true; // Ensure quit flag is set using local variable
	});

	// Quit when all windows are closed, except on macOS
	app.on('window-all-closed', async () => {
		if (process.platform !== 'darwin') {
			await stopAllServers();
			isQuitting = true; // Set local variable
			app.quit();
		}
	});

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			onReady();
		} else {
			mainWindow?.show();
		}
	});

	app.on('ready', onReady);
}
