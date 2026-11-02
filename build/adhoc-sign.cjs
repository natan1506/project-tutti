// Assinatura ad-hoc depois de empacotar (antes do .dmg): sem certificado de desenvolvedor, o Apple Silicon
// só roda binário com alguma assinatura. Não tira o aviso do Gatekeeper em outro Mac.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
