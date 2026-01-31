import CONFIG from "../../../website/src/components/CONFIG";
import { BossShip } from "../../../website/src/model/boss";
import { BossDetails, CrewMember, ShipScores } from "../../../website/src/model/crew";
import { BattleStation, Ship, ShipAction } from "../../../website/src/model/ship";
import { AllBosses, DEFENSE_ABILITIES, DEFENSE_ACTIONS, getBosses, getCrewDivisions, getShipDivision, OFFENSE_ABILITIES, OFFENSE_ACTIONS } from "../../../website/src/utils/shiputils";
import { getOverlap } from "../../../website/src/workers/battleworkerutils";
import { normalize } from "../normscores";

const BossRarities = {} as {[key:string]: number};
for (let boss of AllBosses) {
    BossRarities[boss.id] = boss.rarity;
}
export function getMaxTime(crew: CrewMember) {
    if (!crew.action.limit) return 180;
    let t = crew.action.initial_cooldown;
    t += (crew.action.limit * crew.action.duration);
    if (crew.action.limit > 1) {
        t += ((crew.action.limit - 1) * crew.action.cooldown);
    }
    return t;
}

export interface SymbolScore {
    symbol: string,
    score: number,
    count: number,
    division: number
    damage: number,
    crew: string[]
}

export type ShipCompat = {
    score: number,
    trigger: boolean,
    seat: boolean
};

export interface Scoreable {
    group: number,
    average_index: number,
    count: number,
    final: number;

    max_damage: number,
    min_damage: number,
    average_damage: number,
    total_damage: number;

    max_compat: number,
    min_compat: number,
    average_compat: number
    total_compat: number;

    max_hit: number,
    min_hit: number,
    total_hit: number;
    average_hit: number,

    median_index: number,
    min_index: number,

    win_count: number,

    duration: number;
    max_duration: number;

    opponent: string;
}

export interface ScoreTotal extends Scoreable {
    max_ship: string,
    max_staff: string[],
    min_ship: string,
    min_staff: string[],
    max_duration_ship: string,
    max_duration_staff: string[],
    original_indices: number[];
    compat: string[];
    incompat: string[];
    opponent: string;
}

export interface Score {
    fbb_data: ScoreTotal[];
    arena_data: ScoreTotal[];

    kind: 'crew' | 'ship';
    type: 'defense' | 'offense',

    name: string;
    symbol: string;

    arena: number;
    arena_final: number;
    fbb: number;
    fbb_final: number;
    overall_final: number;
    overall: number;
    overall_rank?: number;
    arena_rank?: number;
    fbb_rank?: number;
}

export interface BattleRunBase {
    crew: any;
    ship: Ship;
    boss?: BossShip;
    division?: number;
    opponent?: Ship;
    damage: number;
    incoming: number;
    duration: number;
    seated: string[];
    compatibility: ShipCompat,
    limit: number,
    battle: 'arena' | 'fbb',
    type: 'defense' | 'offense',
    win: boolean,
    reference_battle?: boolean;
}

export interface BattleRun extends BattleRunBase {
    crew: CrewMember;
    ship: Ship;
    boss?: BossShip;
    division?: number;
    opponent?: Ship;
    damage: number;
    duration: number;
    seated: string[];
    compatibility: ShipCompat,
    limit: number,
    battle: 'arena' | 'fbb',
    type: 'defense' | 'offense',
    win: boolean,
    reference_battle: false;
}

export interface BattleRunRef extends BattleRunBase {
    crew: undefined,
    reference_battle: true;
}

export interface BattleRunCache {
    crew: string;
    ship: string;
    boss?: number;
    opponent?: string;
    division?: number;
    damage: number;
    incoming: number;
    duration: number;
    seated: string[];
    compatibility: ShipCompat,
    limit: number,
    battle: 'arena' | 'fbb',
    type: 'defense' | 'offense',
    win: boolean,
    version: number,
    reference_battle: boolean;
}

export type ScoreDataConfig = {
    crew: CrewMember[],
    ships: Ship[],
    arenaruns: BattleRunBase[],
    fbbruns: BattleRunBase[],
    crewscores: Score[],
    shipscores: Score[],
    trigger_compat: boolean,
    seat_compat: boolean,
    bypass_crew?: boolean
}

export function createScore(kind: 'crew' | 'ship', symbol: string, type: 'offense' | 'defense') {
    return {
        kind,
        symbol,
        name: '',
        arena: 0,
        arena_final: 0,
        fbb: 0,
        fbb_final: 0,
        overall: 0,
        overall_final: 0,
        fbb_data: [],
        arena_data: [],
        type
    } as Score;
}

export function getScore(score: Score, type: 'fbb' | 'arena', group: number) {
    if (type === 'fbb') {
        let s = score.fbb_data.find(f => f.group === group);
        if (s) return s;
    }
    else {
        let s = score.arena_data.find(f => f.group === group);
        if (s) return s;
    }
    return addScore(score, type, group);
}

