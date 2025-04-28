#!/bin/bash
cd /app/website
git checkout master
git pull --no-rebase
cd /app/datascore
npm run precalculate
npm run shipcalc-fresh
node build/datascore/scripts/scoring
npm run eventstats
zip -X ./battle.zip ./battle_run_cache.json && mv ./battle.zip ../scripts/data
if [ "$1" == "--nocommit" ]; then
    exit 0;
fi
cd ../scripts
git commit . -m "battle run cache regeneration"
git push
cd ../website
git commit . -m "battle run cache regeneration"
git push
cd ../datascore

