#!/usr/bin/env bash
#
# fix-nemotron-lmstudio-template.sh
# ---------------------------------
# Patch the nvidia/nemotron-3-nano* LM Studio Jinja prompt-template bug:
#
#   Error rendering prompt with jinja template:
#   "Cannot apply filter "string" to type: UndefinedValue"
#
# The model's chat template applies `| string` / `| trim` to message.content (or
# derived `content`, or tool extra-keys) that can be null/undefined. It crashes
# on the Anthropic /v1/messages + tools path (e.g. llm-model-bench's
# `tool_weather` / `translate_nist_fips197_pdf_tools` scenarios) while the OpenAI
# /v1/chat/completions path renders fine. Fix = insert `| default('', true)`
# before those filters / at the content assignment + concat sites.
#
# Per model, this script:
#   1. Locates ~/.lmstudio/.internal/user-concrete-model-default-config/<id>.json
#   2. Gets the model's CURRENT jinja chat template:
#        - reuse an existing llm.prediction.promptTemplate override (version-safe), OR
#        - extract tokenizer.chat_template from the model's GGUF (needs python 'gguf')
#   3. Applies a UNION of idempotent null-guard patches (NOT a blanket `| string`
#      replace, which would corrupt boolean/number tool-call arguments such as
#      enabled=false -> ""), prints per-rule counts + a diff, and HARD-STOPS if it
#      detects a multimodal/list-content template (the "omni" variant) unless --force.
#   4. Writes it back as a llm.prediction.promptTemplate override in operation.fields.
#   5. Backs up the config first. Supports --dry-run.
#
# Then UNLOAD + RELOAD the model in LM Studio (config is read at load time).
#
# NOTE: a sibling crash on the same render path — `tool_call.arguments | items` /
# `args_value | string` when arguments arrive as a JSON *string* (HF discussion
# #52) — is SEPARATE and intentionally NOT handled here. If tool calls still fail
# after this fix, that's the place to look. This script deliberately leaves
# `args_value | string` untouched so falsy argument values (false/0) are preserved.
#
# >>> Run this ON THE HOST RUNNING LM STUDIO (e.g. the Spark box), not in the repo. <<<
#
# Usage:
#   ./fix-nemotron-lmstudio-template.sh                 # default models, apply
#   ./fix-nemotron-lmstudio-template.sh --dry-run       # show changes, write nothing
#   ./fix-nemotron-lmstudio-template.sh --force         # proceed even on multimodal template
#   ./fix-nemotron-lmstudio-template.sh nvidia/nemotron-3-nano-4b   # specific model(s)
#
# Flags:
#   --dry-run         compute + print the diff, do not modify any file
#   --force           patch even if a multimodal/list-content template is detected
#   --legacy-schema   write the older jinjaPromptTemplate superset
#                     (bosToken/eosToken/inputConfig) for LM Studio builds ~2025
#                     that require it; default writes the minimal {template} shape.
# Env overrides:
#   LMS_HOME   (default: ~/.lmstudio)
#   BASE       (default: http://localhost:1234)   # only used in the verify hint
#
set -euo pipefail

LMS_HOME="${LMS_HOME:-$HOME/.lmstudio}"
BASE="${BASE:-http://localhost:1234}"
CFG_DIR="$LMS_HOME/.internal/user-concrete-model-default-config"
MODELS_DIR="$LMS_HOME/models"
KEY="llm.prediction.promptTemplate"
DRY_RUN=0; FORCE=0; LEGACY=0

DEFAULT_MODELS=(
  "nvidia/nemotron-3-nano-omni"
  "nvidia/nemotron-3-nano-4b"
)

# ---- arg parsing -----------------------------------------------------------
MODELS=()
for a in "$@"; do
  case "$a" in
    --dry-run)       DRY_RUN=1 ;;
    --force)         FORCE=1 ;;
    --legacy-schema) LEGACY=1 ;;
    -h|--help)       sed -n '2,60p' "$0"; exit 0 ;;
    -*)              echo "unknown flag: $a" >&2; exit 2 ;;
    *)               MODELS+=("$a") ;;
  esac