export function addScore(score: Score, type: 'fbb' | 'arena', group: number) {
    const newobj = {
        group,
        average_index: 0,
        count: 0,
        final: 0,
        max_ship: '',
        max_staff: [],
        max_damage: 0,
        median_index: 0,
        win_count: 0,
        total_damage: 0,
        total_compat: 0,
        duration: 0,
        min_ship: '',
        min_staff: [],
        min_damage: 0,
        average_damage: 0,
        original_indices: [],
        min_compat: 0,
        max_compat: 0,
        average_compat: 0,
        compat: [],
        incompat: [],
        max_duration: 0,
        max_duration_ship: '',
        max_duration_staff: [],
        min_index: 0,
        opponent: '',
        max_hit: 0,
        min_hit: 0,
        average_hit: 0,
        total_hit: 0
    } as ScoreTotal;

    if (type === 'fbb') {
        score.fbb_data.push(newobj);
    }
    else {
        score.arena_data.push(newobj);
    }

    return newobj
}


export const shipnum = (ship: Ship) => (ship.hull - (ship.attack * ship.attacks_per_second)) / (ship.hull + (ship.attack * ship.attacks_per_second));

export const characterizeCrew = (crew: CrewMember) => {
    let ability = crew.action.ability?.type;
    let action = crew.action.bonus_type;
    const result = {
        offense: 0,
        defense: 0
    }
    if (ability) {
        if (OFFENSE_ABILITIES.includes(ability)) result.offense++;
        if (DEFENSE_ABILITIES.includes(ability)) result.defense++;
    }
    if (result.defense > result.offense) return -1;

    if (OFFENSE_ACTIONS.includes(action)) result.offense++;
    if (DEFENSE_ACTIONS.includes(action)) result.defense++;

    if (result.defense > result.offense) return -1;
    else return 1;
}

export const shipCompatibility = (ship: Ship, crew: CrewMember, used_seats?: string[]) => {
    let compat = 0;
    let trigger = false;
    let seat = false;
    if (!ship.battle_stations) return { score: 1, trigger: false, seat: false };

    let bs = [...ship.battle_stations];

    if (used_seats) {
        for (let u of used_seats) {
            let x = bs.findIndex(b => b.skill === u);
            if (x >= 0) {
                bs.splice(x, 1);
            }
        }
    }

    if (bs.some(bs => crew.skill_order.includes(bs.skill))) {
        seat = true;
        if (crew.action.ability?.condition) {
            compat += 0.25;
        }
        else {
            compat += 1;
        }
    }

    if (crew.action.ability?.condition) {
        if (ship.actions?.some(a => a.status == crew.action.ability?.condition)) {
            compat += 0.75;
            trigger = true;
        }
    }
    return { score: compat, trigger, seat } as ShipCompat;
}



