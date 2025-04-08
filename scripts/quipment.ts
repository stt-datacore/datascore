import { CrewMember, QuipmentDetails } from '../../website/src/model/crew';
import { BuffStatTable } from '../../website/src/utils/voyageutils';
import { EquipmentItem } from '../../website/src/model/equipment';
import { calcQLots } from '../../website/src/utils/equipment';
import { getPossibleQuipment, ItemWithBonus } from '../../website/src/utils/itemutils';

export interface QPowers extends QuipmentDetails {
    symbol: string;
}


export function sortingQuipmentScoring(crew: CrewMember[], quipment: ItemWithBonus[], buffs: BuffStatTable): QPowers[] {
    const results = [] as QPowers[];




    return results;
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
