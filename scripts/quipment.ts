import { ComputedSkill, CrewMember, PlayerSkill, QuipmentDetails, QuippedPower } from '../../website/src/model/crew';
import { BuffStatTable } from '../../website/src/utils/voyageutils';
import { EquipmentItem } from '../../website/src/model/equipment';
import { calcQLots, estimateChronitonCost } from '../../website/src/utils/equipment';
import { getPossibleQuipment, ItemWithBonus } from '../../website/src/utils/itemutils';
import CONFIG from '../../website/src/components/CONFIG';
import { applyCrewBuffs, skillSum } from '../../website/src/utils/crewutils';
import { normalize } from './normscores';

export interface QPowers extends QuipmentDetails {
    symbol: string;
}

const price_cache = {} as {[key:string]: number}

export function calcPrice(crew: CrewMember, quipment: EquipmentItem[], items: EquipmentItem[]): number {
    let possquip = getPossibleQuipment(crew, quipment);
    return (
        possquip.map(q => {
                if (price_cache[q.symbol]) return price_cache[q.symbol];
                let r = q.recipe?.list.map(rl => {
                    let item = items.find(f => f.symbol === rl.symbol);
                    if (!item) return rl.count;
                    if (item.type === 15) return rl.count;
                    if (item.factionOnly) return 10 * rl.count; // effort reflected here
                    return (estimateChronitonCost(item) * rl.count) || rl.count;
                })
                .reduce((p, n) => p + n, 0) ?? 0;
                price_cache[q.symbol] = r;
                return r;
            })
            .reduce((p, n) => p + n, 0)
    );
}

export function sortingQuipmentScoring(crew: CrewMember[], quipment: ItemWithBonus[], items: EquipmentItem[], buffs: BuffStatTable, alt?: boolean): QPowers[] {
    const resultindex = {} as { [key:string]: QPowers };
    const indices = {} as {[key:string]: { price: number, unit: number, mode: 'all' | 'proficiency' | 'core', value: string, score: number }[]};
    const modes = ['all', 'proficiency', 'core'] as ('all' | 'proficiency' | 'core')[];
    const powermaps = ['vpower', 'gpower', 'bpower'];
    const pricemaps = ['vprice', 'gprice', 'bprice'];
    const skills = Object.keys(CONFIG.SKILLS);

    function tiebreaker(a: CrewMember, b: CrewMember) {
        let askills = skillSum(Object.values(a.base_skills));
        let bskills = skillSum(Object.values(b.base_skills));
        let r = askills - bskills;
        if (!r) r = a.max_rarity - b.max_rarity;
        if (!r) r = a.name.localeCompare(b.name);
        return r;
    }

    function addModeScores(mode: 'all' | 'proficiency' | 'core') {
        skills.forEach((skill, index) => {
            sortCrewByQuipment(crew, false, skill, true, tiebreaker, alt);
            crew.forEach((c, idx) => {
                if (!c.best_quipment!.skill_quipment[skill]) return;
                indices[c.symbol] ??= [];
                indices[c.symbol].push({
                    price: calcPrice(c, c.best_quipment!.skill_quipment[skill], items),
                    unit: index,
                    mode,
                    value: skill,
                    score: idx + 1
                });
            });
        });
        [0, 1, 2].forEach((index) => {
            sortCrewByQuipment(crew, true, index, true, tiebreaker, alt);
            crew.forEach((c, idx) => {
                if (c.skill_order.length <= index) return;
                let skill = c.skill_order[index];
                indices[c.symbol] ??= [];
                indices[c.symbol].push({
                    price: calcPrice(c, c.best_quipment!.skill_quipment[skill], items),
                    unit: index,
                    mode,
                    value: `sko`,
                    score: idx + 1
                });
            });
        });
        [0, 1, 2, 3, 4].forEach((index) => {
            sortCrewByQuipment(crew, 2, index, true, tiebreaker, alt);
            crew.forEach((c, idx) => {
                const price = (() => {
                    if (index === 0) return c.best_quipment_1_2 ? calcPrice(c, Object.values(c.best_quipment_1_2!.skill_quipment).flat(), items) : 0;
                    else if (index === 1) return c.best_quipment_1_3 ? calcPrice(c, Object.values(c.best_quipment_1_3!.skill_quipment).flat(), items) : 0;
                    else if (index === 2) return c.best_quipment_2_3 ? calcPrice(c, Object.values(c.best_quipment_2_3!.skill_quipment).flat(), items) : 0;
                    else if (index === 3) return c.best_quipment_3 ? calcPrice(c, Object.values(c.best_quipment_3!.skill_quipment).flat(), items) : 0;
                    else if (index === 4) return c.best_quipment_top ? calcPrice(c, Object.values(c.best_quipment_top!.skill_quipment).flat(), items) : 0;
                    return 0;
                })();

                indices[c.symbol] ??= [];
                indices[c.symbol].push({
                    price,
                    unit: index,
                    mode,
                    value: `combo`,
                    score: idx + 1
                });
            });
        });
    }

    modes.forEach((mode) => {
        for (let c of crew) {
            calcQLots(c, quipment, buffs, true, undefined, mode);
        }
        addModeScores(mode);
    });

    const crew_syms = Object.keys(indices);
    const total = crew_syms.length;

    for (let c of crew_syms) {
        resultindex[c] = {
            qpower: 0,
            vpower: 0,
            gpower: 0,
            bpower: 0,
            avg: 0,
            symbol: c,
            qprice: 0,
            bprice: 0,
            vprice: 0,
            gprice: 0
        }
    }
    const c = powermaps.length;
    for (let sym of crew_syms) {
        for (let i = 0; i < c; i++) {
            let power = powermaps[i];
            let price = pricemaps[i];
            let score = 0;
            let avgprc = 0;
            for (let j = 0; j < c; j++) {
                let mode = modes[j];
                let data = indices[sym].filter(f => f.mode === mode);
                score += data.map(d => d.score).reduce((p, n) => p + n, 0) / data.length;
                avgprc += data.map(d => d.price).reduce((p, n) => p + n, 0) / data.length;
            }
            score /= c;
            avgprc /= c;
            resultindex[sym][power] += Number(((1 - (score / total)) * 100).toFixed(2));
            resultindex[sym][price] += Number((((avgprc / total)) * 100).toFixed(2));
        }
    }
    for (let c of crew_syms) {
        resultindex[c].qpower = powermaps.map(pm => resultindex[c][pm] as number).reduce((p, n) => p + n, 0);
        resultindex[c].qprice = pricemaps.map(pm => resultindex[c][pm] as number).reduce((p, n) => p + n, 0);
        resultindex[c].avg = powermaps.map(pm => resultindex[c][pm] as number).reduce((p, n) => p + n, 0) / powermaps.length;
    }

    return Object.values(resultindex);
}