export const getStaffedShip = (ships: Ship[], crew: CrewMember[], ship: string | Ship, fbb: false | 1 | 2 | 3 | 4, offs?: Score[], defs?: Score[], c?: CrewMember, no_sort = false, opponent?: Ship, prefer_oppo_time = false, typical_cd = 8) => {
    let data = typeof ship === 'string' ? ships.find(f => f.symbol === ship) : ships.find(f => f.symbol === ship.symbol);
    if (!data?.battle_stations?.length) return undefined;
    data = { ...data } as Ship;

    const actualPower = (a: ShipAction) => {
        if (a.ability?.type === 0) {
            return a.bonus_amount + a.ability.amount;
        }
        return a.bonus_amount;
    }
    // if (data.name === 'IKS Bortas') {
    //     console.log("break");
    // }
    let division = getShipDivision(data.rarity);
    //crew = crew.filter(f => getCrewDivisions(f.max_rarity).includes(division));
    let boss = fbb ? (opponent || getBosses(data).sort((a, b) => b.rarity - a.rarity)[0]) as BossShip : undefined;
    data.battle_stations = JSON.parse(JSON.stringify(data.battle_stations)) as BattleStation[];
    let dataskills = data.battle_stations.map(m => m.skill).filter(f => !!f);
    let cloak_time = 0;
    let oppo_time = 0;

    let cloak = data.actions?.find(act => act.status === 2);

    if (cloak && !fbb && cloak.initial_cooldown <= 4) {
        let others = data.actions!.filter(f => f.status !== 2).map(mp => mp.initial_cooldown).filter(c => c > cloak.initial_cooldown).sort((a, b) => a - b);
        let ot = -1;
        if (others.length) ot = others[0];
        cloak_time = (cloak.initial_cooldown + cloak.duration);
        if (ot !== -1 && ot < cloak_time) cloak_time = ot;
    }

    if (opponent && !fbb) {
        let others = opponent.actions?.filter(f => f.initial_cooldown <= typical_cd && f.bonus_type === 0 || f?.ability?.type === 1 || f?.ability?.type === 5).sort((a, b) => a.initial_cooldown - b.initial_cooldown);
        if (others?.length) {
            oppo_time = others[0].initial_cooldown;
            if (others[0].ability?.type === 10) oppo_time = Math.min(typical_cd - others[0].ability.amount, oppo_time);
        }
    }

    let conds = data?.actions?.map(mp => mp.status).filter(f => f) as number[] ?? [];
    let skills = data.battle_stations?.map(b => b.skill);


    function compac(a: ShipAction, c: ShipAction) {
        return getOverlap(a, c);
    }

    let cs = [] as CrewMember[];
    let filt = 0;
    while (cs.length < skills.length) {
        if (filt && prefer_oppo_time) prefer_oppo_time = false;
        else if (filt && cloak_time) cloak_time = 0;
        else if (filt) {
            cs = crew;
            break;
        }
        filt++;

        cs = crew.filter(cc =>
            (c && c.symbol === cc.symbol) ||
            (
                (
                    (!prefer_oppo_time && (!cloak_time || cc.action.initial_cooldown >= cloak_time)) ||
                    (prefer_oppo_time && (!oppo_time || cc.action.initial_cooldown <= oppo_time))
                ) &&
                (
                    (fbb && boss && getBosses(data, cc)?.includes(boss)) ||
                    (!fbb && getCrewDivisions(cc.max_rarity).includes(division))
                ) &&
                (
                    !cc.action.ability?.condition || conds.includes(cc.action.ability.condition)
                )
            )
        );
    }

    let filtered: CrewMember[] = [];

    if (offs && defs) {
        let dmg = offs.map(c2 => cs.find(csf => csf.symbol === c2.symbol)).filter(f => !!f && (!fbb || !f.action.limit)) as CrewMember[];
        let repair = defs.map(c2 => cs.find(csf => csf.symbol === c2.symbol)).filter(f => !!f && (!fbb || !f.action.limit)) as CrewMember[];

        filtered = dmg.concat(repair);
    }
    else {
        filtered = [...cs];
    }

    if (!no_sort) {
        filtered.sort((a, b) => {
            if (c && c.symbol === a.symbol) return -1;
            if (c && c.symbol === b.symbol) return 1;

            if (a.action?.ability?.type === 1 && b.action?.ability?.type === 1) {
                if (a.action.ability.condition && a.action.ability.condition === b.action?.ability?.condition) {
                    let fn = data.actions!.find(f => f.status === a.action.ability!.condition)!;
                    let abn = compac(a.action, fn);
                    let bbn = compac(b.action, fn);
                    let r = bbn - abn;
                    if (r) return r;
                }
                let amet = (a.action.ability.amount / (fbb ? a.action.cycle_time : a.action.initial_cooldown)) * actualPower(a.action);
                let bmet = (b.action.ability.amount / (fbb ? b.action.cycle_time : b.action.initial_cooldown)) * actualPower(b.action);
                return bmet - amet;
            }
            else if (a.action?.ability?.type === 1) {
                return -1;
            }
            else if (b.action?.ability?.type === 1) {
                return 1;
            }

            let r = 0;
            r = b.max_rarity - a.max_rarity;
            if (r) return r;
            if (a.action.ability?.type === b.action.ability?.type && a.action.ability?.type === 2 && a.action.ability?.amount === b.action.ability?.amount) {
                r = ((a.action.cooldown + a.action.duration) - (b.action.cooldown + b.action.duration));
            }
            if (opponent) {
                if (a.action.ability && a.action.ability?.type === b.action?.ability?.type) {
                    let amet = (a.action.ability.amount / a.action.initial_cooldown) * actualPower(a.action);
                    let bmet = (b.action.ability.amount / b.action.initial_cooldown) * actualPower(b.action);
                    r =  bmet - amet;
                }

                if (!r) r = a.action.initial_cooldown - b.action.initial_cooldown ||
                    (a.action.ability?.type ?? 99) - (b.action.ability?.type ?? 99) ||
                    (b.action.ability?.amount ?? 0) - (a.action.ability?.amount ?? 0) ||
                    a.action.bonus_type - b.action.bonus_type ||
                    actualPower(b.action) - actualPower(a.action);
            }
            else {
                if (!r) r = (a.action.ability?.type ?? 99) - (b.action.ability?.type ?? 99) ||
                    (b.action.ability?.amount ?? 0) - (a.action.ability?.amount ?? 0) ||
                    a.action.bonus_type - b.action.bonus_type ||
                    actualPower(b.action) - actualPower(a.action) ||
                    a.action.initial_cooldown - b.action.initial_cooldown;
            }
            if (!r) {
                if (fbb && b.ranks?.scores?.ship?.fbb && a.ranks?.scores?.ship?.fbb) {
                    r = b.ranks.scores.ship.fbb - a.ranks.scores.ship.fbb;
                }
                else if (b.ranks?.scores?.ship?.arena && a.ranks?.scores?.ship?.arena) {
                    r = b.ranks.scores.ship.arena - a.ranks.scores.ship.arena;
                }
            }
            return r;
        });
    }

    let used = [] as string[];
    let ct = 0;
    let full = data.battle_stations.length;
    let filled = 0;
    let need_crit = 0;
    let need_boom = 0;
    let need_hr = 0;
    let crit = 0;
    let boom = 0;
    let hr = 0;
    let evasion_needed = !!fbb && fbb >= 3;

    if (evasion_needed) {
        if (fbb === 3) fbb = 1;
        if (fbb === 4) fbb = 2;
    }

    let bonus_power = 99;
    let bonus_check = -1;

    if (full === 1) {
        if (fbb) {
            need_hr = 1;
        }
        else {
            need_boom = 1;
        }
    }
    else if (full === 2) {
        if (fbb) {
            need_hr = 2;
        }
        else {
            need_boom = 1;
            need_crit = 1;
        }
    }
    else if (full === 3) {
        if (fbb) {
            need_hr = 2;
            need_boom = 1;
        }
        else {
            need_boom = 2;
            need_crit = 1;
        }
    }
    else if (full === 4) {
        if (fbb) {
            need_boom = 1;
            need_crit = 1;
            need_hr = fbb;
        }
        else {
            need_boom = 3;
            need_crit = 1;
        }
    }

    if (c) {
        if (c.action.ability?.type === 2) {
            need_hr -= 1;
        }
        else if (c.action.ability?.type === 1) {
            need_boom -= 1;
        }
        else if (c.action.ability?.type === 5) {
            need_crit -= 1;
        }
        if (c.action.bonus_type === 0) {
            bonus_power = actualPower(c.action);
            bonus_check = c.action.bonus_type;
        }
    }

    let ignore_skill = false;

    if (evasion_needed) {
        filtered.sort((a, b) => {
            if (
                (!a.action.ability || [0, 2, 3].includes(a.action.ability.type)) &&
                (!b.action.ability || [0, 2, 3].includes(b.action.ability.type))
            ) {
                let tdiff = (a.action.ability?.type ?? 99) - (b.action.ability?.type ?? 99);
                if (tdiff) return tdiff;
                if (a.action.bonus_type === 1 && b.action.bonus_type === 1) {
                    return (actualPower(b.action) - actualPower(a.action));
                }
                else if (a.action.bonus_type === 1) return -1;
                else if (b.action.bonus_type === 1) return 1;
            }
            return a.action.bonus_type - b.action.bonus_type || (a.action.ability?.type ?? 99) - (b.action.ability?.type ?? 99) || actualPower(b.action) - actualPower(a.action);
        });
    }

    for (let pass = 0; pass < 4; pass++) {
        if (pass == 1 || pass == 3) {
            if (filled === full) break;
            ignore_skill = true;
        }
        else {
            if (filled === full) break;
            ignore_skill = false;
        }

        ct = 0;
        for (let bs of data.battle_stations) {
            if (bs.crew) continue;

            let d1 = filtered.find(f => {
                if (f.action.ability?.condition && !pass && !(f.action?.bonus_type === 1 && evasion_needed)) return false;
                if (((!ignore_skill && !f.skill_order.some(s => bs.skill === s)) || used.includes(f.symbol))) return false;
                if (c && c.symbol === f.symbol) return true;
                if (c && pass === 0) {
                    if (f.action.bonus_type === bonus_check) {
                        if (f.action.bonus_amount > bonus_power) return false;
                    }
                }
                if (f.action.ability?.type === 1 && (boom < need_boom || pass > 1)) {
                    boom++;
                    return true;
                }
                else if (f.action.ability?.type === 5 && (crit < need_crit || pass > 1)) {
                    crit++;
                    return true;
                }
                else if ((!evasion_needed || pass > 1) && f.action.ability?.type === 2 && hr < need_hr) {
                    hr++;
                    return true;
                }
                else if ((evasion_needed || pass > 1) && f.action.ability?.type === 0 && f.action.bonus_type === 1 && hr < need_hr) {
                    hr++;
                    return true;
                }
                else if (pass === 3) {
                    return true;
                }
                return false;
            });
            if (d1) {
                filled++;
                bs.crew = d1;
                used.push(d1.symbol);
            }

            ct++;
        }
    }

    return data;
}

