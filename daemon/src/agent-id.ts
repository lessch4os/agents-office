const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

let hashCounter = 0n;

export class AgentId {
  private constructor(public readonly value: bigint) {}

  static fromParts(source: string, opaqueId: string): AgentId {
    let hash = FNV_OFFSET;
    const sourceBytes = new TextEncoder().encode(source);
    for (const byte of sourceBytes) {
      hash ^= BigInt(byte);
      hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
    }
    hash ^= 0xffn;
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
    const opaqueBytes = new TextEncoder().encode(opaqueId);
    for (const byte of opaqueBytes) {
      hash ^= BigInt(byte);
      hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
    }
    return new AgentId(hash);
  }

  static fromTranscriptPath(path: string): AgentId {
    return AgentId.fromParts("claude-code", path);
  }

  static unique(source: string): AgentId {
    const id = AgentId.fromParts(source, `unique-${hashCounter++}-${Date.now()}`);
    return id;
  }

  toNumber(): number {
    return Number(this.value);
  }

  toString(): string {
    return this.value.toString(16).padStart(16, "0");
  }

  equals(other: AgentId): boolean {
    return this.value === other.value;
  }
}
