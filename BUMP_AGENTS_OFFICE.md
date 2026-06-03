# Release Process

Order matters — each step depends on the previous.

## 1. agents-office (main repo)

```bash
cd agents-office/

# Edit version in:
#   package.json                  ← npm publish version
#   daemon/src/main.ts            ← VERSION constant
#   scripts/install-server.sh     ← VERSION default
# then commit and tag:

git commit -am "bump to v0.X.XX"
git tag -a v0.X.XX -m "v0.X.XX — <description>"
git push && git push --tags
```

## 2. agents-office-site

```bash
cd ../agents-office-site/

# Edit index.html:
#   <span class="tag">v0.X.XX</span>
#   download URL …/releases/download/v0.X.XX/…

git commit -am "bump version to v0.X.XX"
git push
```

## 3. homebrew-agents-office

```bash
cd ../homebrew-agents-office/

# Edit Formula/agents-office.rb:
#   url "…/v0.X.XX.tar.gz"
#   sha256 "<run the command below>"

curl -sL https://github.com/lessch4os/agents-office/archive/refs/tags/v0.X.XX.tar.gz | sha256sum

git commit -am "bump version to v0.X.XX"
git push
```
