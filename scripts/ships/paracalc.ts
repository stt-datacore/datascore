import { isMainThread, parentPort, workerData } from 'node:worker_threads';

import { CrewMember } from "../../../website/src/model/crew";
import { Ship } from "../../../website/src/model/ship";
import { BuiltInMetas, LineUpMeta } from '../../../website/src/model/worker';
import { getPermutations } from '../../../website/src/utils/misc';
import { getBosses, getCrewDivisions, getShipDivision } from '../../../website/src/utils/shiputils';
import { passesMeta } from '../../../website/src/workers/battleworkermeta';
import { scoreLineUp } from '../../../website/src/workers/battleworkerutils';
import { getCleanShipCopy, nextOpponent, runBattles, RunRes } from "./battle";
import { META_CACHE_VERSION } from './cache';
import { BattleRunBase } from "./scoring";

export interface ShipCalcBase {
    meta_cache: boolean;
    ships: Ship[];
    crew: CrewMember[];
    current_scores?: MetaCacheEntry[];
}

export interface ShipCalcMeta extends ShipCalcBase {
    meta_list?: LineUpMeta[];
    boss?: number;
    new_crew?: string[];
}

export interface ShipCalcConfig extends ShipCalcBase {
    ship_idx: number;
    ship_crew: CrewMember[],
    runidx: number;
    current_id: number;
    rate: number;
    hrpool: CrewMember[];
    arena_variance: number,
    fbb_variance: number
}

export interface CalcRes extends RunRes {
    allruns: BattleRunBase[];
}

async function calculateShip(config: ShipCalcConfig) {
    return new Promise<CalcRes>((resolve, reject) => {
        const { rate, ship_crew, ships, hrpool, ship_idx, arena_variance, fbb_variance } = config;
        let { runidx, current_id } = config;
        let i = ship_idx;

        const allruns = [] as BattleRunBase[];
        allruns.length = 9 * ship_crew.length;
        const ship = ships[i];

        const shipcrew = ship_crew;

        const opponent = nextOpponent(ships, getShipDivision(ship.rarity), i);

        let runres = runBattles(current_id, rate, getCleanShipCopy(ship), [], allruns, runidx, hrpool, false, false, undefined, false, arena_variance, fbb_variance, true);

        runidx = 0;
        current_id = runres.current_id;

        let work_oppo = undefined as Ship | undefined;
        let work_ship = undefined as Ship | undefined

        console.log(`Run ${shipcrew.length} crew on ${ship.name} (FBB Only)...`);

        work_ship = getCleanShipCopy(ship);
        runres = runBattles(current_id, rate, work_ship, [], allruns, runidx, hrpool, false, false, undefined, false, arena_variance, fbb_variance, true);

        runidx = runres.runidx;
        current_id = runres.current_id;

        for (let c of shipcrew) {
            work_ship = getCleanShipCopy(ship);
            let runres = runBattles(current_id, rate, work_ship, c, allruns, runidx, hrpool, true, false, undefined, false, arena_variance, fbb_variance);

            runidx = runres.runidx;
            current_id = runres.current_id;
        }

        console.log(`Run ${shipcrew.length} crew on ${ship.name} (Arena Only; Opponent: SELF) ...`);

        for (let c of shipcrew) {
            work_ship = getCleanShipCopy(ship);
            let runres = runBattles(current_id, rate, work_ship, c, allruns, runidx, hrpool, false, true, undefined, false, arena_variance, fbb_variance);

            runidx = runres.runidx;
            current_id = runres.current_id;
        }

        console.log(`Run ${shipcrew.length} crew on ${ship.name} (Arena Only; Opponent: ${opponent?.name ?? 'NONE'}) ...`);
        if (opponent) {
            runres = runBattles(current_id, rate, getCleanShipCopy(ship), [], allruns, runidx, hrpool, false, true, getCleanShipCopy(opponent), false, arena_variance, fbb_variance, true);
            runidx = runres.runidx;
            current_id = runres.current_id;
            runres = runBattles(current_id, rate, getCleanShipCopy(opponent), [], allruns, runidx, hrpool, false, true, getCleanShipCopy(ship), false, arena_variance, fbb_variance, true);
            runidx = runres.runidx;
            current_id = runres.current_id;
        }

        for (let c of shipcrew) {
            work_ship = getCleanShipCopy(ship);
            if (opponent) work_oppo = getCleanShipCopy(opponent);
            if (work_oppo?.battle_stations?.length) {
                work_oppo.battle_stations[0].crew = c;
            }
            let runres = runBattles(current_id, rate, work_ship, c, allruns, runidx, hrpool, false, true, work_oppo, false, arena_variance, fbb_variance);

            runidx = runres.runidx;
            current_id = runres.current_id;
        }

        if (opponent) {
            console.log(`Run ${shipcrew.length} crew on ${opponent.name} (Arena Only; Opponent: ${work_ship?.name}) ...`);
            for (let c of shipcrew) {
                work_ship = getCleanShipCopy(ship);
                work_oppo = getCleanShipCopy(opponent);
                if (work_ship?.battle_stations?.length) {
                    work_ship.battle_stations[0].crew = c;
                }
                let runres = runBattles(current_id, rate, work_oppo, c, allruns, runidx, hrpool, false, true, work_ship, false, arena_variance, fbb_variance);

                runidx = runres.runidx;
                current_id = runres.current_id;
            }
        }

        allruns.length = runidx;
        resolve({ runidx, current_id, allruns });
    });
}