export function createBlankShipScore(kind: 'offense' | 'defense' | 'ship' = 'offense') {
    return {
        kind,
        overall: 0,
        arena: 0,
        fbb: 0,
        divisions: {
            fbb: {},
            arena: {}
        }
    } as ShipScores;
}

export function scoreToShipScore(score: Score, kind: 'offense' | 'defense' | 'ship'): ShipScores {

    if (Number.isNaN(score.overall_final) || score.fbb_final == Infinity) {
        score.overall_final = 0;
    }
    if (Number.isNaN(score.arena_final) || score.fbb_final == Infinity) {
        score.arena_final = 0;
    }
    if (Number.isNaN(score.fbb_final) || score.fbb_final == Infinity) {
        score.fbb_final = 0;
    }

    const result: ShipScores = {
        kind,
        overall: score.overall_final,
        arena: score.arena_final,
        fbb: score.fbb_final,
        divisions: {
            fbb: {},
            arena: {},
            fbb_crew: {},
            arena_crew: {}
        },
        boss_details: [],
        bosses: [],
        overall_rank: score.overall_rank ?? 0,
        arena_rank: score.arena_rank ?? 0,
        fbb_rank: score.fbb_rank ?? 0
    }

    score.arena_data.forEach((obj, idx) => {
        if (Number.isNaN(obj.final) || obj.final == Infinity) obj.final = 0;
        result.divisions.arena[obj.group] = obj.final;
        result.divisions.arena_crew[obj.group] = obj.max_staff;
    });
    score.fbb_data.forEach((obj, idx) => {
        result.divisions.fbb[obj.group] = obj.final;
        result.divisions.fbb_crew[obj.group] = obj.max_staff;
        if (Number.isNaN(obj.final) || obj.final == Infinity) obj.final = 0;
        if (obj.opponent) {
            let [oppo, rarity] = obj.opponent.split("++");
            if (oppo && rarity) {
                let rare = Number(rarity);
                let current = result.boss_details.find(f => f.boss === oppo && f.rarity === rare);
                if (current && current.score < obj.final) {
                    current.score = obj.final;
                }
                else if (!current) {
                    current = {
                        boss: oppo,
                        rarity: Number(rarity),
                        rank: 0,
                        score: obj.final,
                        crew: obj.max_staff,
                        duration_crew: obj.max_duration_staff
                    };
                    result.boss_details.push(current);
                }
            }
        }
    });
    return result;
}

