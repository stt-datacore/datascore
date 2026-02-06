#!/bin/bash
cd ../website
git checkout master
git pull --no-rebase
cd ../datascore
npm run precalculate
if [ "$1" == "--only-meta" || "$2" == "--only-meta" ]; then
    npm run shipcalc-fresh-meta
elif [ "$1" == "--only-cache" || "$2" == "--only-cache" ]; then
    npm run shipcalc-fresh-cache
else
    npm run shipcalc-fresh
fi
npm run calc
npm run eventstats
zip -X ./battle.zip ./battle_run_cache.json && mv ./battle.zip ../scripts/data
zip -X ./meta.zip ./battle_meta_cache.json && mv ./meta.zip ../scripts/data
if [ "$1" == "--nocommit" || "$2" == "--nocommit" ]; then
    exit 0;
fi
cd ../scripts
git add .
git commit . -m "battle run cache regeneration"
git push
cd ../website
git add .
git commit . -m "battle run cache regeneration"
git push
cd ../tal-shiar
./pubcrew.sh
cd ../datascore

