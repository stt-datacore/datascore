import { cp } from "node:fs";
import { potentialCols } from "../../website/src/components/stats/utils";
import { CollectionScore } from "../../website/src/model/collections";
import { CrewMember } from "../../website/src/model/crew";
import { CryoCollection as Collection } from "../../website/src/model/player";
import { TraitNames } from "../../website/src/model/traits";

type PColType = { trait: string, count: number, distance: number };

export function computePotentialColScores(crew: CrewMember[], collections: Collection[], TRAIT_NAMES: TraitNames) {
    if (crew?.length && collections?.length && TRAIT_NAMES) {
        let moving_number = 0;
        let max_crew = 0;
        collections.forEach((c, idx) => {
            if (c.crew?.length) {
                moving_number += (c.crew.length) * (idx + 1);
                if (max_crew < c.crew.length) max_crew = c.crew.length;
            }
        });
        moving_number /= collections.map((c, i) => i + 1).reduce((p, n) => p + n, 0);
        let potential = potentialCols(crew, collections, TRAIT_NAMES) as PColType[];
        potential.sort((a, b) => b.count - a.count);

        let max_c = potential[0].count;
        let med = moving_number;
        for (let p of potential) {
            p.distance = Math.abs(p.count - med);
        }
        potential.sort((a, b) => b.distance - a.distance);
        for (let p of potential) {
            p.count = Number(((1 - (p.distance / max_crew)) * 10).toFixed(2))
        }
        potential.sort((a, b) => b.count - a.count);
        max_c = potential[0].count;
        for (let p of potential) {
            p.count = Number(((p.count / max_c) * 10).toFixed(2))
        }
        return potential;
    }
    else {
        return [];
    }
}

export function splitCollections(cols: Collection[]) {
    const vanity = [] as Collection[];
    const statBoosting = [] as Collection[];
    const crewCols = [] as Collection[];
    for (let col of cols) {
        if (col.milestones?.some(mi => mi.buffs?.length)) {
            statBoosting.push(col);
        }
        else if (col.milestones?.some(mi => mi.rewards.some(r => r.type === 1))) {
            crewCols.push(col);
        }
        else {
            vanity.push(col);
        }
    }
    return { vanity, statBoosting, crewCols };
}


export function scoreCollection(col: Collection, allcrew: CrewMember[]) {
    const colscore: CollectionScore = {
        score: 0,
        details: {
            portal: 0,
            non_portal: 0,
            average_rarity: 0,
            average_datascore: 0,
            average_nonportal_datascore: 0,
            average_portal_datascore: 0,
            loot_score: 0,
            difficulty: 0,
            rarity_datascores: {}
        }
    }
    if (col.crew) {
        const colcrew = col.crew;
        let crew = allcrew.filter(f => colcrew.includes(f.symbol));
        if (crew.length) {
            let portal = crew.filter(f => !!f.unique_polestar_combos?.length);
            let nonportal = crew.filter(f => !f.unique_polestar_combos?.length);
            colscore.details.non_portal = nonportal.length;
            colscore.details.portal = portal.length;
            colscore.details.average_rarity = crew.map(c => c.max_rarity).reduce((p, n) => p + n, 0) / crew.length;
            colscore.details.average_datascore = crew.map(c => c.ranks.scores.overall).reduce((p, n) => p + n, 0) / crew.length;
            colscore.details.average_rarity = Number(colscore.details.average_rarity.toFixed(2));
            colscore.details.average_datascore = Number(colscore.details.average_datascore.toFixed(4));
            if (nonportal.length) {
                colscore.details.average_nonportal_datascore = nonportal.map(c => c.ranks.scores.overall).reduce((p, n) => p + n, 0) / nonportal.length;
                colscore.details.average_nonportal_datascore = Number(colscore.details.average_nonportal_datascore.toFixed(4));
            }
            if (portal.length) {
                colscore.details.average_portal_datascore = portal.map(c => c.ranks.scores.overall).reduce((p, n) => p + n, 0) / portal.length;
                colscore.details.average_portal_datascore = Number(colscore.details.average_portal_datascore.toFixed(4));
            }
            for (let rarity = 1; rarity <= 5; rarity++) {
                let rarecrew = crew.filter(f => f.max_rarity === rarity);
                if (rarecrew.length) {
                    colscore.details.rarity_datascores[rarity] = rarecrew.map(c => c.ranks.scores.overall).reduce((p, n) => p + n, 0) / rarecrew.length;
                }
            }
            let loot = col.milestones!.map(ms => (ms.buffs?.map(b => 5 * 3)?.reduce((p, n) => p + n, 0) ?? 0) + (ms.rewards?.map(r => r.rarity * (r.type === 1 ? 2 : 0.1))?.reduce((p, n) => p + n, 0) ?? 0));
            colscore.details.loot_score = Math.ceil(loot.reduce((p, n) => p + n, 0));

            let diff = col.milestones!.map(ms => ms.goal).reduce((p, n) => p + n, 0);
            diff *= colscore.details.average_rarity;

            colscore.details.difficulty = Math.ceil(diff * ((1 + nonportal.length) / (1 + portal.length)));
        }
        const {
            loot_score: ls,
            difficulty: diff
        } = colscore.details;

        colscore.score = (ls / diff);
    }
    col.score = colscore;
    return colscore;
}

export function scoreCollections(cols: Collection[], allcrew: CrewMember[]) {
    if (!cols.length) return;
    const scores = cols.map(col => scoreCollection(col, allcrew));
    scores.sort((a, b) => b.score - a.score);
    let shigh = scores[0].score;
    for (let sc of scores) {
        sc.score = Number((((sc.score / shigh)) * 100).toFixed(4));
    }

    // function normDeets(field: string, minus?: boolean) {
    //     scores.sort((a, b) => b.details[field] - a.details[field]);
    //     let dhigh = scores[0].details[field] as number;
    //     for (let sc of scores) {
    //         let val = sc.details[field] as number;
    //         if (minus) {
    //             val = Number(((1 - (val / dhigh)) * 100).toFixed(4));
    //         }
    //         else {
    //             val = Number((((val / dhigh)) * 100).toFixed(4));
    //         }
    //         sc.details[field] = val;
    //     }
    // }

    // normDeets('loot_score');
    // normDeets('difficulty', true);

    // Debug code
    let ncol = [...cols];
    ncol.sort((a, b) => b.score!.score - a.score!.score);
    for (let c of ncol) {
        console.log(`${c.name.padEnd(35)}`, `Score: ${c.score!.score}`.padEnd(18), `Difficulty: ${c.score!.details.difficulty}, `.padEnd(18), `Loot: ${c.score!.details.loot_score}`);

    }
}