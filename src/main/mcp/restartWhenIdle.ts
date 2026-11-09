// O servidor do opencode carrega os MCPs ao subir; mudou a lista, ele reinicia — mas nunca no meio de um pedido.

export class RestartWhenIdle {
  private active = 0
  private pending = false

  constructor(private restart: () => void) {}

  /** A lista de MCPs mudou: reinicia agora se nada roda, senão quando o último pedido acabar. */
  request(): void {
    this.pending = true
    this.flush()
  }

  /** Quantos pedidos estão rodando (onActivity do RunService). */
  activity(n: number): void {
    this.active = n
    this.flush()
  }

  private flush(): void {
    if (!this.pending || this.active > 0) return
    this.pending = false
    this.restart()
  }
}
