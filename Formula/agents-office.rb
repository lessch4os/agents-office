class AgentsOffice < Formula
  desc "Real-time office dashboard for AI coding agents"
  homepage "https://agents-office.lessch4os.com"
  url "https://github.com/lessch4os/agents-office/archive/refs/tags/v0.1.20.tar.gz"
  sha256 "9780a04f48c25264f3d408ecb72d389e1a2206d388a49537006268f161b27ed1"
  license "MIT"

  depends_on "bun" => :build

  def install
    system "bun", "install"
    system "bun", "run", "build:web"
    system "bun", "run", "--cwd", "daemon", "build:daemon"
    system "bun", "run", "--cwd", "daemon", "build:hook"
    system "bun", "run", "--cwd", "daemon", "build:forwarder"
    system "bun", "run", "--cwd", "daemon", "build:plugin"

    bin.install "daemon/agents-office"
    bin.install "daemon/agents-office-hook"
    bin.install "daemon/agents-office-forwarder"

    libexec.install "web/dist" => "web-dist"
    (share/"agents-office").install "daemon/dist/opencode-plugin.js"
  end

  service do
    run [opt_bin/"agents-office", "--port", "8080",
         "--web-root", opt_libexec/"web-dist"]
    keep_alive true
    run_type :immediate
    log_path var/"log/agents-office.log"
    error_log_path var/"log/agents-office-error.log"
  end

  def caveats
    <<~EOS
      To install Claude Code hooks, add to ~/.claude/settings.json:

        {
          "hooks": {
            "SessionStart": [{ "_agents_office": true, "hooks": [{ "command": "#{opt_bin}/agents-office-hook", "type": "command" }], "matcher": ".*" }],
            "SessionEnd":   [{ "_agents_office": true, "hooks": [{ "command": "#{opt_bin}/agents-office-hook", "type": "command" }], "matcher": ".*" }],
            "PreToolUse":   [{ "_agents_office": true, "hooks": [{ "command": "#{opt_bin}/agents-office-hook", "type": "command" }], "matcher": ".*" }],
            "PostToolUse":  [{ "_agents_office": true, "hooks": [{ "command": "#{opt_bin}/agents-office-hook", "type": "command" }], "matcher": ".*" }],
            "Notification": [{ "_agents_office": true, "hooks": [{ "command": "#{opt_bin}/agents-office-hook", "type": "command" }], "matcher": ".*" }]
          }
        }

      (Or run: npx @lessch4os/agents-office install-hooks -- uses npm version instead of brew)

      To install OpenCode plugin:
        mkdir -p ~/.config/opencode/plugins
        ln -sf #{opt_share}/agents-office/opencode-plugin.js \\
          ~/.config/opencode/plugins/agents-office.js

      Start the daemon manually:
        agents-office --port 8080

      Or start as a background service:
        brew services start agents-office

      Data directory: ~/.agents-office/
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/agents-office --version")
  end
end
