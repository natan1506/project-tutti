// Tira do macOS as cópias soltas do Tutti (build em release/, .dmg montado, Lixeira). Uso: npm run clean-apps
import { cleanStrayApps } from './lib/stray-apps.mjs'

cleanStrayApps()
console.log('Cópias soltas do Tutti removidas: fica só a de /Applications.')
