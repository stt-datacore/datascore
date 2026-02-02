#!/bin/bash
cd ../website
git checkout master
git pull --no-rebase
cd ../datascore
rm ./battle_run_cache.json
rm ./battle_meta_cache.json
unzip ../scripts/data/battle.zip
unzip ../scripts/data/meta.zip
npm run precalculate
npm run shipcalc
npm run calc
npm run eventstats
zip -X ./battle.zip ./battle_run_cache.json && mv ./battle.zip ../scripts/data
zip -X ./meta.zip ./battle_meta_cache.json && mv ./meta.zip ../scripts/data

if [ "$1" == "--sync" ]; then
    cd ../scripts
    git add .
    git commit . -m "Re-Calculation"
    git push
    cd ../website
    git add .
    git commit . -m "Re-Calculation"
    git push
    cd ../datascore
fi
