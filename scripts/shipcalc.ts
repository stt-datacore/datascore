import fs from 'fs';
import { Worker } from 'node:worker_threads';
import os from 'os';

import { exit } from 'process';
import CONFIG from '../../website/src/components/CONFIG';
import { BossShip } from '../../website/src/model/boss';
import { CrewMember, RankScoring, ShipScores } from "../../website/src/model/crew";
import { AllBuffsCapHash } from '../../website/src/model/player';
import { Schematics, Ship } from "../../website/src/model/ship";
import { AllBosses, getBosses, getShipDivision } from "../../website/src/utils/shiputils";
import ship_buff_ref from './ship_buff_ref.json';
import { runBattles } from './ships/battle';
import { battleRunsToCache, cacheToBattleRuns, readBattleCache, readMetaCache, writeMetaCache } from './ships/cache';
import { CalcRes, MetaCache, MetaCacheEntry, ShipCalcConfig, ShipCalcMeta } from './ships/paracalc';
import { processShips } from './ships/processing';
import { BattleRunBase, Score, ScoreDataConfig, actualPower, characterizeCrew, createBlankShipScore, createScoreData, getStaffedShip, processScores, rankBosses, scoreToShipScore, shipnum } from './ships/scoring';
import { createMulitpleShips } from './ships/seating';
import { makeBuckets } from './ships/util';
import { LineUpMeta, BuiltInMetas } from '../../website/src/model/worker';

const STATIC_PATH = `${__dirname}/../../../../website/static/structured/`;
const LEVEL_PATH = `${__dirname}/../../../../scripts/data/`;

