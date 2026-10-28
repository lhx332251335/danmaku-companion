#!/bin/bash
# usage: run-e2e.sh <app-dir> <tag> <seconds>
APP=$1; TAG=$2; SECS=${3:-100}
HERE=$(cd "$(dirname "$0")" && pwd)
UD=$HERE/ud-$TAG; rm -rf "$UD"; mkdir -p "$UD"
python3 $HERE/make-config.py "$UD/config.json" "$BASE_URL"
export DISPLAY=:98
Xvfb :98 -screen 0 1600x1000x24 >/dev/null 2>&1 & XPID=$!
sleep 1
node $HERE/slideshow.cjs > $HERE/slideshow-$TAG.log 2>&1 & SPID=$!
sleep 3
(cd "$APP" && NODE_USE_ENV_PROXY=1 /home/user/danmaku-companion/node_modules/electron/dist/electron --no-sandbox --disable-gpu --user-data-dir="$UD" dist-electron/electron/main/main.js > $HERE/app-$TAG.log 2>&1) & APID=$!
for t in 30 60 90; do if [ $t -le $SECS ]; then sleep 30; import -display :98 -window root $HERE/shot-$TAG-$t.png; fi; done
sleep $((SECS > 90 ? SECS - 90 : 0))
kill $APID $SPID 2>/dev/null; sleep 2; pkill -f "user-data-dir=$UD" 2>/dev/null; kill $SPID $XPID 2>/dev/null
pkill -f slideshow.cjs 2>/dev/null
echo done