export function scoreQuipment(crew: CrewMember, quipment: ItemWithBonus[], items: EquipmentItem[], buffs: BuffStatTable, skill_only?: string, alt?: boolean): QPowers {
    crew = {...crew };
    if (skill_only && skill_only in crew.base_skills) crew.skill_order = [skill_only];

    calcQLots(crew, quipment, buffs, true, undefined, 'all');
    let price_key = '';

    // Aggregate:
    let qpower = Object.values(crew.best_quipment!.aggregate_by_skill).reduce((p, n) => p + n, 0);
    let possquip = getPossibleQuipment(crew, Object.values(crew.best_quipment!.skill_quipment).flat() || []);
    let qprice = calcPrice(crew, possquip, items);

    // Voyage:
    let vpower = Object.values(crew.best_quipment!.aggregate_by_skill).reduce((p, n) => p > n ? p : n, 0);
    let ovpower = vpower;
    let pquips = {} as { [key: string]: EquipmentItem[] };
    vpower = [vpower, crew.best_quipment_1_2!, crew.best_quipment_1_3!, crew.best_quipment_2_3!, crew.best_quipment_3!, crew.best_quipment_top!].map(q => {
        let resp = !q ? 0 : typeof q === 'number' ? q : (alt ? qpDiff(crew, q) : q.aggregate_power);
        if (resp && !(typeof q === 'number')) {
            pquips[resp] = Object.values(q.skill_quipment).flat();
        }
        return resp;
    }).reduce((p, n) => p > n ? p : n, 0);
    if (vpower === ovpower || !pquips[vpower]) {
        price_key = Object.keys(crew.best_quipment!.aggregate_by_skill).find(f => crew.best_quipment!.aggregate_by_skill[f] === vpower)!
        possquip = getPossibleQuipment(crew, crew.best_quipment!.skill_quipment[price_key] || []);
    }
    else {
        possquip = getPossibleQuipment(crew, pquips[vpower] || []);
    }
    let vprice = calcPrice(crew, possquip, items);
    pquips = {};
    // Base:
    calcQLots(crew, quipment, buffs, true, undefined, 'core');
    let bpower = Object.values(crew.best_quipment!.aggregate_by_skill).reduce((p, n) => p > n ? p : n, 0);
    let obpower = bpower;
    bpower = [vpower, crew.best_quipment_1_2!, crew.best_quipment_1_3!, crew.best_quipment_2_3!, crew.best_quipment_3!, crew.best_quipment_top!].map(q => {
        let resp = !q ? 0 : typeof q === 'number' ? q : (alt ? qpDiff(crew, q) : q.aggregate_power);
        if (resp && !(typeof q === 'number')) {
            pquips[resp] = Object.values(q.skill_quipment).flat();
        }
        return resp;
    }).reduce((p, n) => p > n ? p : n, 0);
    if (bpower === obpower || !pquips[bpower]) {
        price_key = Object.keys(crew.best_quipment!.aggregate_by_skill).find(f => crew.best_quipment!.aggregate_by_skill[f] === bpower)!
        possquip = getPossibleQuipment(crew, crew.best_quipment!.skill_quipment[price_key] || []);
    }
    else {
        possquip = getPossibleQuipment(crew, pquips[bpower] || []);
    }
    let bprice = calcPrice(crew, possquip, items);
    pquips = {};
    // Proficiency:
    calcQLots(crew, quipment, buffs, true, undefined, 'proficiency');
    let gpower = Object.values(crew.best_quipment!.aggregate_by_skill).reduce((p, n) => p > n ? p : n, 0);
    let ogpower = gpower;
    gpower = [vpower, crew.best_quipment_1_2!, crew.best_quipment_1_3!, crew.best_quipment_2_3!, crew.best_quipment_3!, crew.best_quipment_top!].map(q => {
        let resp = !q ? 0 : typeof q === 'number' ? q : (alt ? qpDiff(crew, q) : q.aggregate_power);
        if (resp && !(typeof q === 'number')) {
            pquips[resp] = Object.values(q.skill_quipment).flat();
        }
        return resp;
    }).reduce((p, n) => p > n ? p : n, 0);
    if (gpower === ogpower || !pquips[gpower]) {
        price_key = Object.keys(crew.best_quipment!.aggregate_by_skill).find(f => crew.best_quipment!.aggregate_by_skill[f] === gpower)!
        possquip = getPossibleQuipment(crew, crew.best_quipment!.skill_quipment[price_key] || []);
    }
    else {
        possquip = getPossibleQuipment(crew, pquips[gpower] || []);
    }

    let gprice = calcPrice(crew, possquip, items);
    pquips = {};

    return { qpower, vpower, bpower, gpower, avg: 0, symbol: crew.symbol, qprice, vprice, bprice, gprice };
}


