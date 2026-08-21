const { app, BrowserWindow, globalShortcut, Menu, ipcMain } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV !== 'production'

let mainWindow  = null
let adminWindow = null

function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width:           1280,
    height:          720,
    minWidth:        960,
    minHeight:       540,
    fullscreen:      false,
    frame:           false,
    backgroundColor: '#09090B',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('focus', () => {
    globalShortcut.register('F11',    () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()) })
    globalShortcut.register('Escape', () => { if (mainWindow?.isFullScreen()) mainWindow.setFullScreen(false) })
  })
  mainWindow.on('blur',   () => { globalShortcut.unregister('F11'); globalShortcut.unregister('Escape') })
  mainWindow.on('closed', () => { mainWindow = null; globalShortcut.unregister('F11'); globalShortcut.unregister('Escape') })
}

function createAdminWindow() {
  if (adminWindow) { adminWindow.focus(); return }

  adminWindow = new BrowserWindow({
    width:           1040,
    height:          680,
    minWidth:        800,
    minHeight:       520,
    resizable:       true,
    maximizable:     true,
    frame:           false,
    backgroundColor: '#09090B',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  if (isDev) {
    adminWindow.loadURL('http://localhost:5173/admin.html')
  } else {
    adminWindow.loadFile(path.join(__dirname, '../dist/admin.html'))
  }

  adminWindow.on('closed', () => { adminWindow = null })
}

app.whenReady().then(() => {
  ipcMain.on('close-window',       () => BrowserWindow.getFocusedWindow()?.close())
  ipcMain.on('minimize-window',    () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.on('maximize-window',    () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.isMaximized() ? w.unmaximize() : w.maximize() })
  ipcMain.on('open-admin',         () => createAdminWindow())
  ipcMain.on('toggle-fullscreen',  () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.setFullScreen(!win.isFullScreen())
  })
  ipcMain.handle('is-fullscreen', () => {
    return mainWindow ? mainWindow.isFullScreen() : false
  })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
app.on('will-quit',         () => globalShortcut.unregisterAll())
