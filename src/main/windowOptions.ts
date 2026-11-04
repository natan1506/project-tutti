import type { BrowserWindowConstructorOptions } from 'electron'

/** Posição dos botões fechar/minimizar/ampliar do macOS; o CSS reserva esse canto (`.rail`, `.head`). */
export const TRAFFIC_LIGHTS = { x: 14, y: 18 }

/** Janela sem a barra de título cinza: os botões do macOS ficam sobre o fundo do app, como nos apps atuais. */
export function windowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1280, height: 800, minWidth: 1200, minHeight: 640, backgroundColor: '#0c0b1f', title: 'Tutti',
    titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  }
}