export function sortCrewByQuipment(roster: CrewMember[], pstMode: boolean | 2 | 3, index: number | string, reverse?: boolean, tiebreaker?: (a: CrewMember, b: CrewMember) => number, alt?: boolean) {
	const mul = reverse ? -1 : 1;
	if (pstMode === true && typeof index === 'number') {
		roster.sort((a, b) => mul * skoComp(a, b, index, alt) || (tiebreaker ? (mul * tiebreaker(a, b)) : 0));
	}
	else if (pstMode === 2 && typeof index === 'number') {
		roster.sort((a, b) => mul * multiComp(a, b, index, alt) || (tiebreaker ? (mul * tiebreaker(a, b)) : 0));
	}
	else if (typeof index === 'string') {
		roster.sort((a, b) => mul * qpComp(a, b, index, alt) || (tiebreaker ? (mul * tiebreaker(a, b)) : 0));
	}
}

export function qpComp(a: CrewMember, b: CrewMember, skill: string, alt?: boolean) {
    if (!a.best_quipment!.aggregate_by_skill[skill]) return -1;
    else if (!b.best_quipment!.aggregate_by_skill[skill]) return 1;
    else {
        if (alt) {
            return qpDiff(a, a.best_quipment!, [skill] as PlayerSkill[]) - qpDiff(b, b.best_quipment!, [skill] as PlayerSkill[]);
        }
        return a.best_quipment!.aggregate_by_skill[skill] - b.best_quipment!.aggregate_by_skill[skill];
    }
};

export function skoComp(a: CrewMember, b: CrewMember, skill_idx: number, alt?: boolean) {
    if (skill_idx >= a.skill_order.length) {
        return -1;
    }
    else if (skill_idx >= b.skill_order.length) {
        return 1;
    }
    else {
        if (alt) {
            return qpDiff(a, a.best_quipment!, [a.skill_order[skill_idx]] as PlayerSkill[]);
        }
        return a.best_quipment!.aggregate_by_skill[a.skill_order[skill_idx]] - b.best_quipment!.aggregate_by_skill[b.skill_order[skill_idx]];
    }
};