export function normalizeScores(scores: Score[]) {
    let max = 0;
    let z = 0;
    if (!scores.length) return;
    let changes = true;

    const _calc = (key: string) => {
        scores.sort((a, b) => b[key] - a[key]);
        max = scores[0][key];
        for (let score of scores) {
            score[key] = Number(((score[key] / max) * 100).toFixed(4));
        }
    }

    _calc("arena_final");
    _calc("fbb_final");

    const arena_max = {} as { [key: string]: number };
    const fbb_max = {} as { [key: string]: number };
    // Compute overall from normalized component scores
    scores.forEach((score) => {
        if (score.type === 'defense') {
            score.overall_final = ((score.fbb_final * 1.75) + score.arena_final);
        }
        else {
            score.overall_final = (score.fbb_final + score.arena_final);
        }

        [score.arena_data, score.fbb_data].forEach((data, idx) => {
            data.forEach((unit) => {
                if (idx == 0) {
                    arena_max[unit.group] ??= 0;
                    if (arena_max[unit.group] < unit.final) {
                        arena_max[unit.group] = unit.final;
                    }
                }
                else {
                    fbb_max[unit.group] ??= 0;
                    if (fbb_max[unit.group] < unit.final) {
                        fbb_max[unit.group] = unit.final;
                    }
                }
            });
        });
    });

    scores.forEach((score) => {
        [score.arena_data, score.fbb_data].forEach((data, idx) => {
            data.forEach((unit) => {
                if (idx === 0) {
                    unit.final = Number(((unit.final / arena_max[unit.group]) * 100).toFixed(4));
                }
                else {
                    unit.final = Number(((unit.final / fbb_max[unit.group]) * 100).toFixed(4));
                }
            });
        });
    });

    // Normalize overall score
    _calc("overall_final");
}


export function getCompatibleShips(crew: CrewMember, ships: Ship[], mode: 'fbb' | 'arena') {
    return ships.filter(ship => {
        if (shipCompatibility(ship, crew).score !== 1) return false;
        if (mode === 'fbb') {
            const bosses = getBosses(ship, crew)
            if (!bosses?.length) return false;
        }
        else if (mode === 'arena') {
            const div_1 = getCrewDivisions(crew.max_rarity);
            const div_2 = getShipDivision(ship.rarity);
            if (!div_1.includes(div_2)) return false;
        }
        return true;
    });
}

export function getCompatibleCrew(ship: Ship, roster: CrewMember[], mode: 'fbb' | 'arena') {
    return roster.filter(crew => {
        if (shipCompatibility(ship, crew).score !== 1) return false;
        if (mode === 'fbb') {
            const bosses = getBosses(ship, crew)
            if (!bosses?.length) return false;
        }
        else if (mode === 'arena') {
            const div_1 = getCrewDivisions(crew.max_rarity);
            const div_2 = getShipDivision(ship.rarity);
            if (!div_1.includes(div_2)) return false;
        }
        return true;
    });
}

