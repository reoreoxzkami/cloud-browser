#!/bin/bash
set -e
echo "=================================================="
echo "🚀 GitHub リポジトリ作成＆プッシュ自動化スクリプト"
echo "=================================================="

# GitHub CLI の認証確認
if ! gh auth status &>/dev/null; then
  echo "🔑 GitHub アカウントにログインします..."
  gh auth login -w -p https
fi

echo "📦 GitHub 上に新しいリポジトリ 'cloud-browser' を作成してプッシュ中..."
gh repo create cloud-browser --public --source=. --remote=origin --push || {
  echo "⚠️ 既に同名リポジトリが存在する場合はプッシュのみ実行します..."
  git push -u origin main
}

echo "=================================================="
echo "🎉 GitHub へのプッシュが完了しました！"
echo "🌐 リポジトリURL: $(gh repo view --json url -q .url 2>/dev/null || echo 'https://github.com')"
echo "=================================================="