done
[ ${#MODELS[@]} -eq 0 ] && MODELS=("${DEFAULT_MODELS[@]}")

# ---- deps ------------------------------------------------------------------
command -v jq      >/dev/null || { echo "ERROR: 'jq' is required (apt install jq)." >&2; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: 'python3' is required." >&2; exit 1; }

ensure_gguf_pkg() {
  python3 -c 'import gguf' 2>/dev/null && return 0
  echo "  python 'gguf' package not found — installing (pip install --user gguf)…" >&2
  python3 -m pip install --user -q gguf >&2 || {
    echo "  ERROR: could not install 'gguf'. Install it, or seed the override via the" >&2
    echo "         LM Studio UI first (Advanced Configuration > Prompt Template), re-run." >&2
    return 1
  }
}

# ---- single cleanup trap (RETURN traps in a loop body never fire) -----------
tmpl=""; out=""
cleanup() { [ -n "$tmpl" ] && rm -f "$tmpl"; [ -n "$out" ] && rm -f "$out"; }
trap cleanup EXIT

# ---- the patcher: union of idempotent null-safe rules ----------------------
# Exit: 0 patched OK · 10 zero replacements · 11 multimodal + no --force.
patch_template() { # $1 = template file (patched in place) · $2 = force(0/1)
  python3 - "$1" "${2:-0}" <<'PY'
import re, sys, difflib
path = sys.argv[1]
force = len(sys.argv) > 2 and sys.argv[2] == "1"
orig = open(path, encoding="utf-8").read()
s = orig

# (label, pattern, replacement). All idempotent: a second pass yields 0.
# Lookarounds keep the rules mutually non-conflicting and avoid touching
# `args_value | string` (tool-call args — must keep falsy values like 0/false).
rules = [
    # --- "kerinzeebart/omarkamali"-style templates ---
    ("X.content | string",          r"message\.content\s*\|\s*string\b",
                                    "message.content | default('', true) | string"),
    ("json_dict[json_key] | string", r"json_dict\[json_key\]\s*\|\s*string\b",
                                    "json_dict[json_key] | default('', true) | string"),
    ("{{ message.content }} output", r"\{\{(-?)\s*message\.content\s*(-?)\}\}",
                                    r"{{\1 message.content | default('', true) \2}}"),
    # --- raw GGUF set/concat-style templates ---
    ("set content = message.content", r"(set\s+content\s*=\s*message\.content)(?!\s*\|)",
                                    r"\1 | default('', true)"),
    ("~ message.content",           r"~\s*message\.content\b(?!\s*\|)",
                                    "~ (message.content | default('', true))"),
    ("content | string (derived)",  r"(?<![.\w])content\s*\|\s*string\b",
                                    "content | default('', true) | string"),
    ("content | trim (derived)",    r"(?<![.\w])content\s*\|\s*trim\b",
                                    "content | default('', true) | trim"),
    # --- fallback non-standard-role branch (whitespace-preserving) ---
    ("+ message.content + concat",  r"\+(\s*)message\.content(\s*)\+",
                                    r"+\1(message.content | default('', true))\2+"),
]

total = 0
for label, pat, repl in rules:
    s, n = re.subn(pat, repl, s)
    total += n
    sys.stderr.write(f"    [patch] {label:<32} {n}\n")
sys.stderr.write(f"    [patch] total replacements: {total}\n")

# Multimodal/list content detection (the "omni" variant): | string on a list
# of content parts is the wrong fix, so refuse without an explicit --force.
MM = [
    r"for\s+\w+\s+in\s+message\.content",
    r"message\.content\s+is\s+(sequence|iterable)",
    r"message\.content\s+is\s+not\s+string",
    r"message\.content\[",
    r"\.type\s*==\s*['\"](text|image|image_url|input_audio|audio)['\"]",
    r"\bpart\.(type|text|image|content)\b",
]
multimodal = any(re.search(p, orig) for p in MM)

if total:
    sys.stderr.write("    [patch] diff (changed lines):\n")
    for line in difflib.unified_diff(orig.splitlines(), s.splitlines(),
                                     "original", "patched", n=0, lineterm=""):
        if line[:1] in "+-" and not line.startswith(("+++", "---")):
            sys.stderr.write("      " + line + "\n")

open(path, "w", encoding="utf-8").write(s)   # write patched (== orig if total==0)

if multimodal:
    sys.stderr.write("    [patch] *** MULTIMODAL/LIST-CONTENT TEMPLATE DETECTED ***\n")
    sys.stderr.write("    [patch] message.content may be a list of parts; `| string` guards\n")
    sys.stderr.write("    [patch] may be insufficient. REVIEW the diff above, then re-run with --force.\n")
if total == 0:
    sys.stderr.write("    [patch] WARNING: 0 replacements — template shape is unrecognized or\n")
    sys.stderr.write("    [patch] already patched; nothing written. Inspect it manually.\n")
    sys.exit(10)
if multimodal and not force:
    sys.exit(11)
sys.exit(0)
PY
}

extract_from_gguf() { # $1 = gguf path -> raw template on stdout
  python3 - "$1" <<'PY'
import sys
from gguf import GGUFReader
r = GGUFReader(sys.argv[1])
f = r.fields.get("tokenizer.chat_template")
if f is None:
    sys.stderr.write("    no tokenizer.chat_template metadata in GGUF\n"); sys.exit(3)
sys.stdout.write(bytes(f.parts[f.data[0]]).decode("utf-8"))
PY
}

read_existing_template() { # $1 = config json -> template on stdout (empty if none)
  jq -r --arg k "$KEY" '
    .operation.fields[]? | select(.key == $k)
    | .value.jinjaPromptTemplate.template // empty
  ' "$1"
}

# echoes a single gguf path. return: 0 ok · 1 none · 2 ambiguous (lists to stderr)
find_gguf() { # $1 = model basename
  [ -d "$MODELS_DIR" ] || return 1
  local name="$1" all dirs f
  mapfile -t all < <(find "$MODELS_DIR" -type f -iname '*.gguf' 2>/dev/null \
      | grep -ivE '(mmproj|projector|mproj|vision|clip|encoder|audio)' \
      | grep -iF "$name" | sort)
  [ ${#all[@]} -eq 0 ] && return 1
  mapfile -t dirs < <(printf '%s\n' "${all[@]}" | while read -r f; do dirname "$f"; done | sort -u)
  if [ ${#dirs[@]} -gt 1 ]; then
    { echo "    ambiguous GGUF match across multiple model dirs — specify the model explicitly:";
      printf '      %s\n' "${dirs[@]}"; } >&2
    return 2
  fi
  for f in "${all[@]}"; do [[ "$f" == *-00001-of-* ]] && { echo "$f"; return 0; }; done
  echo "${all[0]}"; return 0
}

# write the patched template into the config (in place if a field exists, else append)
write_override() { # $1=config  $2=tmpl_file  $3=mode(inplace|inject)
  local config="$1" tf="$2" mode="$3"
  out="$(mktemp)"
  if [ "$mode" = "inplace" ]; then
    # Swap ONLY the template string; preserve LM Studio's own wrapper exactly
    # (whatever schema this version uses) -> version-proof.
    jq --rawfile t "$tf" --arg k "$KEY" '
      .operation.fields |= map(
        if .key == $k then .value.jinjaPromptTemplate.template = $t else . end
      )' "$config" > "$out"
  elif [ "$LEGACY" = "1" ]; then
    # Older LM Studio (~2025) required bosToken/eosToken/inputConfig in jinjaPromptTemplate.
    jq --rawfile t "$tf" --arg k "$KEY" '
      .operation = (.operation // {}) |
      .operation.fields = (
        ((.operation.fields // []) | map(select(.key != $k))) + [{
          key: $k,
          value: { type: "jinja",
            jinjaPromptTemplate: { bosToken: "", eosToken: "", template: $t,
              inputConfig: { messagesConfig: { contentConfig: { type: "string" } }, useTools: true } },
            stopStrings: [] }
        }])' "$config" > "$out"
  else
    # Modern minimal verified shape: jinjaPromptTemplate = { template } only.
    jq --rawfile t "$tf" --arg k "$KEY" '
      .operation = (.operation // {}) |
      .operation.fields = (
        ((.operation.fields // []) | map(select(.key != $k))) + [{
          key: $k,
          value: { type: "jinja", jinjaPromptTemplate: { template: $t }, stopStrings: [] }
        }])' "$config" > "$out"
  fi
  jq -e . "$out" >/dev/null || { echo "    ERROR: produced invalid JSON, aborting this model." >&2; return 1; }
  if [ "$DRY_RUN" = "1" ]; then
    echo "    [dry-run] would write override ($mode${LEGACY:+, legacy-schema}) to: $config" >&2
  else
    chmod --reference="$config" "$out" 2>/dev/null || true
    mv "$out" "$config"; out=""
    echo "    wrote override ($mode) -> $config" >&2
  fi
}

# ---- main ------------------------------------------------------------------
echo "LM Studio home: $LMS_HOME"
echo "Config dir:     $CFG_DIR"
[ "$DRY_RUN" = "1" ] && echo "MODE: DRY RUN (no files changed)"
[ "$FORCE"   = "1" ] && echo "MODE: --force (multimodal hard-stop disabled)"
echo

rc=0
for model in "${MODELS[@]}"; do
  echo "== $model =="
  name="${model##*/}"
  config="$CFG_DIR/$model.json"
  echo "  config: $config"

  if [ ! -f "$config" ]; then
    echo "  SKIP: no config file there. Open the model once in LM Studio so its per-model" >&2
    echo "        config exists, or check the exact id under $CFG_DIR/" >&2
    rc=1; echo; continue
  fi

  tmpl="$(mktemp)"
  mode=""
  existing="$(read_existing_template "$config" || true)"
  if [ -n "$existing" ]; then
    mode="inplace"
    read_existing_template "$config" > "$tmpl"          # byte-faithful (no $() newline strip)
    echo "  template source: existing $KEY override (in-place patch — version-proof)"
  else
    mode="inject"
    set +e; gguf="$(find_gguf "$name")"; fc=$?; set -e
    case $fc in
      1) echo "  SKIP: no existing override and no GGUF found under $MODELS_DIR matching '*$name*'." >&2
         echo "        Seed the override via the LM Studio UI, then re-run." >&2
         rm -f "$tmpl"; tmpl=""; rc=1; echo; continue ;;
      2) rm -f "$tmpl"; tmpl=""; rc=1; echo; continue ;;
    esac
    echo "  template source: GGUF $gguf"
    if ! ensure_gguf_pkg; then rm -f "$tmpl"; tmpl=""; rc=1; echo; continue; fi
    if ! extract_from_gguf "$gguf" > "$tmpl"; then
      echo "  SKIP: could not read tokenizer.chat_template from GGUF." >&2
      rm -f "$tmpl"; tmpl=""; rc=1; echo; continue
    fi
  fi

  echo "  patching ($(wc -c < "$tmpl") bytes):"
  set +e; patch_template "$tmpl" "$FORCE"; pcode=$?; set -e
  case $pcode in
    0) : ;;
    10) echo "  SKIP: nothing to patch (see warning above)." >&2; rm -f "$tmpl"; tmpl=""; rc=1; echo; continue ;;
    11) echo "  SKIP: multimodal template — review the diff above, then re-run with --force." >&2
        rm -f "$tmpl"; tmpl=""; rc=1; echo; continue ;;
    *)  echo "  SKIP: patcher error ($pcode)." >&2; rm -f "$tmpl"; tmpl=""; rc=1; echo; continue ;;
  esac

  if [ "$DRY_RUN" != "1" ]; then
    bak="$config.bak.$(date +%Y%m%d-%H%M%S)"
    cp -p "$config" "$bak"
    echo "  backup: $bak"
  fi

  write_override "$config" "$tmpl" "$mode" || rc=1
  rm -f "$tmpl"; tmpl=""
  echo
done

echo "Done. Next steps:"
echo "  1) In LM Studio, UNLOAD then RELOAD each patched model (config is read at load)."
echo "  2) Verify the Anthropic + tools path no longer errors. Fresh turn:"
echo "       curl -sS $BASE/v1/messages -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' -d '{\"model\":\"${MODELS[0]}\",\"max_tokens\":64,\"stream\":false,\"system\":\"You are a tool-using assistant.\",\"messages\":[{\"role\":\"user\",\"content\":\"Weather in Seattle? Use the tool.\"}],\"tools\":[{\"name\":\"get_weather\",\"description\":\"Get weather for a city\",\"input_schema\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}]}'"
echo "     And the tool-result feedback turn (the null-content path this fix targets):"
echo "       curl -sS $BASE/v1/messages -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' -d '{\"model\":\"${MODELS[0]}\",\"max_tokens\":64,\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"Weather in Seattle? Use the tool.\"},{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"get_weather\",\"input\":{\"city\":\"Seattle\"}}]},{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"t1\",\"content\":\"72F sunny\"}]}],\"tools\":[{\"name\":\"get_weather\",\"description\":\"Get weather for a city\",\"input_schema\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}]}'"
echo "     A 200 with a normal response (no \"Cannot apply filter\") = fixed."
echo "  3) Re-run the bench: the 'messages' rows for the tool scenarios should pass."
echo
echo "Recovery: backups are at <config>.bak.<timestamp>; cp one back + reload to revert."
echo "If LM Studio rejects the injected override (schema mismatch), open the model in"
echo "LM Studio > Advanced Configuration > Prompt Template (Jinja), save once to create the"
echo "field, then re-run — it will patch that field in place (version-proof)."

exit $rc
