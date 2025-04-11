import { potentialCols } from "../../website/src/components/stats/utils";
import { CrewMember } from "../../website/src/model/crew";
import { Collection } from "../../website/src/model/game-elements";
import { TraitNames } from "../../website/src/model/traits";

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
        let potential = potentialCols(crew, collections, TRAIT_NAMES);
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