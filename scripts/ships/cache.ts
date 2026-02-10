import fs from 'fs';
import { BattleRunBase, BattleRunCache } from './scoring';
import { AllBosses } from '../../../website/src/utils/shiputils';
import { CrewMember } from '../../../website/src/model/crew';
import { Ship } from '../../../website/src/model/ship';
import { MetaCache, MetaCacheEntry } from './paracalc';

export const CACHE_VERSION = 7.0;
export const META_CACHE_VERSION = 1.0;

export function readBattleCache(cacheFile: string, purge_outdated = true) {
    let cached = [] as BattleRunCache[];

    if (fs.existsSync(cacheFile)) {
        if (purge_outdated) {
            console.log("Purging battle run cache...");
            fs.unlinkSync(cacheFile);
        }
        else {
            console.log("Loading battle run cache...");
            cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            if (cached.length && !cached[0].version || cached[0].version < CACHE_VERSION) {
                console.log("Purging outdated battle run cache...");
                fs.unlinkSync(cacheFile);
                cached = [].slice();
            }
        }
    }
    return cached;
}

export function readMetaCache(cacheFile: string, purge_outdated = true) {
    let cached = {} as MetaCache;
    if (fs.existsSync(cacheFile)) {
        if (purge_outdated) {
            console.log("Purging meta cache...");
            fs.unlinkSync(cacheFile);
        }
        else {
            console.log("Loading meta cache...");
            cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            let test = Object.values(cached)[0];
            if (cached && !test[0].version || test[0].version < META_CACHE_VERSION) {
                console.log("Purging outdated meta cache...");
                fs.unlinkSync(cacheFile);
                cached = {};
            }
        }
    }
    return cached;
}


export function writeMetaCache(runs: MetaCacheEntry[] | MetaCache, cacheFile?: string): MetaCache {
    if (Array.isArray(runs)) {
        let obj = {} as MetaCache;
        for (let r of runs) {
            if (!r?.ship) continue;
            obj[r.ship] ??= [];
            obj[r.ship].push(r)
        }
        runs = obj;
    }
    if (cacheFile) {
        fs.writeFileSync(cacheFile, JSON.stringify(runs));
    }
    return runs;
}



export function battleRunsToCache(runs: BattleRunBase[], cacheFile?: string): BattleRunCache[] {
    const result = runs.map(run => ({
        ...run,
        crew: run.crew?.symbol ?? '',
        ship: run.ship.symbol,
        boss: run.boss?.id,
        opponent: run.opponent?.symbol,
        version: CACHE_VERSION,
        reference_battle: !!run.reference_battle
    }));
    if (cacheFile) {
        fs.writeFileSync(cacheFile, JSON.stringify(result));
    }
    return result;
}

export function cacheToBattleRuns(ships: Ship[], crew: CrewMember[], cached: BattleRunCache[]): BattleRunBase[] {
    return cached.map(run => ({
        ...run,
        crew: run.crew ? crew.find(c => c.symbol === run.crew) : undefined,
        ship: ships.find(c => c.symbol === run.ship)!,
        boss: run.boss && (run.boss as any) !== 'undefined' ? AllBosses.find(c => c.id === run.boss) : undefined,
        opponent: run.opponent ? ships.find(c => c.symbol === run.opponent) : undefined
    }));
}
