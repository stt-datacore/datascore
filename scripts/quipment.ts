import { CrewMember, QuipmentDetails } from '../../website/src/model/crew';
import { BuffStatTable } from '../../website/src/utils/voyageutils';
import { EquipmentItem } from '../../website/src/model/equipment';
import { calcQLots, sortCrewByQuipment } from '../../website/src/utils/equipment';
import { getPossibleQuipment, ItemWithBonus } from '../../website/src/utils/itemutils';
import CONFIG from '../../website/src/components/CONFIG';
import { skillSum } from '../../website/src/utils/crewutils';

export interface QPowers extends QuipmentDetails {
    symbol: string;
}

export function calcPrice(crew: CrewMember, quipment: EquipmentItem[]): number {
    let possquip = getPossibleQuipment(crew, quipment);
    return possquip.map(q => q.recipe?.list.map(rl => rl.count).reduce((p, n) => p + n, 0) ?? 0).reduce((p, n) => p + n, 0);
}

export function sortingQuipmentScoring(crew: CrewMember[], quipment: ItemWithBonus[], buffs: BuffStatTable): QPowers[] {
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
            sortCrewByQuipment(crew, false, skill, true, tiebreaker);
            crew.forEach((c, idx) => {
                if (!c.best_quipment!.skill_quipment[skill]) return;
                indices[c.symbol] ??= [];
                indices[c.symbol].push({
                    price: calcPrice(c, c.best_quipment!.skill_quipment[skill]),
                    unit: index,
                    mode,
                    value: skill,
                    score: idx + 1
                });
            });
        });
        [0, 1, 2].forEach((index) => {
            sortCrewByQuipment(crew, true, index, true, tiebreaker);
            crew.forEach((c, idx) => {
                if (c.skill_order.length <= index) return;
                let skill = c.skill_order[index];
                indices[c.symbol] ??= [];
                indices[c.symbol].push({
                    price: calcPrice(c, c.best_quipment!.skill_quipment[skill]),
                    unit: index,
                    mode,
                    value: `sko`,
                    score: idx + 1
                });
            });
        });
        [0, 1, 2, 3, 4].forEach((index) => {
            sortCrewByQuipment(crew, 2, index, true, tiebreaker);
            crew.forEach((c, idx) => {
                const price = (() => {
                    if (index === 0) return c.best_quipment_1_2 ? calcPrice(c, Object.values(c.best_quipment_1_2!.skill_quipment).flat()) : 0;
                    else if (index === 1) return c.best_quipment_1_3 ? calcPrice(c, Object.values(c.best_quipment_1_3!.skill_quipment).flat()) : 0;
                    else if (index === 2) return c.best_quipment_2_3 ? calcPrice(c, Object.values(c.best_quipment_2_3!.skill_quipment).flat()) : 0;
                    else if (index === 3) return c.best_quipment_3 ? calcPrice(c, Object.values(c.best_quipment_3!.skill_quipment).flat()) : 0;
                    else if (index === 4) return c.best_quipment_top ? calcPrice(c, Object.values(c.best_quipment_top!.skill_quipment).flat()) : 0;
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
    for (let i = 0; i < c; i++) {
        let power = powermaps[i];
        let mode = modes[i];
        let price = pricemaps[i];

        for (let c of crew_syms) {
            let data = indices[c].filter(f => f.mode === mode);
            let score = data.map(d => d.score).reduce((p, n) => p + n, 0) / data.length;
            let avgprc = data.map(d => d.price).reduce((p, n) => p + n, 0) / data.length;
            resultindex[c][power] = Number(((1 - (score / total))* 100).toFixed(2));
            resultindex[c][price] = Number(((1 - (avgprc / total))* 100).toFixed(2));
        }
    }

    for (let c of crew_syms) {
        resultindex[c].qpower = powermaps.map(pm => resultindex[c][pm] as number).reduce((p, n) => p + n, 0);
        resultindex[c].qprice = pricemaps.map(pm => resultindex[c][pm] as number).reduce((p, n) => p + n, 0);
        resultindex[c].avg = powermaps.map(pm => resultindex[c][pm] as number).reduce((p, n) => p + n, 0) / powermaps.length;
    }

    return Object.values(resultindex);
}


export function scoreQuipment(crew: CrewMember, quipment: ItemWithBonus[], buffs: BuffStatTable): QPowers {
    calcQLots(crew, quipment, buffs, true, undefined, 'all');
    let price_key = '';

    // Aggregate:
    let qpower = Object.values(crew.best_quipment!.aggregate_by_skill).reduce((p, n) => p + n, 0);
    let possquip = getPossibleQuipment(crew, Object.values(crew.best_quipment!.skill_quipment).flat());
    let qprice = possquip.map(q => q.recipe?.list.map(rl => rl.count).reduce((p, n) => p + n, 0) ?? 0).reduce((p, n) => p + n, 0);

    // Voyage:
    let vpower = Object.values(crew.best_quipment!.aggregate_by_skill).reduce((p, n) => p > n ? p : n, 0);
    let ovpower = vpower;
    let pquips = {} as { [key: string]: EquipmentItem[] };
    vpower = [vpower, crew.best_quipment_1_2!, crew.best_quipment_1_3!, crew.best_quipment_2_3!, crew.best_quipment_3!, crew.best_quipment_top!].map(q => {
        let resp = !q ? 0 : typeof q === 'number' ? q : q.aggregate_power;
        if (resp && !(typeof q === 'number')) {
            pquips[resp] = Object.values(q.skill_quipment).flat();
        }
        return resp;
    }).reduce((p, n) => p > n ? p : n, 0);
    if (vpower === ovpower) {
        price_key = Object.keys(crew.best_quipment!.aggregate_by_skill).find(f => crew.best_quipment!.aggregate_by_skill[f] === vpower)!
        possquip = getPossibleQuipment(crew, crew.best_quipment!.skill_quipment[price_key]);
    }
    else {
        possquip = getPossibleQuipment(crew, pquips[vpower]);
    }
    let vprice = possquip.map(q => q.recipe?.list.map(rl => rl.count).reduce((p, n) => p + n, 0) ?? 0).reduce((p, n) => p + n, 0);

    // Base:
    calcQLots(crew, quipment, buffs, true, undefined, 'core');
    let bpower = Object.values(crew.best_quipment!.aggregate_by_skill).reduce((p, n) => p > n ? p : n, 0);
    let obpower = bpower;
    bpower = [vpower, crew.best_quipment_1_2!, crew.best_quipment_1_3!, crew.best_quipment_2_3!, crew.best_quipment_3!, crew.best_quipment_top!].map(q => {
        let resp = !q ? 0 : typeof q === 'number' ? q : q.aggregate_power;
        if (resp && !(typeof q === 'number')) {
            pquips[resp] = Object.values(q.skill_quipment).flat();
        }
        return resp;
    }).reduce((p, n) => p > n ? p : n, 0);
    if (bpower === obpower) {
        price_key = Object.keys(crew.best_quipment!.aggregate_by_skill).find(f => crew.best_quipment!.aggregate_by_skill[f] === bpower)!
        possquip = getPossibleQuipment(crew, crew.best_quipment!.skill_quipment[price_key]);
    }
    else {
        possquip = getPossibleQuipment(crew, pquips[bpower]);
    }
    let bprice = possquip.map(q => q.recipe?.list.map(rl => rl.count).reduce((p, n) => p + n, 0) ?? 0).reduce((p, n) => p + n, 0);

    // Proficiency:
    calcQLots(crew, quipment, buffs, true, undefined, 'proficiency');
    let gpower = Object.values(crew.best_quipment!.aggregate_by_skill).reduce((p, n) => p > n ? p : n, 0);
    let ogpower = gpower;
    gpower = [vpower, crew.best_quipment_1_2!, crew.best_quipment_1_3!, crew.best_quipment_2_3!, crew.best_quipment_3!, crew.best_quipment_top!].map(q => {
        let resp = !q ? 0 : typeof q === 'number' ? q : q.aggregate_power;
        if (resp && !(typeof q === 'number')) {
            pquips[resp] = Object.values(q.skill_quipment).flat();
        }
        return resp;
    }).reduce((p, n) => p > n ? p : n, 0);
    if (gpower === ogpower) {
        price_key = Object.keys(crew.best_quipment!.aggregate_by_skill).find(f => crew.best_quipment!.aggregate_by_skill[f] === gpower)!
        possquip = getPossibleQuipment(crew, crew.best_quipment!.skill_quipment[price_key]);
    }
    else {
        possquip = getPossibleQuipment(crew, pquips[gpower]);
    }
    let gprice = possquip.map(q => q.recipe?.list.map(rl => rl.count).reduce((p, n) => p + n, 0) ?? 0).reduce((p, n) => p + n, 0);

    return { qpower, vpower, bpower, gpower, avg: 0, symbol: crew.symbol, qprice, vprice, bprice, gprice };
}