export function processScores(
    crew: CrewMember[],
    ships: Ship[],
    scores: Score[], score_mode: 'defense' | 'offense' | 'ship', arena_length: number, fbb_length: number) {
    scores.forEach((score) => {
        score.arena_data.sort((a, b) => a.group - b.group);
        score.fbb_data.sort((a, b) => b.group - a.group);
        score.arena_data.forEach((data) => {
            data.average_damage = data.total_damage / data.count;
            data.average_compat = data.total_compat / data.count;
            data.average_hit = data.total_hit / data.count;
        });

        score.fbb_data.forEach((data) => {
            data.average_damage = data.total_damage / data.count;
            data.average_compat = data.total_compat / data.count;
            data.average_hit = data.total_hit / data.count;
        });
    });

    const getLikeScores = (score: Score, mode: 'arena' | 'fbb', group: number) => {
        let results = scores.filter(s => {
            if (score.kind != s.kind) return false;
            if (mode === 'arena') {
                return s.arena_data.some(a => a.group === group);
            }
            else {
                return s.fbb_data.some(a => a.group === group);
            }
        });
        return results.map(s => {
            if (mode === 'arena') {
                return s.arena_data.find(f => f.group === group)!
            }
            else {
                return s.fbb_data.find(f => f.group === group)!
            }
        });
    }

    const getMaxDuration = (scores: Scoreable[]) => {
        scores.sort((a, b) => b.duration - a.duration);
        return scores[0].duration;
    }

    const getMaxTotalDamage = (scores: Scoreable[]) => {
        scores.sort((a, b) => b.total_damage - a.total_damage);
        return scores[0].total_damage;
    }

    const getMaxIncomingDamage = (scores: Scoreable[]) => {
        scores.sort((a, b) => b.total_hit - a.total_hit);
        return scores[0].total_hit;
    }

    const LowerMul = 2.25;
    const HigherMul = 5.75;

    const getTopScore = (scores: Scoreable[], mode: 'arena' | 'fbb') => {
        if (mode === 'fbb') {
            if (score_mode === 'defense') {
                let maxdur = getMaxDuration(scores);
                let maxdmg = getMaxTotalDamage(scores);
                let maxhit = getMaxIncomingDamage(scores);
                if (scores[0].opponent.includes('borg')) {
                    return scores.map(ss =>
                            ((ss.duration / maxdur) * LowerMul) +
                            ((1 - (ss.total_hit / maxhit)) * HigherMul)
                        )
                        .reduce((p, n) => p > n ? p : n, 0);
                }
                else {
                    return scores.map(ss =>
                            ((ss.duration / maxdur) * HigherMul) +
                            ((ss.total_damage / maxdmg) * LowerMul)
                        )
                        .reduce((p, n) => p > n ? p : n, 0);
                }
            }
            else {
                if (score_mode === 'ship') {
                    return scores.map(ss => ss.max_damage).reduce((p, n) => p > n ? p : n, 0);
                }
                else {
                    return scores.map(ss => ss.total_damage).reduce((p, n) => p > n ? p : n, 0);
                }
            }
        }
        else {
            if (score_mode === 'defense') {
                let maxdur = getMaxDuration(scores);
                let maxdmg = getMaxTotalDamage(scores);
                return scores.map(ss => ((ss.duration / maxdur) * HigherMul) + ((ss.total_damage / maxdmg) * LowerMul)).reduce((p, n) => p > n ? p : n, 0);
            }
            else {
                let high = scores.map(score => arena_length - score.average_index).reduce((p, n) => p == -1 || p > n ? n : p, -1);
                return arena_length - high;
            }
        }
    }

    const getMyScore = (top: number, score: Scoreable, mode: 'arena' | 'fbb', maxdmg?: number, maxdur?: number) => {
        if (mode === 'fbb') {
            if (score_mode === 'defense' && maxdmg && maxdur) {
                return ((score.duration / maxdur) * HigherMul) + ((score.total_damage / maxdmg) * LowerMul);
            }
            else {
                if (score_mode === 'ship') {
                    return score.max_damage;
                }
                else {
                    return score.total_damage;
                }
            }
        }
        else {
            if (score_mode === 'defense' && maxdmg && maxdur) {
                return ((score.duration / maxdur) * HigherMul) + ((score.total_damage / maxdmg) * LowerMul);
            }
            else {
                return arena_length - score.average_index;
            }
        }
    }

    const computeScore = <T extends Ship | CrewMember>(score: Score, c: T) => {
        let scorearena = score.arena_data.sort((a, b) => a.group - b.group);
        let scorefbb = score.fbb_data.sort((a, b) => b.group - a.group);

        let a_groups = scorearena.map(m => m.group);
        let b_groups = scorefbb.map(m => m.group);

        for (let ag of a_groups) {
            const raw_score = score.arena_data.find(f => f.group === ag)!;
            const ls_arena = getLikeScores(score, 'arena', ag);
            const topscore_arena = getTopScore(ls_arena, 'arena');

            score.name = c.name!;

            let my_arena_score = getMyScore(topscore_arena, raw_score, 'arena');

            let my_arena = (my_arena_score / topscore_arena) * 100;
            raw_score.final = my_arena * raw_score.average_compat;
            if ("action" in c) {
                if (!c.action.ability) {
                    raw_score.final *= 0.25;
                }
            }
        }

        for (let bg of b_groups) {
            const raw_score = score.fbb_data.find(f => f.group === bg)!;
            const ls_fbb = getLikeScores(score, 'fbb', bg);
            const topscore_fbb = getTopScore(ls_fbb, 'fbb');
            let maxdur = getMaxDuration(ls_fbb);
            let maxdmg = getMaxTotalDamage(ls_fbb);

            score.name = c.name!;

            let my_fbb_score = getMyScore(topscore_fbb, raw_score, 'fbb', maxdmg, maxdur);
            let my_fbb = (my_fbb_score / topscore_fbb) * 100;

            raw_score.final = my_fbb * raw_score.average_compat;
            if ("action" in c) {
                if (!c.action.ability) {
                    raw_score.final *= 0.25;
                }
            }
        }

        if (score_mode === 'ship') {
            scorearena = scorearena.sort((a, b) => b.group - a.group).slice(0, 1);
            scorefbb = scorefbb.sort((a, b) => BossRarities[b.group] - BossRarities[a.group] || b.group - a.group).slice(0, 1);
        }
        else {
            scorearena.sort((a, b) => a.group - b.group);
            scorefbb.sort((a, b) => BossRarities[a.group] - BossRarities[b.group] || a.group - b.group);
        }
        score.arena_final = scorearena.map(m => m.final + (m.final / (4 - m.group))).reduce((p, n) => p + n, 0) / scorearena.length;
        score.fbb_final = scorefbb.map(m => m.final + (m.final / (7 - BossRarities[m.group]))).reduce((p, n) => p + n, 0) / scorefbb.length;
    }

    const overallMap = {} as {[key: string]: string[]};
    const arenaMap = {} as {[key: string]: string[]};
    const fbbMap = {} as {[key: string]: string[]};

    scores.forEach((score) => {
        let c = (crew.find(f => f.symbol === score.symbol) || ships.find(f => f.symbol === score.symbol))!;
        computeScore(score, c);
    });
    normalizeScores(scores);

    scores.forEach((score) => {
        overallMap[score.overall_final] ??= [];
        overallMap[score.overall_final].push(score.symbol);
        arenaMap[score.arena_final] ??= [];
        arenaMap[score.arena_final].push(score.symbol);
        fbbMap[score.fbb_final] ??= [];
        fbbMap[score.fbb_final].push(score.symbol);
    });
}

