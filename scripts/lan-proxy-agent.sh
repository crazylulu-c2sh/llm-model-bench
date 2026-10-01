#!/usr/bin/env bash
#
# lan-proxy-agent.sh
# ------------------
# macOS LAN 송신 프록시(docker/lan-proxy/proxy.js)를 **Docker 없이** launchd 에이전트로 띄운다.
# 같은 proxy.js·같은 포트(127.0.0.1:3129)·같은 /__health 규약이라 ecosystem.config.cjs의
# 폴백 선택 로직이 그대로 집어 든다. Docker Desktop 상주(~1GB) 대신 node+osascript ~70MB.
#
# 왜 osascript로 감싸나 — 2026-10 macOS 27.0.1 실측(192.168.10.x LAN 호스트, 프록시 없음):
#   pm2 → node                           EHOSTUNREACH  (세션 분리 프로세스 게이트)
#   pm2 → osascript → node               EHOSTUNREACH  (책임 프로세스가 pm2에서 상속된다)
#   launchd 에이전트 → node              EHOSTUNREACH  (에이전트는 daemon 예외 대상 아님, TN3179)
#   launchd 에이전트 → osascript → node  OK
# launchd가 직접 띄운 osascript(Apple 플랫폼 바이너리)가 `do shell script` 자식의 책임 프로세스가
# 되어 로컬 네트워크 프라이버시 예외를 받는다. LaunchDaemon은 UserName(일반 사용자)이면 예외가
# 아니고(Apple DTS), root면 예외지만 sudo가 필요하고 프록시를 root로 돌리게 된다.
#
# 사용법:
#   scripts/lan-proxy-agent.sh install      # 설치·(재)기동. 저장소 proxy.js나 Node를 바꾼 뒤에도 다시 실행
#   scripts/lan-proxy-agent.sh status [URL] # URL을 주면 프록시 경유 LAN 왕복까지 확인
#   scripts/lan-proxy-agent.sh uninstall
#
# 환경 변수:
#   NODE_BIN  launchd가 실행할 node 절대 경로(기본: 현재 셸의 `command -v node`)
set -euo pipefail

LABEL="local.llm-model-bench.lan-proxy"
PORT=3129 # proxy.js 기본값·ecosystem.config.cjs FALLBACK_PROXY_PORT와 같아야 한다(여기선 확인용으로만 쓴다)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# proxy.js는 저장소를 직접 가리키지 않고 복사한다 — 워크트리 삭제·브랜치 전환에도 기동해야 한다.
APP_DIR="$HOME/Library/Application Support/llm-model-bench/lan-proxy"
LOG_DIR="$HOME/Library/Logs/llm-model-bench"
PROXY_LOG="$LOG_DIR/lan-proxy.log"            # proxy.js 의 한 줄 JSON 로그
AGENT_LOG="$LOG_DIR/lan-proxy.launchd.log"    # osascript 자신의 오류(자식 종료 사유 등)
DOMAIN="gui/$(id -u)"

die() { echo "[lan-proxy-agent] $*" >&2; exit 1; }
say() { echo "[lan-proxy-agent] $*"; }

# 셸 single-quote 인용
shq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
# AppleScript 문자열 리터럴
asq() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"; }
# plist XML 텍스트
xmlq() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

health() { curl -s --noproxy '*' -m 2 "http://127.0.0.1:$PORT/__health"; }
loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

