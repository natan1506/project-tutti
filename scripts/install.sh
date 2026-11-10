#!/bin/sh
# Instala só o Tutti no terminal (sem o app): baixa o pacote da última release para o seu Mac e cria o comando `tutti`.
#   curl -fsSL https://github.com/natan1506/project-tutti/releases/latest/download/install.sh | sh
# Precisa do Node.js 22.13 ou mais novo (o banco usa o node:sqlite). Quer o app com os mascotes? Baixe o .dmg da release:
# ele já vem com o `tutti`.
set -eu

REPO="natan1506/project-tutti"
DIR="$HOME/.local/share/tutti"
BIN="$HOME/.local/bin"

[ "$(uname -s)" = "Darwin" ] || { echo "O Tutti por enquanto só roda no macOS."; exit 1; }
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "Arquitetura não suportada: $(uname -m)"; exit 1 ;;
esac

command -v node >/dev/null 2>&1 || { echo "O Tutti precisa do Node.js 22.13 ou mais novo: https://nodejs.org (ou: brew install node)"; exit 1; }
NODE="$(node -p 'process.execPath')"
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Seu Node é o $("$NODE" -v); o Tutti precisa do 22.13 ou mais novo: https://nodejs.org"; exit 1; }

URL="${TUTTI_CLI_URL:-https://github.com/$REPO/releases/latest/download/tutti-cli-darwin-$ARCH.tar.gz}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Baixando o Tutti para o terminal ($ARCH)…"
curl -fsSL "$URL" -o "$TMP/tutti.tar.gz"
tar -xzf "$TMP/tutti.tar.gz" -C "$TMP"
[ -f "$TMP/tutti/out/main/cli.js" ] || { echo "O pacote baixado não parece ser do Tutti."; exit 1; }

mkdir -p "$(dirname "$DIR")" "$BIN"
rm -rf "$DIR"
mv "$TMP/tutti" "$DIR"
cat > "$BIN/tutti" <<EOF
#!/bin/sh
exec "$NODE" "$DIR/out/main/cli.js" "\$@"
EOF
chmod 755 "$BIN/tutti"

echo "Tutti instalado em $DIR. Abra um repositório e rode: tutti"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Para o comando funcionar em qualquer terminal, coloque ~/.local/bin no PATH:"
     echo '  echo '"'"'export PATH="$HOME/.local/bin:$PATH"'"'"' >> ~/.zshrc && source ~/.zshrc' ;;
esac
