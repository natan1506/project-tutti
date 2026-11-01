import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RunEvent } from '@shared/events'
import type { Profile } from '@shared/profiles'
import type { TimeApi } from '@shared/models'
import type { UsageSnapshot } from '@shared/usage'

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
  startTeam: input => ipcRenderer.invoke('startTeam', input),
  respondPlan: (id, approved) => ipcRenderer.invoke('respondPlan', id, approved),
  respondLimit: (id, pass) => ipcRenderer.invoke('respondLimit', id, pass),
  answerQuestion: (id, answer) => ipcRenderer.invoke('answerQuestion', id, answer),
  cancelRun: runId => ipcRenderer.invoke('cancelRun', runId),
  undo: (runId, paths) => ipcRenderer.invoke('undo', runId, paths),
  patch: (runId, path) => ipcRenderer.invoke('patch', runId, path),
  toolStatus: () => ipcRenderer.invoke('toolStatus'),
  usageSnapshot: () => ipcRenderer.invoke('usageSnapshot'),
  usageDetail: conversationId => ipcRenderer.invoke('usageDetail', conversationId),
  profiles: () => ipcRenderer.invoke('profiles'),
  removedAgents: () => ipcRenderer.invoke('removedAgents'),
  saveProfile: p => ipcRenderer.invoke('saveProfile', p),
  deleteProfile: id => ipcRenderer.invoke('deleteProfile', id),
  duplicateProfile: (id, nome) => ipcRenderer.invoke('duplicateProfile', id, nome),
  activeProfile: projectId => ipcRenderer.invoke('activeProfile', projectId),
  setActiveProfile: (projectId, profileId) => ipcRenderer.invoke('setActiveProfile', projectId, profileId),
  onProfiles: cb => {
    const listener = (_e: IpcRendererEvent, ps: Profile[]) => cb(ps)
    ipcRenderer.on('profiles', listener)
    return () => { ipcRenderer.removeListener('profiles', listener) }
  },
  providerKeys: () => ipcRenderer.invoke('providerKeys'),
  providerModels: provider => ipcRenderer.invoke('providerModels', provider),
  agentStatus: projectId => ipcRenderer.invoke('agentStatus', projectId),
  setProviderKey: (provider, key) => ipcRenderer.invoke('setProviderKey', provider, key),
  removeProviderKey: provider => ipcRenderer.invoke('removeProviderKey', provider),
  usageSettings: () => ipcRenderer.invoke('usageSettings'),
  updateUsageSettings: s => ipcRenderer.invoke('updateUsageSettings', s),
  onUsage: cb => {
    const listener = (_e: IpcRendererEvent, s: UsageSnapshot) => cb(s)
    ipcRenderer.on('usage', listener)
    return () => { ipcRenderer.removeListener('usage', listener) }
  },
  onRunEvent: cb => {
    const listener = (_e: IpcRendererEvent, runId: string, ev: RunEvent) => cb(runId, ev)
    ipcRenderer.on('runEvent', listener)
    return () => { ipcRenderer.removeListener('runEvent', listener) }
  },
}

contextBridge.exposeInMainWorld('time', api)
