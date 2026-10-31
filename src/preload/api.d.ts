import type { TimeApi } from '../shared/models'

declare global {
  interface Window { time: TimeApi }
}
