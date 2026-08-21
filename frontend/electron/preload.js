const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronBridge', {
  platform:         process.platform,
  closeWindow:      () => ipcRenderer.send('close-window'),
  minimizeWindow:   () => ipcRenderer.send('minimize-window'),
  maximizeWindow:   () => ipcRenderer.send('maximize-window'),
  openAdmin:        () => ipcRenderer.send('open-admin'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  isFullscreen:     () => ipcRenderer.invoke('is-fullscreen'),
})