export type MetaCacheEntry = {
    version: number,
    ship: string,
    crew: string[],
    division: number,
    meta: LineUpMeta,
    score: number
}

export type MetaCache = {[key:string]: MetaCacheEntry[]};

export async function calculateMeta(config: ShipCalcMeta) {
    let { ships, crew, meta_list, boss, new_crew, current_scores: prev_scores } = config;
    let metas = {} as MetaCache;
    const meta_max = 50;

    function testSeats(seats: string[], crew: CrewMember[]) {
        let seatcount = [] as number[];
        seatcount.length = seats.length;
        let c = seats.length;
        for (let i = 0; i < c; i++) {
            let d = crew.length;
            for (let j = 0; j < d; j++) {
                if (crew[j].skill_order.includes(seats[i])) {
                    seatcount[i] ??= 0;
                    seatcount[i]++;
                }
            }
        }
        return seatcount.every(sc => !!sc);
    }

    for (let ship of ships) {
        let seats = ship.battle_stations!.map(m => m.skill);
        metas[ship.symbol] ??= [].slice();
        let bosses = getBosses(ship);
        let division = getShipDivision(ship.rarity);
        let divcrew = crew.filter(cf => cf.max_rarity >= ship.rarity && getCrewDivisions(cf.max_rarity).includes(division) && (!cf.action?.ability?.condition || ship.actions!.some(act => act.status === cf.action.ability?.condition)));
        divcrew = divcrew.sort((a, b) => b.ranks.scores.ship.arena - a.ranks.scores.ship.arena).slice(0, meta_max);
        for (let meta of BuiltInMetas) {
            if (boss) continue;
            if (meta_list?.length && !meta_list.includes(meta)) continue;
            console.log(`Testing meta '${meta}' on ${ship.name} with ${divcrew.length} crew...`);
            if (!meta.startsWith('fbb')) {
                let count = 0;
                for (let pass = 0; pass < 2; pass++) {
                    if (pass > 0 && metas[ship.symbol]?.some(m => m.ship === ship.symbol && m.division === division)) break;
                    let cscore = prev_scores?.filter(f => f.ship === ship.symbol && f.division === division).sort((a, b) => b.score - a.score);
                    let lastscore = cscore?.length ? cscore[0].score : 0;
                    if (cscore?.length && pass === 0) {
                        metas[ship.symbol] = metas[ship.symbol].concat(cscore);
                    }
                    if ((!new_crew?.length || divcrew.some(bc => new_crew.some(nc => bc.symbol === nc)))) {
                        getPermutations(divcrew, ship.battle_stations!.length, undefined, true, undefined, (res, idx) => {
                            if (new_crew && !res.some(rc => new_crew.includes(rc.symbol))) return false;
                            if (!pass && !testSeats(seats, res)) return false;
                            if (passesMeta(ship, res, meta)) {
                                let score = scoreLineUp(ship, res, 'arena', 20);
                                if (score <= lastscore) {
                                    return false;
                                }
                                lastscore = score;
                                metas[ship.symbol].push({
                                    version: META_CACHE_VERSION,
                                    ship: ship.symbol,
                                    crew: res.map(c => c.symbol),
                                    division,
                                    meta,
                                    score
                                });
                                count++;
                                return res;
                            }
                            else {
                                return false;
                            }
                        });
                    }
                    else {
                        break;
                    }
                    if (count) break;
                }
                console.log(`${count} metas created for '${meta}' on ${ship.name}`);
            }
        }
        for (let testboss of bosses) {
            if (boss && testboss.id !== boss) continue;
            for (let meta of BuiltInMetas) {
                if (meta_list?.length && !meta_list.includes(meta)) continue;
                let mm = Math.floor(meta_max / 2);
                let ocrew = crew.filter(cf => !cf.action.limit && cf.ranks.scores.ship.kind === 'offense' && cf.max_rarity >= ship.rarity && getBosses(undefined, cf).includes(testboss) && (!cf.action?.ability?.condition || ship.actions!.some(act => act.status === cf.action.ability?.condition)));
                let dcrew = crew.filter(cf => !cf.action.limit && cf.ranks.scores.ship.kind === 'defense' && cf.max_rarity >= ship.rarity && getBosses(undefined, cf).includes(testboss) && (!cf.action?.ability?.condition || ship.actions!.some(act => act.status === cf.action.ability?.condition)));
                ocrew = ocrew.sort((a, b) => {
                    if (meta.includes('evasion')) {
                        if (!(a.action.bonus_type === 1 && b.action.bonus_type === 1)) {
                            if (a.action.bonus_type === 1) return -1;
                            else if (b.action.bonus_type === 1) return -1;
                        }
                    }
                    return b.ranks.scores.ship.fbb - a.ranks.scores.ship.fbb
                });
                dcrew = dcrew.sort((a, b) => {
                    if (meta.includes('evasion')) {
                        if (!(a.action.bonus_type === 1 && b.action.bonus_type === 1)) {
                            if (a.action.bonus_type === 1) return -1;
                            else if (b.action.bonus_type === 1) return -1;
                        }
                    }
                    return b.ranks.scores.ship.fbb - a.ranks.scores.ship.fbb
                });
                if (meta.includes("0_healer")) {
                    ocrew = ocrew.slice(0, meta_max);
                    dcrew = [].slice();
                }
                else {
                    ocrew = ocrew.slice(0, mm);
                    dcrew = dcrew.slice(0, mm);
                }
                let bcrew = ocrew.concat(dcrew);
                bcrew = bcrew.sort((a, b) => b.ranks.scores.ship.fbb - a.ranks.scores.ship.fbb);
                if (meta.startsWith("fbb")) {
                    console.log(`Testing meta '${meta}' on ${ship.name} with ${bcrew.length} crew...`);
                    let count = 0;
                    for (let pass = 0; pass < 2; pass++) {
                        if (pass > 0 && metas[ship.symbol]?.some(m => m.ship === ship.symbol && m.division === testboss.id)) break;
                        let cscore = prev_scores?.filter(f => f.ship === ship.symbol && f.division === testboss.id).sort((a, b) => b.score - a.score);
                        let lastscore = cscore?.length ? cscore[0].score : 0;
                        if (cscore?.length && pass === 0) {
                            metas[ship.symbol] = metas[ship.symbol].concat(cscore);
                        }
                        if ((!new_crew?.length || bcrew.some(bc => new_crew.some(nc => bc.symbol === nc)))) {
                            getPermutations(bcrew, ship.battle_stations!.length, undefined, true, undefined, (res, idx) => {
                                if (new_crew && !res.some(rc => new_crew.includes(rc.symbol))) return false;
                                if (!pass && !testSeats(seats, res)) return false;
                                if (passesMeta(ship, res, meta)) {
                                    let h: 'evade' | 'heal' = meta.includes('evasion') ? 'evade' : 'heal';
                                    let score = scoreLineUp(ship, res, h);
                                    if (score <= lastscore) {
                                        return false;
                                    }
                                    lastscore = score;
                                    metas[ship.symbol].push({
                                        version: META_CACHE_VERSION,
                                        ship: ship.symbol,
                                        crew: res.map(c => c.symbol),
                                        division: testboss.id,
                                        meta,
                                        score
                                    });
                                    count++;
                                    return res;
                                }
                                else {
                                    return false;
                                }
                            });
                        }
                        else {
                            break;
                        }
                        if (count) break;
                    }
                    console.log(`${count} metas created for '${meta}' on ${ship.name}`);
                }
            }
        }
    }
    let metavals = Object.values(metas);
    metavals.forEach((meta) => {
        meta.sort((a, b) => b.score - a.score);
    });
    return metas;
}

if (!isMainThread) {
    (async () => {
        const config = workerData as ShipCalcBase;
        const response = config.meta_cache ? await calculateMeta(config as ShipCalcMeta) : await calculateShip(config as ShipCalcConfig);
        parentPort?.postMessage(response);
    })();
}