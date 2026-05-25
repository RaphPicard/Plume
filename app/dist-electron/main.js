import { BrowserWindow as e, app as t } from "electron";
import { fileURLToPath as n } from "url";
import r from "path";
//#region electron/main.js
var i = r.dirname(n(import.meta.url)), a = process.env.ELECTRON_ENTRY_PATH || "/admin", o = a.startsWith("/admin");
function s() {
	let t = new e({
		width: o ? 1440 : 1280,
		height: o ? 900 : 800,
		title: o ? "PLUME — Administration" : "PLUME — Gestion de flotte",
		webPreferences: {
			contextIsolation: !0,
			nodeIntegration: !1
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) {
		let e = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, "");
		t.loadURL(e + a);
	} else t.loadFile(r.join(i, "../dist/index.html")), a !== "/" && t.webContents.once("did-finish-load", () => {
		t.webContents.executeJavaScript(`window.__vue_router__?.push('${a}')`);
	});
}
t.whenReady().then(() => {
	s(), t.on("activate", () => {
		e.getAllWindows().length === 0 && s();
	});
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit();
});
//#endregion
