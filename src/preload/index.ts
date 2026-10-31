import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RunEvent } from '@shared/events'
import type { TimeApi } from '@shared/models'

const api: TimeApi = {
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  openProject: path => ipcRenderer.invoke('openProject', path),
  initGit: path => ipcRenderer.invoke('initGit', path),
  recentProjects: () => ipcRenderer.invoke('recentProjects'),
  newConversation: (projectId, title) => ipcRenderer.invoke('newConversation', projectId, title),
  listConversations: projectId => ipcRenderer.invoke('listConversations', projectId),
  loadConversation: id => ipcRenderer.invoke('loadConversation', id),
  startRun: input => ipcRenderer.invoke('startRun', input),
  respondApproval: (id, allowed) => ipcRenderer.invoke('respondApproval', id, allowed),
  answerQuestion: (id, answer) => ipcRenderer.invoke('answerQuestion', id, answer),
  cancelRun: runId => ipcRenderer.invoke('cancelRun', runId),
  undo: (runId, paths) => ipcRenderer.invoke('undo', runId, paths),
  patch: (runId, path) => ipcRenderer.invoke('patch', runId, path),
  toolStatus: () => ipcRenderer.invoke('toolStatus'),
  onRunEvent: cb => {
    const listener = (_e: IpcRendererEvent, runId: string, ev: RunEvent) => cb(runId, ev)
    ipcRenderer.on('runEvent', listener)
    return () => { ipcRenderer.removeListener('runEvent', listener) }
  },
}

contextBridge.exposeInMainWorld('time', api)