export const createScoreData = (config: ScoreDataConfig) => {
    const { crew, ships, trigger_compat, seat_compat, bypass_crew, crewscores, shipscores, fbbruns, arenaruns } = config;

    shipscores.length = 0;
    if (!bypass_crew) crewscores.length = 0;
    const scoreRun = (runs: BattleRunBase[], is_fbb: boolean, scores: Score[], score_type: 'crew' | 'ship') => {
        if (!is_fbb && score_type === 'crew') {
            runs.sort((a, b) => {
                if (a.type !== b.type) {
                    if (a.type === 'defense') return 1;
                    else return -1;
                }
                if (a.type === 'defense') {
                    return (b.compatibility.score - a.compatibility.score || b.duration - a.duration || b.damage - a.damage);
                }
                else {
                    return (a.win != b.win) ? (a.win ? -1 : 1) : (b.compatibility.score - a.compatibility.score || ((b.damage / b.duration) - (a.damage / a.duration)));
                }
            });
        }
        else if (!is_fbb && score_type === 'ship') {
            runs.sort((a, b) => {
                //return (b.compatibility.score - a.compatibility.score || b.damage - a.damage || a.duration - b.duration);
                return (a.win != b.win) ? (a.win ? -1 : 1) : (b.compatibility.score - a.compatibility.score || b.damage - a.damage || a.duration - b.duration);
            });
        }
        else if (is_fbb) {
            runs.sort((a, b) => b.compatibility.score - a.compatibility.score || b.damage - a.damage || b.duration - a.duration);
        }

        let z = -1;
        let score: Score | undefined = undefined;
        const indexes = {} as { [symbol: string]: { [div: string]: number[] } };

        for (let run of runs) {
            z++;
            if (trigger_compat && (run.compatibility.trigger === true && run.compatibility.score !== 1)) continue;
            if (seat_compat && !run.compatibility.seat) continue;

            let item: CrewMember | Ship;
            if (score_type === 'crew') {
                item = crew.find(f => f.symbol === run.crew.symbol)!;
            }
            else {
                item = ships.find(f => f.symbol === run.ship.symbol)!;
            }

            score = scores.find(cs => cs.symbol === item.symbol);

            if (!score) {
                let type: "defense" | "offense" = ("accuracy" in item) ? 'offense' : (characterizeCrew(item) < 0 ? 'defense' : 'offense')
                score = createScore(score_type, item.symbol, type);
                scores.push(score);
            }

            const div_id = is_fbb ? (run.boss?.id ?? 0) : run.division ?? 0;

            indexes[item.symbol] ??= {}
            indexes[item.symbol][div_id] ??= [];
            indexes[item.symbol][div_id].push(z);

            const scoreset = getScore(score, is_fbb ? 'fbb' : 'arena', div_id);
            scoreset.original_indices.push(z);
            if (is_fbb && run.boss) {
                scoreset.opponent = `${run.boss.symbol}++${run.boss.rarity}`;
            }
            else if (run.opponent) {
                scoreset.opponent = run.opponent.symbol;
            }
            if (run.compatibility.score === 1) {
                if (score_type === 'crew') {
                    scoreset.compat = [...new Set([...scoreset.compat, run.ship.symbol])]
                }
            }
            else {
                if (score_type === 'crew') {
                    scoreset.incompat = [...new Set([...scoreset.incompat, run.ship.symbol])]
                }
            }
            if (!scoreset.min_index || scoreset.min_index < z) {
                scoreset.min_index = z;
            }

            if (run.damage > scoreset.max_damage) {
                scoreset.max_damage = run.damage;
                scoreset.max_ship = run.ship.symbol;
                if (run.seated?.length) {
                    scoreset.max_staff = [...run.seated]
                }
                else {
                    scoreset.max_staff = [run.crew.symbol]
                }
                scoreset.max_compat = run.compatibility.score;
            }
            if (run.duration > scoreset.max_duration) {
                scoreset.max_duration = run.duration;
                scoreset.max_duration_ship = run.ship.symbol;
                if (run.seated?.length) {
                    scoreset.max_duration_staff = [...run.seated]
                }
                else {
                    scoreset.max_duration_staff = [run.crew.symbol]
                }
            }
            if (!scoreset.min_damage || run.damage < scoreset.min_damage) {
                scoreset.min_damage = run.damage;
                scoreset.min_ship = run.ship.symbol;
                if (run.seated?.length) {
                    scoreset.min_staff = [...run.seated];
                }
                else {
                    scoreset.min_staff = [run.crew.symbol];
                }
                scoreset.min_compat = run.compatibility.score;
            }

            if (!scoreset.min_hit || run.incoming < scoreset.min_hit) {
                scoreset.min_hit = run.incoming;
            }
            if (!scoreset.max_hit || run.incoming > scoreset.max_hit) {
                scoreset.max_hit = run.incoming;
            }

            scoreset.total_compat += run.compatibility.score;
            scoreset.duration += run.duration;
            scoreset.total_damage += run.damage;
            scoreset.total_hit += run.incoming;
            scoreset.count++;

            if (run.win) scoreset.win_count++;
        }

        Object.entries(indexes).forEach(([symbol, groups]) => {
            Object.entries(groups).forEach(([group, values]) => {
                if (!values.length) return;
                score = scores.find(cs => cs.symbol === symbol);
                if (score) {
                    const scoreset = getScore(score, is_fbb ? 'fbb' : 'arena', Number(group));
                    if (values.length > 2) {
                        scoreset.median_index = values[Math.floor(values.length / 2)];
                    }
                    scoreset.average_index = values.reduce((p, n) => p + n, 0) / values.length;
                }
            });
        });
    }

    [arenaruns, fbbruns].forEach((runs, idx) => {
        if (!bypass_crew) {
            if (!idx) console.log("Creating arena crew score sets...");
            if (idx) console.log("Creating FBB crew score sets...");
            scoreRun(runs, !!idx, crewscores, 'crew');
        }
        if (!idx) console.log("Creating arena ship score sets...");
        if (idx) console.log("Creating FBB ship score sets...");
        scoreRun(runs, !!idx, shipscores, 'ship');
    });
}

