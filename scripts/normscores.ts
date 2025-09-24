import { GreatnessDetails } from "../../website/src/model/crew";

export type RarityScore = { symbol: string, score: number, rarity: number, data?: any, greatness?: number, greatness_details?: GreatnessDetails };

export function normalize(results: RarityScore[], inverse?: boolean, min_balance?: boolean, not_crew?: boolean, base = 100, tie_breaker?: <T extends { symbol: string }>(a: T, b: T) => number) {
        base ??= 100;
        results = results.slice();
        results.sort((a, b) => b.score - a.score);
        let max = results[0].score;
        let min = min_balance ? (results[results.length - 1].score) : 0;
        max -= min;
        for (let r of results) {
            if (inverse) {
                r.score = Number((((1 - (r.score - min) / max)) * base).toFixed(4));
            }
            else {
                r.score = Number((((r.score - min) / max) * base).toFixed(4));
            }
        }

        results.sort((a, b) => {
            let r = b.score - a.score;
            if (!r) {
                if (tie_breaker) {
                    r = tie_breaker(a, b);
                }
                if (!r && !not_crew) {
                    // if (crewNames[a.symbol] && crewNames[b.symbol]) {
                    //     r = crewNames[a.symbol].localeCompare(b.symbol);
                    // }
                    // else {
                        return a.symbol.localeCompare(b.symbol);
                        //console.log(`Missing crew names for ${a.symbol} or ${b.symbol}`)!
                    //}
                }
            }
            return r;
        });
        return results;
    }