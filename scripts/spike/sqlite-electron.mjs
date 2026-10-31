// Spike: node:sqlite funciona dentro do Electron?
import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'

app.whenReady().then(() => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE t (v TEXT)')
  db.prepare('INSERT INTO t VALUES (?)').run('ok-sqlite')
  console.log('node', process.versions.node, 'electron', process.versions.electron, 'lido:', db.prepare('SELECT v FROM t').get().v)
  app.quit()
})
