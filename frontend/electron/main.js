const { app, BrowserWindow, globalShortcut, Menu, ipcMain } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV !== 'production'

let launcherWindow = null
let mainWindow     = null
let adminWindow    = null
let cabin360Window = null

function loadPage(win, page) {
  if (isDev) {
    const url = page === 'index.html'
      ? 'http://localhost:5173'
      : `http://localhost:5173/${page}`
    win.loadURL(url)
  } else {
    win.loadFile(path.join(__dirname, '../dist', page))
  }
}

function anyCabinOpen() {
  return !!(mainWindow || adminWindow || cabin360Window)
}

function returnToLauncher() {
  if (launcherWindow) {
    launcherWindow.show()
    launcherWindow.focus()
  } else if (!anyCabinOpen()) {
    createLauncherWindow()
  }
}

function createLauncherWindow() {
  Menu.setApplicationMenu(null)

  if (launcherWindow) {
    launcherWindow.show()
    launcherWindow.focus()
    return
  }

  launcherWindow = new BrowserWindow({
    width:           920,
    height:          620,
    minWidth:        780,
    minHeight:       520,
    resizable:       true,
    maximizable:     false,
    fullscreenable:  false,
    frame:           false,
    backgroundColor: '#09090B',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  loadPage(launcherWindow, 'launcher.html')

  launcherWindow.on('closed', () => {
    launcherWindow = null
    if (!anyCabinOpen()) app.quit()
  })
}

function createWindow() {
  Menu.setApplicationMenu(null)

  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

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

  loadPage(mainWindow, 'index.html')

  mainWindow.on('focus', () => {
    globalShortcut.register('F11',    () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()) })
    globalShortcut.register('Escape', () => { if (mainWindow?.isFullScreen()) mainWindow.setFullScreen(false) })
  })
  mainWindow.on('blur',   () => { globalShortcut.unregister('F11'); globalShortcut.unregister('Escape') })
  mainWindow.on('closed', () => {
    mainWindow = null
    globalShortcut.unregister('F11')
    globalShortcut.unregister('Escape')
    returnToLauncher()
  })
}

function createCabin360Window() {
  Menu.setApplicationMenu(null)

  if (cabin360Window) {
    cabin360Window.show()
    cabin360Window.focus()
    return
  }

  cabin360Window = new BrowserWindow({
    width:           1180,
    height:          760,
    minWidth:        900,
    minHeight:       600,
    frame:           false,
    backgroundColor: '#09090B',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  loadPage(cabin360Window, 'cabin360.html')

  cabin360Window.on('closed', () => {
    cabin360Window = null
    returnToLauncher()
  })
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

  loadPage(adminWindow, 'admin.html')

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

  ipcMain.on('launch-photos', () => {
    createWindow()
    if (launcherWindow) launcherWindow.hide()
  })

  ipcMain.on('launch-360', () => {
    createCabin360Window()
    if (launcherWindow) launcherWindow.hide()
  })

  ipcMain.on('return-to-launcher', () => {
    if (adminWindow) {
      const w = adminWindow
      adminWindow = null
      w.close()
    }
    if (mainWindow) {
      mainWindow.close()
      return
    }
    if (cabin360Window) {
      cabin360Window.close()
      return
    }
    returnToLauncher()
  })

  createLauncherWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit',         () => globalShortcut.unregisterAll())
