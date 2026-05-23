import { BrowserWindow, app } from "electron";
import { fileURLToPath } from "url";
import path from "path";
//#region electron/main.js
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ENTRY_PATH = process.env.ELECTRON_ENTRY_PATH || "/admin";
var IS_ADMIN = ENTRY_PATH.startsWith("/admin");
function createWindow() {
	const win = new BrowserWindow({
		width: IS_ADMIN ? 1440 : 1280,
		height: IS_ADMIN ? 900 : 800,
		title: IS_ADMIN ? "PLUME — Administration" : "PLUME — Gestion de flotte",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) {
		const base = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, "");
		win.loadURL(base + ENTRY_PATH);
	} else {
		win.loadFile(path.join(__dirname, "../dist/index.html"));
		if (ENTRY_PATH !== "/") win.webContents.once("did-finish-load", () => {
			win.webContents.executeJavaScript(`window.__vue_router__?.push('${ENTRY_PATH}')`);
		});
	}
}
app.whenReady().then(() => {
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
//#endregion