async function processCrewShipStats(rate = 10, arena_variance = 0, fbb_variance = 0) {
    const Triggers = {
        0: 'None',
        1: 'Position',
        2: 'Cloak',
        4: 'Boarding',
    }
    const printTrigger = (c: CrewMember) => {
        if (!c.action.ability?.condition && !c.action.limit) return '';
        else if (c.action.ability?.condition && c.action.limit) {
            return ` (${Triggers[c.action.ability.condition]}, ${c.action.limit})`;
        }
        else if (c.action.ability?.condition) {
            return ` (${Triggers[c.action.ability.condition]})`;
        }
        else if (c.action?.limit) {
            return ` (${c.action.limit})`;
        }
        return "";
    }

    const runStart = new Date();

    const all_ships = JSON.parse(fs.readFileSync(STATIC_PATH + 'all_ships.json', 'utf-8')) as Ship[];
    const ship_schematics = JSON.parse(fs.readFileSync(STATIC_PATH + 'ship_schematics.json', 'utf-8')) as Schematics[];
    const ship_levels = JSON.parse(fs.readFileSync(LEVEL_PATH + 'ship_levels.json', 'utf-8')) as any[];
    const conslevel = ship_levels.find(f => f.symbol === 'constellation_ship');
    const constellation = {
        symbol: 'constellation_ship',
        rarity: 1,
        max_level: 5,
        level: 5,
        antimatter: 1250,
        name: 'Constellation Class',
        icon: { file: '/ship_previews_fed_constellationclass' },
        traits: ['federation','explorer'],
        battle_stations: [
            {
                skill: 'command_skill'
            },
            {
                skill: 'diplomacy_skill'
            }
        ],
        owned: false,
        levels: conslevel.levels
    } as Ship;

    ship_schematics.push({
        ship: constellation,
        rarity: constellation.rarity,
        cost: 0,
        id: 1,
        icon: constellation.icon!
    });

    const crew = JSON.parse(fs.readFileSync(STATIC_PATH + 'crew.json', 'utf-8')) as CrewMember[];

    const VERBOSE = process.argv.includes("--verbose") || process.argv.includes("-v");
    console.log("DataScore Ship Scoring\n");
    let newcrew = [] as CrewMember[];
    let newships = [] as Ship[];
    CONFIG
    // const boompool = crew.filter(f => f.action.ability?.type === 1 && !f.action.limit && !f.action.ability?.condition).sort((a, b) => b.action.ability!.amount - a.action.ability!.amount || a.action.bonus_type - b.action.bonus_type || b.action.bonus_amount - a.action.bonus_amount || a.action.cycle_time - b.action.cycle_time);
    // const critpool = crew.filter(f => f.action.ability?.type === 5 && !f.action.limit && !f.action.ability?.condition).sort((a, b) => b.action.ability!.amount - a.action.ability!.amount || a.action.bonus_type - b.action.bonus_type || b.action.bonus_amount - a.action.bonus_amount || a.action.cycle_time - b.action.cycle_time);
    const hrpool = crew.filter(f =>
        (f.action.ability?.type === 2 || (f.action.bonus_type === 1 && (!!f.action.ability && [0,2,3,6].includes(f.action.ability.type)))) && (!f.action.limit))
            .sort((a, b) => actualPower(b.action) - actualPower(a.action) || a.action.bonus_type - b.action.bonus_type || b.action.bonus_amount - a.action.bonus_amount || b.action.duration - a.action.duration || a.action.cycle_time - b.action.cycle_time);

    const crewcategories = {} as { [key: string]: 'defense' | 'offense' }
    const crewcooldowns = {} as { [cooldown: string]: string[] }

    crew.forEach((c) => {
        crewcategories[c.symbol] = characterizeCrew(c) < 0 ? 'defense' : 'offense';
        crewcooldowns[c.action.initial_cooldown] ??= [];
        crewcooldowns[c.action.initial_cooldown].push(c.symbol);
    });

    const typical_cd = (() => {
        let typicalcd = 0;
        let symlen = 0;
        for (let [cooldown, symbols] of Object.entries(crewcooldowns)) {
            let n = Number(cooldown);
            if (!symlen || symlen < symbols.length) {
                symlen = symbols.length;
                typicalcd = n;
            }
        }
        return typicalcd;
    })();

    const allBuffs = ship_buff_ref as AllBuffsCapHash;

    const shipBuffs = {} as {[key:string]:number};

    Object.entries(allBuffs).forEach(([buff, value]) => {
        if (!buff.startsWith("ship_")) return;
        let [name, type] = buff.split(",");
        name = name.slice(5);
        shipBuffs[name] = value;
    });
    console.log("Detected Ship Buffs:");
    console.log(shipBuffs);
    const iterBuff = Object.entries(shipBuffs);
    const ships = all_ships.map((ship) => {
        for (let [field, buff] of iterBuff) {
            if (ship[field] && buff) {
                ship[field] *= (1 + buff);
            }
        }
        return ship;
    });
    // const ships = mergeShips(ship_schematics.filter(sc => {
    //     if (highestLevel(sc.ship) == (sc.ship.max_level ?? sc.ship.level) + 1 && (sc.ship.battle_stations?.length)) return true;
    //     return false;
    // }), [], true);

    ships.sort((a, b) => shipnum(b) - shipnum(a));

    const origShips = JSON.parse(JSON.stringify(ships)) as Ship[];

    // ************************
    // *** Battle Run Cache ***

    const cacheFile = "./battle_run_cache.json";
    let cached = readBattleCache(cacheFile, process.argv.includes("--fresh") || process.argv.includes("--fresh-cache"))

    if (cached?.length) {
        console.log("Checking integrity...");
        let corrupt = false;

        cached.forEach((cc) => {
            if (!cc.crew && !cc.reference_battle) {
                if (cc.seated?.length) {
                    cc.crew = cc.seated[0];
                }
            }
        });
        let shipsym = origShips.map(o => o.symbol);
        let crewsym = crew.map(c => c.symbol);
        // Purge yanked entries:
        cached = cached.filter(c => shipsym.includes(c.ship)
            && (!!c.crew || !!c.seated?.length || !!c.reference_battle)
            && (!c.crew || crew.some(cc => cc.symbol === c.crew))
            && (!c.seated?.length || c.seated.every(seat => crewsym.includes(seat)))
        );

        // If anything else is weird after that, we're going to uncorrupt it.
        corrupt = cached.some(c => !c.ship || (!c.crew && !c.reference_battle));

        if (corrupt) {
            cached = [];
            console.log("Corrupted entries found. Doing full recomputation.");
        }
        else {
            console.log("Checking for new crew...");
            let c_crew = [ ... new Set(cached.map(m => m.crew)) ];
            let g_crew = crew.map(m => m.symbol);

            g_crew = g_crew.filter((c, i) => g_crew.findIndex(cc => cc === c) === i && !c_crew.includes(c));

            if (g_crew.length) {
                newcrew = g_crew.map(s => crew.find(c => c.symbol === s)!);
                if (newcrew.length) {
                    console.log(`Updating cache with ${newcrew.length} new crew...`);
                }
            }
            console.log("Checking for new ships...");

            let c_ships = [ ... new Set(cached.map(m => m.ship)) ];
            let g_ships = ships.map(m => m.symbol);

            g_ships = g_ships.filter((c, i) => g_ships.findIndex(cc => cc === c) === i && !c_ships.includes(c));

            if (g_ships.length) {
                newships = g_ships.map(s => ships.find(c => c.symbol === s)!);
                if (newships.length) {
                    console.log(`Updating cache with ${newships.length} new ships...`);
                }
            }
        }
    }

    let allruns = [] as BattleRunBase[];
    let runidx = 0;
    let current_id = 1;
    let count = 1;
    let cship = ships.length;

    for (let trypass = 0; trypass < 2; trypass++) {
        if (trypass) {
            cached = [].slice();
            newships.length = 0;
            newcrew.length = 0;
            console.log(`Detected a corruption in crew mapping (symbol change?)!!  Doing full recalculation.`);
        }

        if (!cached?.length || newcrew.length || newships.length) {
            const workcrew = newcrew.length ? newcrew : crew;

            if (cached.length) {
                allruns = cacheToBattleRuns(ships, crew, cached);
                runidx = allruns.length;
            }
            else {
                runidx = 0;
            }

            console.log("Calculate crew and ship battle scores...");
            console.log(`Frame Rate: ${rate} per second.`)

            allruns.length = (ships.length * crew.length * 18);
            console.log(`Alloc ${allruns.length} items.`);

            const bucketsize = Math.max(Math.floor(os.cpus().length / 2), 2);
            const shipBuckets = makeBuckets(ships, bucketsize);

            cship = ships.length;
            let startidx = 0;
            for (let x = 0; x < cship; x += bucketsize) {
                const bidx = Math.floor(x / bucketsize);
                let buckets = shipBuckets[bidx];
                let promises = buckets.map((ship, idx2) => new Promise<CalcRes | undefined>((resolve, reject) => {
                    const ws = newships.length && newships.some(tship => tship.symbol === ship.symbol);
                    if (ws) {
                        console.log(`Test new ship ${ship.name}`)
                    }
                    if ((newships.length && !ws) && !newcrew.length) {
                        resolve(undefined);
                        return;
                    }
                    const shipcrew = ws ? crew : workcrew;
                    const config: ShipCalcConfig = {
                        meta_cache: false,
                        ships,
                        ship_idx: startidx + idx2,
                        crew,
                        ship_crew: shipcrew,
                        runidx,
                        current_id,
                        rate,
                        hrpool,
                        arena_variance,
                        fbb_variance
                    }
                    const worker = new Worker(__dirname + '/ships/paracalc.js', {
                        workerData: config,
                    });
                    worker.on('message', (data) => {
                        // setTimeout(() => {
                        //     worker.terminate();
                        // });
                        resolve(data);
                    });
                    worker.on('error', reject);
                    worker.on('exit', (code) => {
                    if (code !== 0)
                        reject(new Error(`Worker stopped with exit code ${code}`));
                    });
                }));

                startidx += buckets.length;

                await Promise.all(promises).then((done) => {
                    done.forEach((d) => {
                        if (d) {
                            for (let drun of d.allruns) {
                                if (drun.crew) {
                                    let sym = drun.crew.symbol;
                                    delete drun.crew;
                                    drun.crew = crew.find(f => f.symbol === sym)!;
                                }
                                if (drun.ship) {
                                    let sym = drun.ship.symbol;
                                    delete (drun as any).ship;
                                    drun.ship = ships.find(f => f.symbol === sym)!;
                                }
                                if (drun.boss) {
                                    let id = drun.boss.id;
                                    delete (drun as any).boss;
                                    drun.boss = AllBosses.find(f => f.id === id)!;
                                }
                                if (drun.opponent) {
                                    let sym = drun.opponent.symbol;
                                    delete (drun as any).opponent;
                                    drun.opponent = ships.find(f => f.symbol === sym)!;
                                }
                                if (drun) {
                                    allruns[runidx++] = drun;
                                }
                            }
                            d.allruns.length = 0;
                        }
                    });
                });
                promises.length = 0;
            }
            console.log("Saving battle run cache...");
            allruns.splice(runidx);
            battleRunsToCache(allruns, cacheFile);
        }
        else {
            allruns = cacheToBattleRuns(ships, crew, cached);
            runidx = allruns.length;
        }

        if (allruns.every(ar => !!ar.crew || !!ar.reference_battle)) break;
    }

    // *** End: Battle Run Cache ***
    // ************************

    console.log("Filtering runs into arena and fbb buckets ...");

    const fbbruns: BattleRunBase[] = [];
    fbbruns.length = runidx;
    const arenaruns: BattleRunBase[] = [];
    arenaruns.length = runidx;

    const fbbruns_reference: BattleRunBase[] = [];
    fbbruns.length = runidx;
    const arenaruns_reference: BattleRunBase[] = [];
    arenaruns.length = runidx;

    let fc = 0;
    let ac = 0;
    let rfc = 0;
    let rac = 0;

    for (let run of allruns) {
        if (run.reference_battle) {
            if (run.battle === 'fbb') {
                fbbruns_reference[rfc++] = run;
            }
            else if (run.battle === 'arena') {
                arenaruns_reference[rac++] = run;
            }
        }
        else {
            if (run.battle === 'fbb') {
                fbbruns[fc++] = run;
            }
            else if (run.battle === 'arena') {
                arenaruns[ac++] = run;
            }
        }
    }

    fbbruns.splice(fc);
    arenaruns.splice(ac);
    fbbruns_reference.splice(rfc);
    arenaruns_reference.splice(rac);

    allruns.length = 0;

    if (process.argv.includes("--crew")) {
        let x = process.argv.indexOf("--crew");
        if (process.argv.length > x + 1) {
            let symbol = process.argv[x + 1];
            let c = crew.find(f => f.symbol === symbol);
            if (c) {
                console.log(`Scores for ${c.max_rarity}* Crew: ${c.name}`);
                let carena = arenaruns.filter(f => f.crew?.symbol === symbol);
                let cfbb = fbbruns.filter(f => f.crew?.symbol === symbol);
                carena.sort((a, b) => {
                    if (a.win === b.win) {
                        if (a.type === 'defense') {
                            return b.duration - a.duration || b.damage - a.damage;
                        }
                        else {
                            return b.damage - a.damage || b.duration - a.duration;
                        }
                    }
                    else if (a.win) {
                        return -1;
                    }
                    else {
                        return 1;
                    }
                });
                cfbb.sort((a, b) => {
                    if (a.win === b.win) {
                        if (a.type === 'defense') {
                            return b.duration - a.duration || b.damage - a.damage;
                        }
                        else {
                            return b.damage - a.damage || b.duration - a.duration;
                        }
                    }
                    else if (a.win) {
                        return -1;
                    }
                    else {
                        return 1;
                    }
                });
                console.log("Arena");
                console.log("-----");
                for (let a of carena) {
                    let ship = ships.find(f => f.symbol === a.ship.symbol);
                    if (ship) {
                        console.log(`${a.ship.rarity}* Ship: ${a.ship.name?.padEnd(40, " ")}: ${a.damage.toString().padEnd(15, " ")} ${a.duration.toString().padEnd(5, " ")} ${a.win}`)
                    }
                }
                console.log("\nFBB");
                console.log("---");
                for (let a of cfbb) {
                    let ship = ships.find(f => f.symbol === a.ship.symbol);
                    if (ship) {
                        console.log(`${a.ship.rarity}* Ship: ${a.ship.name?.padEnd(40, " ")}: ${a.damage.toString().padEnd(15, " ")} ${a.duration.toString().padEnd(5, " ")} ${a.win}`)
                    }
                }
                process.exit(0);
            }
        }
    }

    const shipscores = [] as Score[];
    const crewscores = [] as Score[];

    const scoreConfig: ScoreDataConfig = {
        arenaruns,
        fbbruns,
        shipscores,
        crewscores,
        ships,
        crew,
        trigger_compat: true,
        seat_compat: true,
        bypass_crew: false
    }

    console.log("\nTabulating Results ...");
    scoreConfig.bypass_crew = false;
    scoreConfig.trigger_compat = false;
    scoreConfig.seat_compat = false;
    createScoreData(scoreConfig);

    const offs_2 = crewscores.filter(cs => crewcategories[cs.symbol] === 'offense');
    const defs_2 = crewscores.filter(cs => crewcategories[cs.symbol] === 'defense');
    const ship_2 = shipscores.filter(ss => ss.arena_data.some(ad => ad.total_damage) && ss.fbb_data.some(fd => fd.total_damage));

    console.log("Scoring Offense ...");
    processScores(crew, ships, offs_2, 'offense', arenaruns.length, fbbruns.length);
    console.log("Scoring Defense ...");
    processScores(crew, ships, defs_2, 'defense', arenaruns.length, fbbruns.length);
    console.log("Scoring Ships ...");
    processScores(crew, ships, ship_2, 'ship', arenaruns.length, fbbruns.length);

    const crewRanksOut = {} as {[key: string]: ShipScores }
    const shipRanksOut = {} as {[key: string]: ShipScores }

    [offs_2, defs_2].forEach((scores, idx) => {
        scores = scores.sort((a, b) => a.name.localeCompare(b.name) || b.overall_final - a.overall_final);
        if (scores[0].name === scores[1].name) {
            console.log(`Identical entries detected!!! ${scores[0].name}`);
        }

        scores.sort((a, b) => b.fbb_final - a.fbb_final);
        scores.forEach((score, i) => score.fbb_rank = i + 1);

        scores.sort((a, b) => b.arena_final - a.arena_final);
        scores.forEach((score, i) => score.arena_rank = i + 1);
        scores.sort((a, b) => b.overall_final - a.overall_final);
        scores.forEach((score, i) => score.overall_rank = i + 1);
        for (let score of scores) {
            crewRanksOut[score.symbol] = scoreToShipScore(score, idx ? 'defense' : 'offense');
        }
    });

    rankBosses(crewRanksOut, crew);
    const metaCrew = structuredClone(crew);
    Object.entries(crewRanksOut).forEach(([symbol, ranks]) => {
        const c = metaCrew.find(f => f.symbol === symbol);
        if (c) {
            c.ranks.scores ??= {} as RankScoring;
            c.ranks.scores.ship = ranks;
        }
    });



    // ************************
    // *** Meta Cache ***

    const metaCacheFile = "./battle_meta_cache.json";
    let metaCacheMap = readMetaCache(metaCacheFile, process.argv.includes("--fresh") || process.argv.includes("--fresh-meta"));
    let metaCache = Object.values(metaCacheMap).flat();
    //newcrew = [].slice();
    newships = [].slice();
    if (metaCache?.length) {
        console.log("(Meta Cache) Checking integrity...");
        let corrupt = false;

        // Purge yanked entries:
        metaCache = metaCache.filter(c => origShips.some(s => s.symbol === c.ship)
            && (!!c.crew?.length && !!c.ship && !!c.score)
            && (c.crew.every(seat => metaCrew.some(cc => cc.symbol === seat)))
        );

        // If anything else is weird after that, we're going to uncorrupt it.
        corrupt = metaCache.some(c => !c.ship || !c.crew?.length);

        if (corrupt) {
            metaCache = [];
            metaCacheMap = {};
            console.log("(Meta Cache) Corrupted entries found. Doing full recomputation.");
        }
        else {
            // console.log("(Meta Cache) Checking for new crew...");
            // let c_crew = [ ... new Set(metaCache.map(m => m.crew).flat()) ];
            // let g_crew = crew.map(m => m.symbol);

            // g_crew = g_crew.filter((c, i) => g_crew.findIndex(cc => cc === c) === i && !c_crew.includes(c));

            // if (g_crew.length) {
            //     newcrew = g_crew.map(s => metaCrew.find(c => c.symbol === s)!);
            //     if (newcrew.length) {
            //         console.log(`(Meta Cache) Updating meta cache with ${newcrew.length} new crew...`);
            //     }
            // }
            console.log("(Meta Cache) Checking for new ships...");

            let c_ships = [ ... new Set(metaCache.map(m => m.ship)) ];
            let g_ships = ships.map(m => m.symbol);

            g_ships = g_ships.filter((c, i) => g_ships.findIndex(cc => cc === c) === i && !c_ships.includes(c));

            if (g_ships.length) {
                newships = g_ships.map(s => ships.find(c => c.symbol === s)!);
                if (newships.length) {
                    console.log(`(Meta Cache) Updating meta cache with ${newships.length} new ships...`);
                }
            }
        }
    }

    allruns.length = 0;

    let metaruns = [] as MetaCacheEntry[];
    let metaidx = 0;
    let metaship = ships.length;
    let goodmetas: LineUpMeta[] = ['arena_boom', 'fbb_1_healer', 'fbb_2_healer', 'fbb_1_healer_evasion', 'fbb_2_healer_evasion', 'fbb_0_healer_evasion'];

    for (let trypass = 0; trypass < 2; trypass++) {
        if (trypass) {
            cached = [].slice();
            newships.length = 0;
            newcrew.length = 0;
            console.log(`(Meta Cache) Detected a corruption in crew mapping (symbol change?)!!  Doing full recalculation.`);
        }

        if (!metaCache?.length || newcrew.length || newships.length) {
            //const workcrew = newcrew.length ? newcrew : crew;
            if (cached.length) {
                metaidx = metaCache.length;
            }
            else {
                metaidx = 0;
            }

            console.log("(Meta Cache) Calculate crew and ship staffing metas...");
            metaruns = [].slice();
            let startidx = 0;
            metaruns.length = (ships.length * metaCrew.length * BuiltInMetas.length * 10);
            console.log(`(Meta Cache) Alloc ${metaruns.length} items.`);

            const bucketsize = Math.max(Math.ceil(os.cpus().length * 0.75), 2);
            const shipBuckets = makeBuckets(ships, bucketsize);

            metaship = ships.length;
            for (let x = 0; x < metaship; x += bucketsize) {
                const bidx = Math.floor(x / bucketsize);
                let buckets = shipBuckets[bidx];
                let promises = buckets.map((ship, idx2) => new Promise<MetaCache | undefined>((resolve, reject) => {
                    const ws = newships.length && newships.some(tship => tship.symbol === ship.symbol);
                    if (ws) {
                        console.log(`(Meta Cache) Test new ship ${ship.name}`);
                    }
                    if ((newships.length && !ws) && !newcrew.length) {
                        resolve(undefined);
                        return;
                    }
                    let cacheFind = metaCache.filter(f => f.ship === ship.symbol);
                    //const shipcrew = ws ? crew : workcrew;
                    const config: ShipCalcMeta = {
                        meta_cache: true,
                        current_scores: cacheFind,
                        ships: [ship],
                        crew: metaCrew,
                        meta_list: goodmetas,
                        new_crew: newcrew?.length && !ws ? newcrew.map(c => c.symbol) : undefined
                    }
                    const worker = new Worker(__dirname + '/ships/paracalc.js', {
                        workerData: config,
                    });
                    worker.on('message', (data) => {
                        // setTimeout(() => {
                        //     worker.terminate();
                        // });
                        resolve(data);
                    });
                    worker.on('error', reject);
                    worker.on('exit', (code) => {
                    if (code !== 0)
                        reject(new Error(`(Meta Cache) Worker stopped with exit code ${code}`));
                    });
                }));

                startidx += buckets.length;

                await Promise.all(promises).then((done) => {
                    done.forEach((d) => {
                        if (d) {
                            let entries = Object.values(d).flat();
                            entries = entries.sort((a, b) => b.score - a.score)
                            entries = entries.filter((e, i) => entries.findIndex(e2 => e.crew.join() === e2.crew.join() && e.ship === e2.ship && e.division === e2.division && e.meta === e2.meta) === i);
                            entries = entries.slice(0, 10);

                            for (let e of entries) {
                                metaruns[metaidx] = e;
                                metaidx++;
                            }

                            entries.length = 0;
                        }
                    });
                });
                promises.length = 0;
            }
            console.log("(Meta Cache) Saving meta cache...");
            metaruns.splice(metaidx);
            metaCacheMap = writeMetaCache(metaruns, metaCacheFile);
            metaCache = Object.values(metaCacheMap).flat();
        }
        else {
            console.log(`(Meta Cache) Checing for dupes...`);
            let l1 = metaruns.length;
            metaruns = metaruns.filter((e, i) => metaruns.findIndex(e2 => e.crew.join() === e2.crew.join() && e.ship === e2.ship && e.division === e2.division && e.meta === e2.meta) === i);
            let l2 = metaruns.length;
            if (l2 !== l1) {
                console.log("(Meta Cache) Saving cleaned meta cache...");
                metaCacheMap = writeMetaCache(metaruns, metaCacheFile);
                metaCache = Object.values(metaCacheMap).flat();
            }
            metaidx = metaruns.length;
        }
        if (metaruns.every(ar => !!ar.crew?.length && !!ar?.ship)) break;
    }

    allruns.length = 0;

    // *** End: Meta Cache ***
    // ************************

    console.log("Mapping best crew to ships...");

    let arena_p2 = ships.map(sh => getStaffedShip(origShips, crew, sh, false, offs_2, defs_2, undefined, false, undefined, false, typical_cd)).filter(f => !!f);
    arena_p2 = arena_p2.concat(ships.map(sh => getStaffedShip(origShips, crew, sh, false, offs_2, defs_2, undefined, true, undefined, false, typical_cd)).filter(f => !!f));

    allruns.length = ((arena_p2.length * arena_p2.length) * 4) + (arena_p2.length * AllBosses.length * 24);
    runidx = 0;
    count = 1;
    console.log("Testing ships in Arena battles...");

    for (let ship of arena_p2) {
        let tcrew = ship.battle_stations?.map(m => m.crew).filter(f => !!f);
        if (!tcrew?.length || tcrew?.length !== ship.battle_stations?.length) {
            console.log(`Missing crew!!!`, ship, count);
            exit(-1);
        }
        if (VERBOSE) console.log(`Scoring arena on ${ship.name} against all compatible ships (${count++} / ${arena_p2.length})...`);
        let division = getShipDivision(ship.rarity);
        let shipmeta: (MetaCacheEntry | undefined)[] = metaCache.filter(f => f.ship === ship.symbol && f.meta.includes('arena') && f.division === division);
        shipmeta.push(undefined);
        for (let meta of shipmeta) {
            let wcrew: CrewMember[] = [];
            if (!meta) {
                wcrew = [...tcrew];
            }
            else {
                wcrew = meta.crew.map(csym => crew.find(f => f.symbol === csym)!);
            }

            for (let ship2 of arena_p2) {
                if (ship == ship2) continue;
                if (getShipDivision(ship2.rarity) !== division) continue;
                let runres = runBattles(current_id, rate, ship, wcrew, allruns, runidx, hrpool, false, true, ship2, false, arena_variance, fbb_variance);

                runidx = runres.runidx;
                current_id = runres.current_id;
                let testship: Ship | undefined = undefined;
                let testcrew: CrewMember[] | undefined = undefined;

                if (!meta) {
                    testship = getStaffedShip(origShips, wcrew, ship, false, offs_2, defs_2, undefined, false, ship2, false, typical_cd)
                    testcrew = testship?.battle_stations!.map(m => m.crew).filter(f => !!f);
                }
                else {
                    testship = structuredClone(ship);
                    testship.battle_stations!.forEach((bs, idx) => bs.crew = wcrew[idx]);
                    testcrew = wcrew;
                }

                if (!testcrew?.length || testcrew?.length !== ship.battle_stations?.length) {
                    console.log(`Missing crew #2!!!`, ship, count);
                    exit(-1);
                }
                if (testship && testcrew?.length) {
                    let shipmeta2: (MetaCacheEntry | undefined)[] = metaCache.filter(f => f.ship === ship2.symbol && f.meta.includes('arena') && f.division === division);
                    shipmeta2.push(undefined);
                    for (let meta2 of shipmeta2) {
                        let wship2 = ship2;
                        if (!meta2) {
                            let runres = runBattles(current_id, rate, testship!, testcrew, allruns, runidx, hrpool, false, true, ship2, false, arena_variance, fbb_variance);
                            runidx = runres.runidx;
                            current_id = runres.current_id;
                        }
                        else {
                            let wship2 = structuredClone(ship2);
                            wship2.battle_stations!.forEach((bs, idx) => bs.crew = crew.find(f => f.symbol === meta2.crew[idx])!);
                            let runres = runBattles(current_id, rate, testship!, testcrew, allruns, runidx, hrpool, false, true, wship2, false, arena_variance, fbb_variance);
                            runidx = runres.runidx;
                            current_id = runres.current_id;
                        }
                        if (ship.actions?.some(a => a.status === 2)) {
                            testship = getStaffedShip(origShips, wcrew, ship, false, offs_2, defs_2, undefined, false, wship2, true, typical_cd)
                            testcrew = testship?.battle_stations!.map(m => m.crew).filter(f => !!f);
                            if (!testcrew?.length || testcrew?.length !== ship.battle_stations?.length) {
                                console.log(`Missing crew #3!!!`, ship, count);
                                exit(-1);
                            }
                        }
                    }
                }
            }
        }
    }

    // count = 1;
    // let xcount = 1;
    // for (let fbb_num = 4; fbb_num > 0; fbb_num--) {
    //     if (fbb_num === 2) console.log(`Testing ships in Fleet Boss battles (${xcount++}/4) - 2 Hull-Repair ...`);
    //     else if (fbb_num === 1) console.log(`Testing ships in Fleet Boss battles (${xcount++}/4) - 1 Hull-Repair ...`);
    //     else if (fbb_num === 4) console.log(`Testing ships in Fleet Boss battles (${xcount++}/4) - 2 Evasion ...`);
    //     else if (fbb_num === 3) console.log(`Testing ships in Fleet Boss battles (${xcount++}/4) - 1 Evasion ...`);

    //     for (let cship of ships) {
    //         if (VERBOSE) console.log(`Scoring FBB on ${cship.name} (${count++} / ${ships.length})...`);
    //         let bosses = getBosses(cship);
    //         // if (cship.name === 'Borg Tactical Cube') {
    //         //     let n = 'break';
    //         // }
    //         bosses.sort((a, b) => b.rarity - a.rarity);
    //         let c = bosses.length;
    //         let cboss: BossShip | undefined = undefined;
    //         for (let i = 0; i < c; i++) {
    //             let ship: Ship | undefined = cship;
    //             cboss = bosses[i];
    //             ship = getStaffedShip(origShips, crew, cship, fbb_num as 1 | 2 | 3 | 4, offs_2, defs_2, undefined, undefined, cboss)!;
    //             if (!ship) continue;
    //             let multi = createMulitpleShips(ship);
    //             if (!multi) {
    //                 if (VERBOSE) {
    //                     console.log(`${ship.name}, SKIPPING BOSS: ${cboss?.ship_name} ${cboss?.rarity}`);
    //                     console.log('Cannot generate lineup');
    //                 }
    //                 continue;
    //             }
    //             for (let mship of multi) {
    //                 let ccrew = mship.battle_stations!.map(m => m.crew!);
    //                 if (!ccrew.every(c => c)) {
    //                     console.log(`Something is wrong here`);
    //                     console.log(`${mship.name}, ${cboss?.ship_name} ${cboss?.rarity}`);
    //                     console.log(ccrew);
    //                     process.exit(-1);
    //                 }
    //                 let runres = runBattles(current_id, rate, mship, ccrew, allruns, runidx, [], true, false, cboss, true, arena_variance, fbb_variance);

    //                 runidx = runres.runidx;
    //                 current_id = runres.current_id;
    //             }
    //         }
    //     }
    // }

    count = 1;
    let xcount = 1;
    let symbols = [ ...new Set(AllBosses.map(b => b.symbol)) ];
    for (let boss_sym of symbols) {
        console.log(`Test Boss: ${boss_sym}`);
        for (let cship of ships) {
            if (VERBOSE) console.log(`Scoring FBB on ${cship.name} (${count++} / ${ships.length})...`);
            let bosses = getBosses(cship).filter(f => f.symbol === boss_sym);
            // if (cship.name === 'Borg Tactical Cube') {
            //     let n = 'break';
            // }

            if (cship.name?.includes('Discovery')) {
                let p = 0;
            }
            bosses.sort((a, b) => b.rarity - a.rarity);
            let c = bosses.length;
            let cboss: BossShip | undefined = undefined;
            for (let i = 0; i < c; i++) {
                let ship: Ship | undefined = cship;
                cboss = bosses[i];
                let isborg = boss_sym.includes('borg');
                let testmetas: (MetaCacheEntry | undefined)[] = metaCacheMap[ship.symbol].filter(f => {
                    if (cboss) {
                        return f.division === cboss.id && f.meta.includes('fbb');
                    }
                    if (isborg) {
                        return f.meta.includes('fbb') && f.meta.includes('evasion');
                    }
                    else {
                        return f.meta.includes('fbb') && !f.meta.includes('evasion');
                    }
                });

                testmetas.push(undefined);

                for (let meta of testmetas) {
                    if (!meta || meta.crew.length !== cship?.battle_stations!.length) {
                        let fbb_num = isborg ? 4 : 2;
                        if (cship.battle_stations!.length <= 3 || cship.actions?.some(act => act.ability?.type === 2 && !act.limit)) fbb_num--;
                        ship = getStaffedShip(origShips, crew, cship, fbb_num as 1 | 2 | 3 | 4, offs_2, defs_2, undefined, undefined, cboss)!;
                    }
                    else if (cship) {
                        ship = structuredClone(cship);
                        meta.crew.forEach((cs, idx) => {
                            let mcrew = metaCrew.find(f => f.symbol === cs);
                            if (mcrew) {
                                ship!.battle_stations![idx].crew = mcrew;
                            }
                        });
                        if (!ship.battle_stations?.every(bs => !!bs.crew)) ship = undefined;
                    }
                    if (!ship) continue;
                    let multi = createMulitpleShips(ship);
                    if (!multi) {
                        if (VERBOSE) {
                            console.log(`${ship.name}, SKIPPING BOSS: ${cboss?.ship_name} ${cboss?.rarity}`);
                            console.log('Cannot generate lineup');
                        }
                        continue;
                    }
                    for (let mship of multi) {
                        let ccrew = mship.battle_stations!.map(m => m.crew!);
                        if (!ccrew.every(c => c)) {
                            console.log(`Something is wrong here`);
                            console.log(`${mship.name}, ${cboss?.ship_name} ${cboss?.rarity}`);
                            console.log(ccrew);
                            process.exit(-1);
                        }
                        let runres = runBattles(current_id, rate, mship, ccrew, allruns, runidx, [], true, false, cboss, true, arena_variance, fbb_variance);

                        runidx = runres.runidx;
                        current_id = runres.current_id;
                    }
                }
            }
        }
    }


    console.log("Score Ships, Pass 2...");
    allruns.splice(runidx);

    const orig_arena_len = arenaruns.length;
    arenaruns.length = 0;
    arenaruns.length = runidx;
    fbbruns.length = 0;
    fbbruns.length = runidx;

    fc = 0;
    ac = 0;

    for (let run of allruns) {
        if (run.battle === 'fbb') {
            fbbruns[fc++] = run;
        }
        else if (run.battle === 'arena') {
            arenaruns[ac++] = run;
        }
    }

    fbbruns.splice(fc);
    arenaruns.splice(ac);

    allruns.length = 0;

    scoreConfig.bypass_crew = true;
    scoreConfig.trigger_compat = true;
    scoreConfig.seat_compat = true;

    createScoreData(scoreConfig);

    const ship_3 = shipscores.filter(ss => ss.arena_data.some(ad => ad.total_damage) && ss.fbb_data.some(fd => fd.total_damage));

    processScores(crew, ships, ship_3, 'ship', arenaruns.length, fbbruns.length);

    console.log("Factoring ship grades into final crew grades.");

    const shipidx = 2;

    const tc = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

    const buffer = [] as string[];

    function printAndLog(...params: any[]) {
        let text = params.join(" ");
        buffer.push(text);
        if (VERBOSE) console.log(...params);
    }

    [offs_2, defs_2, ship_3].forEach((scores, idx) => {
        printAndLog(" ");
        printAndLog(`${idx == 0 ? 'Offense' : idx == 1 ? 'Defense' : 'Ship'}`);
        printAndLog(" ");

        scores = scores.sort((a, b) => a.name.localeCompare(b.name) || b.overall_final - a.overall_final);
        if (scores[0].name === scores[1].name) {
            console.log(`Identical entries detected!!! ${scores[0].name}`);
        }

        scores.sort((a, b) => b.fbb_final - a.fbb_final);
        scores.forEach((score, i) => score.fbb_rank = i + 1);

        scores.sort((a, b) => b.arena_final - a.arena_final);
        scores.forEach((score, i) => score.arena_rank = i + 1);

        scores.sort((a, b) => b.overall_final - a.overall_final);
        scores.forEach((score, i) => score.overall_rank = i + 1);

        for (let score of scores) {
            if (idx === shipidx) {
                shipRanksOut[score.symbol] = scoreToShipScore(score, 'ship');
            }
            else {
                crewRanksOut[score.symbol] = scoreToShipScore(score, idx ? 'defense' : 'offense');
            }
        }

        let working = scores.slice(0, 100);
        let arena_high = scores.find(f => f.arena_final === 10);
        if (arena_high) {
            printAndLog(`Highest Arena: ${arena_high.name}, Average Index: ${Math.round(arena_high.arena_data[0].average_index)} / ${orig_arena_len}`);
            if (!working.includes(arena_high)) {
                working.push(arena_high);
            }
        }
        let fbb_high = scores.find(f => f.fbb_final === 10);
        if (fbb_high) {
            printAndLog(`Highest FBB: ${fbb_high.name}, Max Damage: ${fbb_high.fbb_data[0].max_damage}`);
            if (!working.includes(fbb_high)) {
                working.push(fbb_high);
            }
        }
        printAndLog(" ");

        for (let item of working) {
            item.fbb_data.sort((a, b) => b.group - a.group);
            item.arena_data.sort((a, b) => b.group - a.group);

            let triggered = false;
            let c = crew.find(f => f.symbol === item.symbol);
            if (c && c.action.ability?.condition) triggered = true;

            let arena_crew = crew.filter(f => item.arena_data?.length && item.arena_data[0].max_staff.includes(f.symbol));
            let fbb_crew = crew.filter(f => item.fbb_data?.length && item.fbb_data[0].max_staff.includes(f.symbol));
            let arena_ship = ships.find(f => item.arena_data?.length && f.symbol === item.arena_data[0].max_ship);
            let fbb_ship = ships.find(f => item.fbb_data?.length && f.symbol === item.fbb_data[0].max_ship);
            let fbb_ship2 = ships.find(f => item.fbb_data?.length && f.symbol === item.fbb_data[0].max_duration_ship);
            if (!arena_crew || !fbb_crew || !arena_ship || !fbb_ship) return;

            printAndLog(
                item.name.padEnd(40, " "),
                `${item.overall_final}`.padEnd(5, ' '),
                `${item.arena_final}`.padEnd(5, ' '),
                `${item.fbb_final}`.padEnd(5, ' '),
                idx == shipidx ? 'Ship' : 'Crew',
                idx == shipidx ? 'Ship' : tc(crewcategories[item.symbol]).padEnd(7, " "),
                `${c ? printTrigger(c) : ''}`
            );

            if (item.kind === 'ship') {
                printAndLog(" ".padEnd(40, " "), arena_crew.map(c => c.name + `${printTrigger(c)}`).join(", "));
                printAndLog(" ".padEnd(40, " "), fbb_crew.map(c => c.name + `${printTrigger(c)}`).join(", "));
            }
            else {
                printAndLog(" ".padEnd(40, " "), arena_ship?.name?.padEnd(20, " "), " - Max Damage Arena Ship");
                printAndLog(" ".padEnd(40, " "), fbb_ship?.name?.padEnd(20, " "), " - Max Damage FBB Ship");
                printAndLog(" ".padEnd(40, " "), fbb_ship2?.name?.padEnd(20, " "), " - Max Duration FBB Ship", `(Max Dur: ${Math.ceil(item.fbb_data[0].max_duration)}s)`);
            }
            item.arena_data.forEach((group) => {
                printAndLog(" ".padEnd(40, " "), `A${group.group}: ${group.final} (Max Dmg: ${Math.ceil(group.max_damage).toLocaleString()}, Avg Dmg: ${Math.ceil(group.average_damage).toLocaleString()}, ${group.count} Runs, Win Rate: ${Math.ceil((group.win_count / group.count) * 100)}%)`);
            });
            item.fbb_data.forEach((group) => {
                if (idx === 1) {
                    printAndLog(" ".padEnd(40, " "), `B${group.group}: ${group.final} (Max Dmg: ${Math.ceil(group.max_damage).toLocaleString()}, Avg Dmg: ${Math.ceil(group.average_damage).toLocaleString()}, ${group.count} Runs, Avg Dur: ${Math.ceil(group.duration / group.count)}s )`);
                }
                else {
                    printAndLog(" ".padEnd(40, " "), `B${group.group}: ${group.final} (Max Dmg: ${Math.ceil(group.max_damage).toLocaleString()}, Avg Dmg: ${Math.ceil(group.average_damage).toLocaleString()}, ${group.count} Runs)`);

                }
            });
        }
    });

    console.log("Writing report and scores...");

    fs.writeFileSync("./battle_run_report.txt", buffer.join("\n"));
    fs.writeFileSync("./battle_run_report.json", JSON.stringify(offs_2.concat(defs_2).concat(ship_3)));

    console.log("Writing rankings to crew.json and ship_schematics.json ...");

    const crewFresh = JSON.parse(fs.readFileSync(STATIC_PATH + 'crew.json', 'utf-8')) as CrewMember[];
    const shipFresh = JSON.parse(fs.readFileSync(STATIC_PATH + 'ship_schematics.json', 'utf-8')) as Schematics[];

    rankBosses(crewRanksOut, crew);
    Object.entries(crewRanksOut).forEach(([symbol, ranks]) => {
        const c = crewFresh.find(f => f.symbol === symbol);
        if (c) {
            c.ranks.scores ??= {} as RankScoring;
            c.ranks.scores.ship = ranks;
        }
    });
    rankBosses(shipRanksOut, ships);
    Object.entries(shipRanksOut).forEach(([symbol, ranks]) => {
        const c = shipFresh.find(f => f.ship.symbol === symbol);
        if (c) {
            c.ship.ranks = ranks;
        }
    });

    for (let c of crewFresh) {
        c.ranks.scores ??= {} as RankScoring;
        if (!c.ranks.scores.ship) {
            const t = characterizeCrew(c);
            c.ranks.scores.ship = createBlankShipScore(t < 0 ? 'defense' : 'offense');
        }
    }

    for (let s of shipFresh) {
        if (!s.ship.ranks) {
            s.ship.ranks = createBlankShipScore('ship');
        }
    }

    if (fs.existsSync(STATIC_PATH + 'all_ships.json')) {
        console.log("Writing to all_ships.json...");
        const allships = JSON.parse(fs.readFileSync(STATIC_PATH + 'all_ships.json', 'utf-8')) as Ship[];
        Object.entries(shipRanksOut).forEach(([symbol, ranks]) => {
            const c = allships.find(f => f.symbol === symbol);
            if (c) {
                c.ranks = ranks;
            }
        });
        fs.writeFileSync(STATIC_PATH + 'all_ships.json', JSON.stringify(allships));
    }

    fs.writeFileSync(STATIC_PATH + 'crew.json', JSON.stringify(crewFresh));
    fs.writeFileSync(STATIC_PATH + 'ship_schematics.json', JSON.stringify(shipFresh));

    const runEnd = new Date();
    const diff = (runEnd.getTime() - runStart.getTime()) / (1000 * 60);
    console.log("Run Time", `${diff.toFixed(2)} minutes.`);
}

(async () => {
    processShips();
    await processCrewShipStats(10, 0, 0);
})();

