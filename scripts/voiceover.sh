#!/usr/bin/env bash
# Usage: voiceover.sh "<caption text>" [image.jpg] [out_basename]
# Generates a voiceover with the local VoiceStudio API (starts it if needed).
# With an image, also muxes a vertical-friendly MP4 (image + voice) for IG/Threads/Fanvue.
set -euo pipefail
TEXT=${1:?caption text}; IMG=${2:-}; OUT=${3:-voiceover}
VS_DIR=${VS_DIR:-/home/user/debpalash/omnivoice-studio}
API=${VS_API:-http://localhost:3900}

if ! curl -sf "$API/health" >/dev/null; then
  (cd "$VS_DIR" && nohup bun run dev:api >/tmp/voicestudio-api.log 2>&1 &)
  for _ in $(seq 60); do curl -sf "$API/health" >/dev/null && break; sleep 3; done
fi

# strip hashtags so they are not read aloud
SPEECH=$(printf '%s' "$TEXT" | sed -E 's/#[[:alnum:]_]+//g' | tr -s ' \n' ' ')
curl -sf -m 550 -X POST "$API/v1/audio/speech" -H 'content-type: application/json' \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"input":sys.argv[1],"model":"omnivoice"}))' "$SPEECH")" \
  -o "$OUT.mp3"
echo "audio: $OUT.mp3"

if [ -n "$IMG" ]; then
  ffmpeg -y -loglevel error -loop 1 -i "$IMG" -i "$OUT.mp3" -c:v libx264 -tune stillimage \
    -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p" \
    -c:a aac -b:a 128k -shortest -movflags +faststart "$OUT.mp4"
  echo "video: $OUT.mp4"
fi
