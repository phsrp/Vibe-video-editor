const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  importMedia: (kind) => ipcRenderer.invoke('media:import', kind),
  describeFiles: (files) => ipcRenderer.invoke('media:describe', files),
  saveProject: (file, json, defaultName) => ipcRenderer.invoke('project:save', { file, json, defaultName }),
  openProject: () => ipcRenderer.invoke('project:open'),
  autosave: (id, json) => ipcRenderer.invoke('project:autosave', { id, json }),
  listAutosaves: () => ipcRenderer.invoke('project:listAutosaves'),
  clearAutosave: (id) => ipcRenderer.invoke('project:clearAutosave', id),
  readProject: (file) => ipcRenderer.invoke('project:read', file),
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentAdd: (entry) => ipcRenderer.invoke('recent:add', entry),
  recentRemove: (file) => ipcRenderer.invoke('recent:remove', file),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  snoozeUpdate: () => ipcRenderer.invoke('update:snooze'),
  debugUpdate: (s) => ipcRenderer.invoke('update:debug', s),
  setDirty: (v) => ipcRenderer.invoke('app:setDirty', v),
  askSave: (name) => ipcRenderer.invoke('ui:askSave', name),
  isTest: () => ipcRenderer.invoke('app:isTest'),
  exportChooseOutput: (name, ext) => ipcRenderer.invoke('export:chooseOutput', name, ext),
  exportEncoders: () => ipcRenderer.invoke('export:encoders'),
  exportBegin: () => ipcRenderer.invoke('export:begin'),
  exportExtract: (o) => ipcRenderer.invoke('export:extract', o),
  exportSegBegin: (o) => ipcRenderer.invoke('export:segBegin', o),
  exportFrame: (buf) => ipcRenderer.invoke('export:frame', buf),
  exportSegEnd: () => ipcRenderer.invoke('export:segEnd'),
  exportFinal: (plan) => ipcRenderer.invoke('export:final', plan),
  exportCancel: () => ipcRenderer.invoke('export:cancel'),
  exportCleanup: () => ipcRenderer.invoke('export:cleanup'),
  exportReveal: (file) => ipcRenderer.invoke('export:reveal', file),
  onExportProgress: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('export:progress', h)
    return () => ipcRenderer.removeListener('export:progress', h)
  },
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => {
    const h = (_e, s) => cb(s)
    ipcRenderer.on('update:status', h)
    return () => ipcRenderer.removeListener('update:status', h)
  },
  audioPeaks: (file) => ipcRenderer.invoke('media:peaks', file),
  openProjectsFolder: () => ipcRenderer.invoke('projects:folder'),
  reverseProxy: (o) => ipcRenderer.invoke('media:reverse', o),
  measureLoudness: (o) => ipcRenderer.invoke('audio:loudness', o),
  modelsStatus: () => ipcRenderer.invoke('models:status'),
  modelsDownload: (set) => ipcRenderer.invoke('models:download', set),
  onModelsProgress: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('models:progress', h)
    return () => ipcRenderer.removeListener('models:progress', h)
  },
  historyAdd: (o) => ipcRenderer.invoke('history:add', o),
  historyList: (key) => ipcRenderer.invoke('history:list', key),
  historyRead: (o) => ipcRenderer.invoke('history:read', o),
  saveVoiceOver: (data) => ipcRenderer.invoke('voice:save', { data }),
  openVoiceFolder: () => ipcRenderer.invoke('voice:folder'),
  libraryFolder: () => ipcRenderer.invoke('library:folder'),
  libraryList: () => ipcRenderer.invoke('library:list'),
  libraryAdd: () => ipcRenderer.invoke('library:add'),
  libraryDelete: (file) => ipcRenderer.invoke('library:delete', file),
  extractAudio: (file, id, streams) => ipcRenderer.invoke('media:extractAudio', { file, id, streams }),
  freezeFrame: (file, time, label) => ipcRenderer.invoke('media:freeze', { file, time, label }),
  listTransitions: () => ipcRenderer.invoke('transitions:list'),
  openTransitionsFolder: () => ipcRenderer.invoke('transitions:openFolder'),
  pathForFile: (file) => webUtils.getPathForFile(file),
})
