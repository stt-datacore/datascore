#!/bin/bash
rm ./battle_run_cache.json
unzip ../scripts/data/battle.zip
npm run precalculate
npm run shipcalc
node build/datascore/scripts/scoring
npm run eventstats
zip -X ./battle.zip ./battle_run_cache.json && mv ./battle.zip ../scripts/data
