#!/bin/bash
cd /app/website
git checkout master
git pull --no-rebase
cd /app/datascore
npm run precalculate
npm run shipcalc-fresh
node build/datascore/scripts/scoring
zip -X ./battle.zip ./battle_run_cache.json && mv ./battle.zip ../scripts/data
cd ../scripts
git commit . -m "battle run cache regeneration"
git push
cd ../website
git commit . -m "battle run cache regeneration"
git push
cd ../datascore

