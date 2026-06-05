import net from "net"

export class PluginClient {
  private socket: net.Socket | null = null

  connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(socketPath, () => resolve())
      this.socket.on("error", reject)
      this.socket.setTimeout(5000)
    })
  }

  send(event: Record<string, unknown>): void {
    if (!this.socket) throw new Error("not connected")
    this.socket.write(JSON.stringify(event) + "\n")
  }

  close(): void {
    this.socket?.end()
    this.socket?.destroy()
    this.socket = null
  }
}