export function rankBosses(data: {[key:string]: ShipScores }, fullData: CrewMember[] | Ship[]) {
    let scores = Object.values(data).filter(f => f.boss_details?.length);
    let items = Object.keys(data).map(key => fullData.find(f => f.symbol === key)).filter(f => f !== undefined);
    let bossBuckets = {} as {[key:string]: ShipScores[]};
    for (let score of scores) {
        score.boss_details.sort((a, b) => b.rarity - a.rarity || b.score - a.score);
        for (let deet of score.boss_details) {
            let key = `${deet.boss}++${score.kind}++${deet.rarity}`;
            bossBuckets[key] ??= [];
            if (!bossBuckets[key].includes(score)) {
                bossBuckets[key].push(score);
            }
        }
    }
    let bosses = [] as string[];
    Object.entries(bossBuckets).forEach(([bosskey, bucket_scores]) => {
        let [symbol, kind, rare] = bosskey.split("++");
        if (!bosses.includes(symbol)) bosses.push(symbol);
        let rarity = Number(rare);
        bucket_scores.sort((a, b) => {
            let aboss = a.boss_details.find(f => f.boss === symbol && f.rarity === rarity)!;
            let bboss = b.boss_details.find(f => f.boss === symbol && f.rarity === rarity)!;
            return bboss.rarity - aboss.rarity || bboss.score - aboss.score;
        });
        let rank_out = 1;
        for (let bscore of bucket_scores) {
            for (let deet of bscore.boss_details) {
                if (deet.boss !== symbol) continue;
                deet.rank = rank_out;
            }
            rank_out++;
        }
    });
    for (let score of scores) {
        for (let deet of score.boss_details) {
            let fboss = score.bosses.find(f => f.boss === deet.boss);
            if (!fboss) {
                fboss = {
                    boss: deet.boss,
                    score: 0,
                    rank: 0
                }
                score.bosses.push(fboss);
            }
            fboss.rank++;
            fboss.score += (deet.score + (deet.score / (7 - deet.rarity)));
        }
        score.bosses.sort((a, b) => b.score - a.score);
        for (let fboss of score.bosses) {
            fboss.score /= fboss.rank;
            fboss.rank = 0;
        }
    }
    for (let boss of bosses) {
        for (let kind of ['offense', 'defense', 'ship']) {
            let bscores = scores.filter(f => f.bosses.some(b => b.boss === boss) && f.kind === kind);
            bscores.sort((a, b) => {
                let aboss = a.bosses.find(f => f.boss === boss)!;
                let bboss = b.bosses.find(f => f.boss === boss)!;
                return bboss.score - aboss.score;
            });
            let c = bscores.length;
            let max = 0;
            for (let i = 0; i < c; i++) {
                let bossobj = bscores[i].bosses.find(f => f.boss === boss)!;
                bossobj.rank = i + 1;
                if (i === 0) {
                    max = bossobj.score;
                    bossobj.score = 100;
                }
                else {
                    bossobj.score = Number(((Number(((bossobj.score / max) * 100)).toFixed(4))));
                }
            }
        }
    }
}

