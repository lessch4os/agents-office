import { Config, Context, Layer, Option, Redacted } from "effect"

export interface AgentsOfficeConfigProps {
  port: number
  password: Redacted.Redacted<string> | undefined
  username: string
  socket: string
  maxDesks: number
  webRoot: string | undefined
  projectsRoot: string | undefined
  agBrainRoot: string | undefined
  opencodeSseUrl: string | undefined
  relayTo: string | undefined
  db: string
  verbose: boolean
  mode: "daemon" | "forwarder" | "setup" | "doctor" | "reload"
}

export class AgentsOfficeConfig extends Context.Tag("AgentsOfficeConfig")<
  AgentsOfficeConfig,
  AgentsOfficeConfigProps
>() {}

function defaultSocketPath(): string {
  const uid = process.getuid?.() ?? 0
  return `/tmp/agents-office-${uid}.sock`
}

function defaultDbPath(): string {
  const home = process.env.HOME ?? "/tmp"
  return `${home}/.agents-office/sessions.db`
}

function optionalString(name: string): Config.Config<string | undefined> {
  return Config.option(Config.string(name)).pipe(
    Config.map(Option.getOrUndefined),
  )
}

export const AgentsOfficeConfigLive = Layer.effect(
  AgentsOfficeConfig,
  Config.all({
    port: Config.integer("port").pipe(Config.withDefault(8080)),
    password: Config.option(Config.redacted("password")).pipe(
      Config.map(Option.getOrUndefined),
    ),
    username: Config.string("username").pipe(Config.withDefault("agents-office")),
    socket: Config.string("socket").pipe(Config.withDefault(defaultSocketPath())),
    maxDesks: Config.integer("max_desks").pipe(Config.withDefault(16)),
    webRoot: optionalString("web_root"),
    projectsRoot: optionalString("projects_root"),
    agBrainRoot: optionalString("ag_brain_root"),
    opencodeSseUrl: optionalString("opencode_sse_url"),
    relayTo: optionalString("relay_to"),
    db: Config.string("db").pipe(Config.withDefault(defaultDbPath())),
    verbose: Config.boolean("verbose").pipe(Config.withDefault(false)),
    mode: Config.string("mode").pipe(
      Config.map((s) => {
        if (s === "daemon" || s === "forwarder" || s === "setup" || s === "doctor" || s === "reload") return s
        return "daemon" as const
      }),
      Config.withDefault("daemon" as const),
    ),
  }),
)