export function multiComp(a: CrewMember, b: CrewMember, combo_id: number, alt?: boolean) {
    if (combo_id === 0) {
        if (a.best_quipment_1_2 && b.best_quipment_1_2) {
            if (alt) {
                return qpDiff(a, a.best_quipment_1_2) - qpDiff(b, b.best_quipment_1_2);
            }
            return a.best_quipment_1_2.aggregate_power - b.best_quipment_1_2.aggregate_power;
        }
        else if (a.best_quipment_1_2) {
            return 1;
        }
        else if (b.best_quipment_1_2) {
            return -1;
        }
    }
    else if (combo_id === 1) {
        if (a.best_quipment_1_3 && b.best_quipment_1_3) {
            if (alt) {
                return qpDiff(a, a.best_quipment_1_3) - qpDiff(b, b.best_quipment_1_3);
            }
            return a.best_quipment_1_3.aggregate_power - b.best_quipment_1_3.aggregate_power;
        }
        else if (a.best_quipment_1_3) {
            return 1;
        }
        else if (b.best_quipment_1_3) {
            return -1;
        }
    }
    else if (combo_id === 2) {
        if (a.best_quipment_2_3 && b.best_quipment_2_3) {
            if (alt) {
                return qpDiff(a, a.best_quipment_2_3) - qpDiff(b, b.best_quipment_2_3);
            }
            return a.best_quipment_2_3.aggregate_power - b.best_quipment_2_3.aggregate_power;
        }
        else if (a.best_quipment_2_3) {
            return 1;
        }
        else if (b.best_quipment_2_3) {
            return -1;
        }
    }
    else if (combo_id === 3) {
        if (a.best_quipment_3 && b.best_quipment_3) {
            if (alt) {
                return qpDiff(a, a.best_quipment_3) - qpDiff(b, b.best_quipment_3);
            }
            return a.best_quipment_3.aggregate_power - b.best_quipment_3.aggregate_power;
        }
        else if (a.best_quipment_3) {
            return 1;
        }
        else if (b.best_quipment_3) {
            return -1;
        }
    }
    else if (combo_id === 4) {
        if (a.best_quipment_top && b.best_quipment_top) {
            if (alt) {
                return qpDiff(a, a.best_quipment_top) - qpDiff(b, b.best_quipment_top);
            }
            return a.best_quipment_top.aggregate_power - b.best_quipment_top.aggregate_power;
        }
        else if (a.best_quipment_top) {
            return 1;
        }
        else if (b.best_quipment_top) {
            return -1;
        }
    }

    return 0;
};

export function skillQP(crew: CrewMember, skill: string) {
    if (crew.best_quipment?.aggregate_by_skill) {
        return crew.best_quipment.aggregate_by_skill[skill] as number | undefined || 0;
    }
    return 0;
}

export function qpDiff(crew: CrewMember, qp: QuippedPower, skills?: PlayerSkill[], mode: 'all' | 'core' | 'proficiency' = 'all', buffs?: BuffStatTable, pre_buffed = true, no_copy = true) {
    let comp: ComputedSkill[] = [];
    if (!skills) skills = Object.keys(qp.aggregate_by_skill) as PlayerSkill[];
    if (buffs || pre_buffed) {
        if (!no_copy && buffs && !pre_buffed) crew = structuredClone(crew);
        if (buffs && !pre_buffed) applyCrewBuffs(crew, buffs);
        Object.entries(crew.base_skills).forEach(([key, value]) => {
            if (mode === 'all') {
                comp.push(crew[key]);
            }
            else if (mode === 'core') {
                comp.push({
                    core: crew[key].core,
                    min: 0,
                    max: 0,
                    skill: key
                });
            }
            else if (mode === 'proficiency') {
                comp.push({
                    core: 0,
                    min: crew[key].min,
                    max: crew[key].max,
                    skill: key
                });
            }

        });
    }
    else {
        Object.entries(crew.base_skills).forEach(([key, value]) => {
            let obj = {
                core: 0,
                min: 0,
                max: 0,
                skill: key
            };
            comp.push(obj);
            if (mode !== 'proficiency') {
                obj.core = crew.base_skills[key].core;
            }
            if (mode !== 'core') {
                obj.max = crew.base_skills[key].range_max;
                obj.min = crew.base_skills[key].range_min;
            }
        });
    }
    if (skills?.length) {
        let qptotal = skills.map(skill => qp.aggregate_by_skill[skill]).reduce((p, n) => p + n, 0);
        let crtotal = skills.map(skill => skillSum(comp.find(f => f.skill === skill)!)).reduce((p, n) => p + n, 0);
        return qptotal / crtotal;
    }
    else {
        return 0;
    }
}

// export function normalizeQPowers(qpowers: QPowers[]) {
//     let keys = ['qpower', 'vpower', 'bpower', 'gpower', 'qprice', 'vprice', 'bprice', 'gprice'];
//     for (let key of keys) {
//         let sortable = qpowers.map(m => {
//             return {
//                 symbol: m.symbol,
//                 score: m[key] as number
//             }
//         });
//         normalize(sortable, key.endsWith('price'));
//         qpowers.forEach(m => {
//             let res = sortable.find(f => f.symbol === m.symbol)!;
//             m[key] = res.score;
//         });
//     }
// }