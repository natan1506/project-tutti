import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RunEvent } from '@shared/events'
import type { Profile } from '@shared/profiles'
import type { TimeApi } from '@shared/models'
import type { UsageSnapshot } from '@shared/usage'

const api: TimeApi = {
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  openProject: path => ipcRenderer.invoke('openProject', path),
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
  autonomy: projectPath => ipcRenderer.invoke('autonomy', projectPath),
  setAutonomy: (projectPath, level) => ipcRenderer.invoke('setAutonomy', projectPath, level),
  stopAll: () => ipcRenderer.invoke('stopAll'),
  activity: () => ipcRenderer.invoke('activity'),
  onActivity: cb => {
    const listener = (_e: IpcRendererEvent, n: number) => cb(n)
    ipcRenderer.on('activity', listener)
    return () => { ipcRenderer.removeListener('activity', listener) }
  },
  skills: () => ipcRenderer.invoke('skills'),
  mcps: () => ipcRenderer.invoke('mcps'),
  saveMcp: input => ipcRenderer.invoke('saveMcp', input),
  removeMcp: id => ipcRenderer.invoke('removeMcp', id),
  setMcpTool: input => ipcRenderer.invoke('setMcpTool', input),
  setMcpEnabled: input => ipcRenderer.invoke('setMcpEnabled', input),
  mcpImportable: () => ipcRenderer.invoke('mcpImportable'),
  importMcp: nome => ipcRenderer.invoke('importMcp', nome),
  retestMcp: id => ipcRenderer.invoke('retestMcp', id),
  saveSkill: s => ipcRenderer.invoke('saveSkill', s),
  deleteSkill: id => ipcRenderer.invoke('deleteSkill', id),
  createSkill: i => ipcRenderer.invoke('createSkill', i),
  testSkill: i => ipcRenderer.invoke('testSkill', i),
  improveSkill: i => ipcRenderer.invoke('improveSkill', i),
  cancelSkill: draftId => ipcRenderer.invoke('cancelSkill', draftId),
  providerKeys: () => ipcRenderer.invoke('providerKeys'),
  providerModels: provider => ipcRenderer.invoke('providerModels', provider),
  agentStatus: projectId => ipcRenderer.invoke('agentStatus', projectId),
  browserState: () => ipcRenderer.invoke('browserState'),
  browserBounds: b => ipcRenderer.invoke('browserBounds', b),
  browserSelect: id => ipcRenderer.invoke('browserSelect', id),
  browserTakeover: id => ipcRenderer.invoke('browserTakeover', id),
  browserRelease: () => ipcRenderer.invoke('browserRelease'),
  browserNavigate: url => ipcRenderer.invoke('browserNavigate', url),
  browserBack: () => ipcRenderer.invoke('browserBack'),
  browserReload: () => ipcRenderer.invoke('browserReload'),
  browserClose: id => ipcRenderer.invoke('browserClose', id),
  browserReset: () => ipcRenderer.invoke('browserReset'),
  onBrowser: cb => {
    const h = (_e: IpcRendererEvent, s: import('@shared/browser').BrowserState) => cb(s)
    ipcRenderer.on('browser', h)
    return () => ipcRenderer.removeListener('browser', h)
  },
  looks: () => ipcRenderer.invoke('looks'),
  setLook: i => ipcRenderer.invoke('setLook', i),
  voiceStatus: () => ipcRenderer.invoke('voiceStatus'),
  voiceList: i => ipcRenderer.invoke('voiceList', i),
  voiceChoice: agentId => ipcRenderer.invoke('voiceChoice', agentId),
  setVoice: i => ipcRenderer.invoke('setVoice', i),
  synthesize: i => ipcRenderer.invoke('synthesize', i),
  setVoiceKey: key => ipcRenderer.invoke('setVoiceKey', key),
  removeVoiceKey: () => ipcRenderer.invoke('removeVoiceKey'),
  voiceMuted: () => ipcRenderer.invoke('voiceMuted'),
  setVoiceMuted: m => ipcRenderer.invoke('setVoiceMuted', m),
  setProviderKey: (provider, key) => ipcRenderer.invoke('setProviderKey', provider, key),
  removeProviderKey: provider => ipcRenderer.invoke('removeProviderKey', provider),
  updateInfo: () => ipcRenderer.invoke('updateInfo'),
  onUpdate: cb => {
    const listener = (_e: IpcRendererEvent, u: { version: string; url: string }) => cb(u)
    ipcRenderer.on('update', listener)
    return () => { ipcRenderer.removeListener('update', listener) }
  },
  openUpdate: () => ipcRenderer.invoke('openUpdate'),
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