cmd_install() {
  local node_bin="${NODE_BIN:-$(command -v node || true)}"
  [[ -n "$node_bin" && -x "$node_bin" ]] || die "node를 찾을 수 없습니다. NODE_BIN=/절대/경로/node 로 지정하십시오."
  # launchd는 셸 초기화 없이 빈 환경으로 실행한다 — 버전 매니저 shim이면 거기서 깨진다.
  env -i "$node_bin" -e 0 >/dev/null 2>&1 ||
    die "$node_bin 이 빈 환경에서 실행되지 않습니다(shim?). 실제 바이너리를 NODE_BIN 으로 지정하십시오."

  if loaded; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    # bootout은 비동기다 — 이전 인스턴스가 포트를 놓을 때까지 기다린다.
    for _ in $(seq 1 20); do health >/dev/null || break; sleep 0.25; done
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
    die "127.0.0.1:$PORT 를 다른 프로세스가 쓰고 있습니다. Docker 폴백이라면 먼저 내리십시오:
    docker compose --profile lan-proxy stop lan-proxy-fallback"
  fi

  mkdir -p "$APP_DIR" "$LOG_DIR" "$(dirname "$PLIST")"
  install -m 0644 "$REPO_ROOT/docker/lan-proxy/proxy.js" "$APP_DIR/proxy.js"

  # 출력은 반드시 파일로 보낸다 — do shell script는 자식의 stdout을 끝날 때까지 메모리에 모은다.
  local sh_cmd="exec $(shq "$node_bin") $(shq "$APP_DIR/proxy.js") >> $(shq "$PROXY_LOG") 2>&1"
  local applescript="do shell script $(asq "$sh_cmd")"

  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- scripts/lan-proxy-agent.sh 가 생성한다. 직접 고치지 말고 install 을 다시 실행할 것. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xmlq "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-e</string>
    <string>$(xmlq "$applescript")</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <!-- 미지정이면 launchd가 CPU·I/O를 가볍게 스로틀한다. 벤치 중 CPU 경합에서 프록시 지연이
       측정값에 섞이지 않도록 앱과 같은 등급으로 둔다. -->
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$(xmlq "$AGENT_LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xmlq "$AGENT_LOG")</string>
</dict>
</plist>
EOF
  plutil -lint "$PLIST" >/dev/null || die "생성한 plist가 올바르지 않습니다: $PLIST"

  launchctl bootstrap "$DOMAIN" "$PLIST" ||
    die "launchctl bootstrap 실패 — GUI 로그인 세션($DOMAIN)이 있어야 합니다(SSH 전용 세션에서는 안 됨)."

  local h=""
  for _ in $(seq 1 40); do h="$(health || true)"; [[ -n "$h" ]] && break; sleep 0.25; done
  if [[ -z "$h" ]]; then
    tail -n 5 "$AGENT_LOG" "$PROXY_LOG" >&2 2>/dev/null || true
    die "프록시가 127.0.0.1:$PORT 에서 응답하지 않습니다."
  fi
  say "기동됨: $h"
  say "node: $node_bin"
  say "로그: $PROXY_LOG"
  cat <<EOF

다음 단계:
  1) LAN 왕복 확인:  scripts/lan-proxy-agent.sh status http://<LAN호스트:포트>/v1/models
  2) pm2 서버가 이 프록시를 물도록 재선택 후 스냅숏 저장:
       pm2 reload ecosystem.config.cjs --update-env && pm2 save
     (이미 HTTP_PROXY=http://127.0.0.1:$PORT 로 떠 있었다면 재선택 없이도 이어서 동작한다)
EOF
}

cmd_status() {
  if loaded; then
    # 최상위 필드만(탭 하나) — 중첩 섹션에도 같은 이름이 있다.
    launchctl print "$DOMAIN/$LABEL" | grep -E $'^\t(state|pid|last exit code|runs) =' | sed $'s/^\t/  /'
  else
    say "에이전트가 로드되어 있지 않습니다($DOMAIN/$LABEL)."
  fi
  local h; h="$(health || true)"
  echo "  health = ${h:-응답 없음}"
  if [[ -n "$h" ]] && ! loaded; then
    echo "  주의: 위 응답은 이 에이전트가 아닌 다른 프로세스(Docker 폴백 등)의 것입니다."
  fi
  if [[ -f "$APP_DIR/proxy.js" ]] && ! cmp -s "$APP_DIR/proxy.js" "$REPO_ROOT/docker/lan-proxy/proxy.js"; then
    echo "  주의: 설치본 proxy.js가 저장소와 다릅니다 — install을 다시 실행하십시오."
  fi
  if [[ -n "${1:-}" ]]; then
    # 이 셸의 curl은 루프백(프록시)까지만 간다. LAN 연결은 에이전트가 맺으므로 게이트 통과 여부를 그대로 본다.
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -p -x "http://127.0.0.1:$PORT" "$1" || true)"
    echo "  프록시 경유 $1 → HTTP $code"
    echo "  health = $(health || echo '응답 없음')"
    [[ "$code" =~ ^[23] ]] || exit 1
  fi
}

cmd_uninstall() {
  if loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; fi
  rm -f "$PLIST"
  rm -rf "$APP_DIR"
  say "제거했습니다. 로그는 남겨 둡니다: $LOG_DIR"
  say "pm2 서버가 이 프록시를 물고 있었다면 LAN 호출이 실패합니다 — 다른 프록시를 띄우고"
  say "  pm2 reload ecosystem.config.cjs --update-env && pm2 save 로 재선택하십시오."
}

[[ "$(uname -s)" == "Darwin" ]] || die "macOS 전용입니다(다른 OS에는 로컬 네트워크 게이트가 없습니다)."
case "${1:-}" in
  install) cmd_install ;;
  status) shift; cmd_status "${1:-}" ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '3,/^set -euo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; exit 2 ;;
esac
