// Telegram over plain HTTP, on purpose: alerts must still go out when the chain socket is down.
export class Telegram {
  private offset = 0;
  constructor(private readonly token?: string, private readonly chatId?: string) {}

  get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  async send(text: string): Promise<void> {
    console.log(text);
    if (!this.enabled) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      console.error("telegram send failed:", (e as Error).name);
    }
  }

  /** New messages from the configured chat only; anyone else is ignored. */
  async inbox(): Promise<string[]> {
    if (!this.enabled) return [];
    try {
      const r = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=0`, { signal: AbortSignal.timeout(10_000) });
      const { result = [] } = (await r.json()) as { result?: any[] };
      const texts: string[] = [];
      for (const u of result) {
        this.offset = u.update_id + 1;
        if (String(u.message?.chat?.id) === String(this.chatId) && u.message?.text) texts.push(u.message.text);
      }
      return texts;
    } catch {
      return [];
    }
  }
}
