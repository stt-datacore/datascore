#!/bin/bash
npm run precalculate
npm run shipcalc-fresh
node build/datascore/scripts/scoring
zip ./battle.zip ./battle_run_cache.json && mv ./battle.zip ../scripts/data
cd ../scripts
git commit . -m "battle run cache regeneration"
git push
cd ../datascore