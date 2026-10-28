import json, sys, datetime
now = datetime.datetime.utcnow().isoformat() + "Z"
cfg = {"version": 2, "activeProfileId": "e2e", "profiles": [{"id": "e2e", "name": "e2e", "createdAt": now, "updatedAt": now, "config": {
  "model": {"baseUrl": sys.argv[2], "model": "llama/qwen3.8-flash-next-nothink", "timeoutMs": 120000, "visionEnabled": True},
  "runtime": {"enabled": True, "intervalMinSeconds": 6, "intervalMaxSeconds": 8, "releaseWindowMinSeconds": 1, "releaseWindowMaxSeconds": 2,
              "historyRounds": 50, "historyMode": "reset-on-limit", "historyIncludeImages": True, "historyMaxImages": 4,
              "captureImageFormat": "jpeg", "captureMaxEdgePixels": 960, "requestBodyLimitMB": 48}}}]}
json.dump(cfg, open(sys.argv[1], "w"), indent=2)
