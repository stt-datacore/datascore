import fs from 'fs';
import { ComputedSkill, CrewMember, QuipmentDetails, Ranks, RankScoring, Skill } from '../../website/src/model/crew';
import { calculateMaxBuffs, lookupAMSeatsByTrait } from '../../website/src/utils/voyageutils';
import { applyCrewBuffs, getSkillOrderScore, getSkillOrderStats, getVariantTraits, numberToGrade, SkillRarityReport, skillSum } from '../../website/src/utils/crewutils';
import { Collection } from '../../website/src/model/game-elements';
import { getAllStatBuffs } from '../../website/src/utils/collectionutils';
import { EquipmentItem } from '../../website/src/model/equipment';
import { getItemWithBonus } from '../../website/src/utils/itemutils';
import { TraitNames } from '../../website/src/model/traits';
import { potentialCols } from '../../website/src/components/stats/utils';
import { Gauntlet } from '../../website/src/model/gauntlets';
import { QPowers, scoreQuipment, sortingQuipmentScoring } from './quipment';
import { computePotentialColScores } from './cols';

const STATIC_PATH = `${__dirname}/../../../../website/static/structured/`;
const DEBUG = process.argv.includes('--debug');
const QUIET = process.argv.includes('--quiet');

interface ConstituentWeights {
    voyage: number
    voyage_plus: number
    shuttle: number
    shuttle_plus: number
    gauntlet: number
    gauntlet_plus: number
    crit: number
    ship: number
    quipment: number
    collections: number
    trait: number
    main_cast: number
    variant: number
    potential_cols: number
    skill_positions: number
    skill_rarity: number
    am_seating: number
    tertiary_rarity: number
    velocity: number
}


interface MainCast {
    tos: string[];
    tng: string[];
    ds9: string[];
    voy: string[];
    ent: string[];
    dsc: string[];
    snw: string[];
    low: string[];
}

function normalizeQPowers(qpowers: QPowers[]) {
    ["qpower", "bpower", "vpower", "gpower"].forEach((power) => {
        qpowers.sort((a, b) => b[power] - a[power])
        let max = qpowers[0][power];
        for (let p of qpowers) {
            p[power] = Number(((p[power] / max) * 100).toFixed(2))
        }
    });
    ["qprice", "bprice", "vprice", "gprice"].forEach((power) => {
        qpowers.sort((a, b) => b[power] - a[power])
        let max = qpowers[0][power];
        for (let p of qpowers) {
            p[power] = Number(((1 - (p[power] / max)) * 100).toFixed(2))
        }
    });

    for (let p of qpowers) {
        p.avg = ((p.gpower * 1) + (p.bpower * 1) + (p.qpower * 1) + (p.vpower * 1) + (p.qprice * 0.2) + (p.gprice * 0.2) + (p.vprice * 0.2) + (p.bprice * 0.2)) / 8;
    }

    qpowers.sort((a, b) => b.avg - a.avg);
    let amax = qpowers[0].avg;

    qpowers.forEach((item) => {
        item.avg = Number(((item.avg / amax) * 100).toFixed(2));
    });
}

function elacrit(gauntlets: Gauntlet[], crew: CrewMember) {
    let ec = 0;
    for (let g of gauntlets) {
        if (!g.contest_data) continue;
        let f = crew.traits.filter(f => g.contest_data!.traits.includes(f))
        if (f.length === 3) ec += 65;
        else if (f.length === 2) ec += 45;
        else if (f.length === 1) ec += 25;
        else if (f.length === 0) ec += 5;
        if (crew.skill_order.includes(g.contest_data!.featured_skill)) {
            ec += 5;
        }
    }
    return ec;
}

function velocity(crew: CrewMember, roster: CrewMember[]) {
    roster = [...roster].filter(f => f.skill_order.join(",") === crew.skill_order.join(","));
    let highint = [] as number[];
    crew.date_added = new Date(crew.date_added);
    roster.forEach((r => r.date_added = new Date(r.date_added)));

    roster.sort((a, b) => {
        return a.date_added.getTime() - b.date_added.getTime();
    }).filter(f => f.date_added.getTime() >= crew.date_added.getTime());

    let c = roster.length;
    if (c === 1) {
        return skillSum(roster[0].skill_order.map(skill => roster[0].base_skills[skill] as Skill))
    }
    for (let i = 1; i < c; i++) {
        let tdiff = roster[i].date_added.getTime() - roster[i - 1].date_added.getTime();
        let pdiff = skillSum(roster[i].skill_order.map(skill => roster[i].base_skills[skill] as Skill)) - skillSum(roster[i - 1].skill_order.map(skill => roster[i - 1].base_skills[skill] as Skill));
        if (tdiff === 0) {
            highint.push(Math.abs(pdiff));
            continue;
        }
        if (pdiff > 0) {
            highint.push(pdiff / tdiff);
        }
    }

    return highint.reduce((p, n) => p + n, 0);
}

function variantScore(variants: string[], roster: CrewMember[]) {
    let score = roster.filter(c => c.traits_hidden.some(th => variants.includes(th))).map(c => c.max_rarity * (1 + (c.max_rarity / 2))).reduce((p, n) => p + n, 0);
    return score;
}

function castScore(crew: CrewMember, roster: CrewMember[], maincast: MainCast) {
    let variants = getVariantTraits(crew);
    variants = [ ...new Set(Object.values(maincast).map((m: string[]) => m.filter(f => variants.includes(f))).flat()) ];
    //return variantScore(variants, roster);
    let count = roster.filter(c => c.traits_hidden.some(th => variants.includes(th))).length;
    return count;
}

function mainCastValue(symbol: string, maincast: MainCast) {
    let shows = 0;
    let inc = 0;
    Object.entries(maincast).forEach(([key, value]: [string, string[]], idx) => {
        if (value.includes(symbol)) shows++;
        inc += (1 + idx);
    });
    if (shows === 0 || inc === 0) return -1;
    inc /= shows;
    return inc;
}

function skillRare(crew: CrewMember, roster: CrewMember[]) {
    if (crew.skill_order.length !== 3) {
        return 1;
    }

    let s1 = crew.skill_order[0];
    let s2 = crew.skill_order[1];
    let s3 = crew.skill_order[2];
    let primes = [s1, s2];
    let ro = roster.filter(c => {
        if (c.skill_order.length !== 3) return false;
        let n1 = c.skill_order[0];
        let n2 = c.skill_order[1];
        let n3 = c.skill_order[2];
        let primes2 = [n1, n2];
        if (s3 === n3 && primes.every(p => primes2.includes(p))) return true;
        return false;
    });
    return ro.length / roster.length;
}

function tertRare(crew: CrewMember, roster: CrewMember[]) {
    if (crew.skill_order.length !== 3) {
        return 1;
    }

    let s3 = crew.skill_order[2];
    let ro = roster.filter(c => {
        if (c.skill_order.length !== 3) return false;
        let n3 = c.skill_order[2];
        if (s3 === n3) return true;
        return false;
    });
    return ro.length / roster.length;
}

function traitScoring(roster: CrewMember[]) {
	roster = [ ...roster ];

	const traitCount = {} as { [key: string]: number };
	roster.forEach((crew) => {
		crew.traits.forEach((trait) => {
			traitCount[trait] ??= 0;
			traitCount[trait]++;
		});
	});
	roster.forEach((crew) => {
		crew.ranks ??= {} as Ranks;
        crew.ranks.scores ??= {} as RankScoring;
		let traitsum = crew.traits.map(t => traitCount[t]).reduce((p, n) => p + n, 0);
		crew.ranks.scores.trait = (1 / traitsum) / crew.traits.length;
	});

	roster.sort((a, b) => a.ranks.scores.trait - b.ranks.scores.trait);
    let max = roster[roster.length - 1].ranks.scores.trait;
	roster.forEach((crew, idx) => crew.ranks.scores.trait = Number((((1 - crew.ranks.scores.trait / max)) * 100).toFixed(4)));
}

function collectionScore(c: CrewMember, collections: Collection[]) {
    const crewcols = c.collection_ids.map(id => collections.find(f => f.id?.toString() == id?.toString())!).filter(f => f.milestones?.some(ms => ms.buffs?.length))
    let n = 0;
    for (let col of crewcols) {
        let buffs = getAllStatBuffs(col);
        n += buffs.map(b => b.quantity!).reduce((p, n) => p + n, 0);
    }
    return n; // (c.collection_ids.length / collections.length) + (n / crewcols.length);
    //return n + c.collection_ids.length;
}

type RarityScore = { symbol: string, score: number, rarity: number, data?: any };

export function score() {
    const Weights: {[key:string]: ConstituentWeights} = {};

    if (!QUIET) console.log("DataScore\nLoading data sets...");

    const maincast = JSON.parse(fs.readFileSync(STATIC_PATH + 'maincast.json', 'utf-8')) as MainCast;
    const items = JSON.parse(fs.readFileSync(STATIC_PATH + 'items.json', 'utf-8')) as EquipmentItem[];
    const quipment = items.filter(f => f.type === 14).map(item => getItemWithBonus(item));
    items.length = 0;

    const gauntlets = (() => {
        let gs = JSON.parse(fs.readFileSync(STATIC_PATH + 'gauntlets.json', 'utf-8')) as Gauntlet[]
        let ghash = {} as {[key:string]: Gauntlet};
        for (let g of gs) {
            if (!g.contest_data) continue;
            let hash = g.contest_data.featured_skill + "_" + g.contest_data.traits.join("_");
            ghash[hash] = g
        }
        return Object.values(ghash);
    })();

    const collections = JSON.parse(fs.readFileSync(STATIC_PATH + 'collections.json', 'utf-8')) as Collection[];
    const TRAIT_NAMES = JSON.parse(fs.readFileSync(STATIC_PATH + 'translation_en.json', 'utf-8')).trait_names as TraitNames;
    const buffcap = JSON.parse(fs.readFileSync(STATIC_PATH + 'all_buffs.json', 'utf-8'));
    const maxbuffs = calculateMaxBuffs(buffcap);
    const crew = (JSON.parse(fs.readFileSync(STATIC_PATH + 'crew.json', 'utf-8')) as CrewMember[]);
    const origCrew = JSON.parse(JSON.stringify(crew)) as CrewMember[];
    const pcols = computePotentialColScores(crew, collections, TRAIT_NAMES);

    const skill_reports = (() => {
        const output = [] as SkillRarityReport<CrewMember>[][];
        for (let rarity = 1; rarity <= 5; rarity++) {
            output.push(getSkillOrderStats({ roster: crew.filter(f => f.max_rarity === rarity), returnCrew: false }));
        }
        return output;
    })();

    const crewNames = (() => {
        const cn = {} as {[key:string]: string};
        origCrew.forEach(c => cn[c.symbol] = c.name);
        return cn;
    })();

    function normalize(results: RarityScore[], inverse?: boolean, min_balance?: boolean, not_crew?: boolean, tie_breaker?: <T extends { symbol: string }>(a: T, b: T) => number) {
        results = results.slice();
        results.sort((a, b) => b.score - a.score);
        let max = results[0].score;
        let min = min_balance ? (results[results.length - 1].score) : 0;
        max -= min;
        for (let r of results) {
            if (inverse) {
                r.score = Number((((1 - (r.score - min) / max)) * 100).toFixed(4));
            }
            else {
                r.score = Number((((r.score - min) / max) * 100).toFixed(4));
            }
        }

        results.sort((a, b) => {
            let r = b.score - a.score;
            if (!r) {
                if (tie_breaker) {
                    r = tie_breaker(a, b);
                }
                if (!r && !not_crew) {
                    if (crewNames[a.symbol] && crewNames[b.symbol]) {
                        r = crewNames[a.symbol].localeCompare(b.symbol);
                    }
                    else {
                        console.log(`Missing crew names for ${a.symbol} or ${b.symbol}`)!
                    }
                }
            }
            return r;
        });
        return results;
    }

    function makeResults(mode: 'core' | 'proficiency' | 'all') {
        let results = [] as RarityScore[];
        let bb: 'B' | 'V' | 'G' = 'V';
        switch (mode) {
            case 'core':
                bb = 'B';
                break;
            case 'proficiency':
                bb = 'G';
                break;
            default:
                bb = 'V';
                break;
        }
        for (let c of crew) {
            applyCrewBuffs(c, maxbuffs);
            let skills = c.skill_order.map(skill => c[skill] as ComputedSkill);
            results.push({
                symbol: c.symbol,
                rarity: c.max_rarity,
                score: skillSum(skills, mode),
            });
        }
        return normalize(results);
    }

    if (!QUIET) console.log("Scoring crew...");

    if (!QUIET) console.log("Scoring voyages...");
    let results = makeResults('all')
    let voyage = results;
    if (DEBUG) console.log("Voyage")
    if (DEBUG) console.log(voyage.slice(0, 20));

    if (!QUIET) console.log("Scoring gauntlet...");
    results = makeResults('proficiency')
    let gauntlet = results;
    if (DEBUG) console.log("Gauntlet")
    if (DEBUG) console.log(gauntlet.slice(0, 20));

    if (!QUIET) console.log("Scoring shuttle/core...");
    results = makeResults('core')
    let shuttle = results;
    if (DEBUG) console.log("Shuttle")
    if (DEBUG) console.log(shuttle.slice(0, 20));
    results = [].slice();

    if (!QUIET) console.log("Scoring FBB traits...");
    traitScoring(crew);

    for (let c of crew) {
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: c.ranks.scores.trait
        });
    }
    results.sort((a, b) => b.score - a.score);
    let traits = results;

    if (DEBUG) console.log("Traits")
    if (DEBUG) console.log(traits.slice(0, 20));

    results = [].slice();

    if (!QUIET) console.log("Scoring quipment using sorting method...");
    let qpowersV = sortingQuipmentScoring(crew, quipment, maxbuffs);
    let qpowers = [] as QPowers[];
    let qpowersP = [] as QPowers[];

    if (!QUIET) console.log("Scoring quipment using power method...");
    for (let c of crew) {
        let data = scoreQuipment(c, quipment, maxbuffs);
        qpowers.push(data);
    }

    qpowersP = JSON.parse(JSON.stringify(qpowers));

    for (const qp of qpowers) {
        let c = crew.find(f => f.symbol === qp.symbol)!;
        //let factor = 0.5 + (5 / c.max_rarity);

        let vp = qpowersV.find(f => f.symbol === qp.symbol)!;
        Object.keys(qp).forEach((key) => {
            if (typeof qp[key] !== 'number') return;
            qp[key] = ((qp[key]) + (vp[key])) / 2;
        });
    }

    normalizeQPowers(qpowersV);
    normalizeQPowers(qpowersP);
    normalizeQPowers(qpowers);

    for (let qpc of qpowers) {
        let c = crew.find(f => f.symbol === qpc.symbol)!
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: qpc.avg,
            data: qpc
        });
    }

    let quips = normalize(results);

    if (DEBUG) console.log("Quipment Score")
    if (DEBUG) console.log(quips.slice(0, 20));

    results = [].slice();

    if (!QUIET) console.log("Scoring collections...");

    for (let c of crew) {
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: collectionScore(c, collections)
        });
    }

    let cols = normalize(results);
    if (DEBUG) console.log("Stat-Boosting Collections")
    if (DEBUG) console.log(cols.slice(0, 20));

    if (!QUIET) console.log("Scoring skill-order rarity...");

    results = [].slice();
    let skillpos = [] as RarityScore[];
    let buckets = [[], [], [], [], [], []] as CrewMember[][];
    for (let c of origCrew) {
        buckets[c.max_rarity].push(c);
    }

    for (let c of crew) {
        skillpos.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: getSkillOrderScore(c, skill_reports[c.max_rarity-1])
        });
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: skillRare(c, buckets[c.max_rarity])
        });
    }

    let skillrare = normalize(results, true);
    skillpos = normalize(skillpos);

    if (DEBUG) console.log("Skill-Order Rarity")
    if (DEBUG) console.log(skillrare.slice(0, 20));

    if (DEBUG) console.log("Triplet Power")
    if (DEBUG) console.log(skillpos.slice(0, 20));

    if (!QUIET) console.log("Scoring tertiary skill rarity...");

    results = [].slice();

    for (let c of crew) {
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: tertRare(c, buckets[c.max_rarity])
        });
    }

    let tertrare = normalize(results, true);

    if (DEBUG) console.log("Tertiary Rarity")
    if (DEBUG) console.log(tertrare.slice(0, 20));

    if (!QUIET) console.log("Scoring velocity...");

    results = [].slice();

    for (let c of crew) {

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: velocity(c, buckets[c.max_rarity])
        });
    }

    let velocities = normalize(results);

    if (DEBUG) console.log("Velocity")
    if (DEBUG) console.log(velocities.slice(0, 20));

    if (!QUIET) console.log("Scoring potential collections...");

    let tcolnorm = [] as RarityScore[];
    for (let pc of pcols) {
        tcolnorm.push({
            symbol: pc.trait,
            rarity: 5,
            score: pc.count
        });
    }

    tcolnorm = normalize(tcolnorm, undefined, undefined, true);

    if (DEBUG) console.log("Potential Collections")
    if (DEBUG) console.log(tcolnorm);

    results = [].slice();

    for (let c of crew) {
        let tcols = tcolnorm.filter(f => c.traits.includes(f.symbol) || c.traits_hidden.includes(f.symbol));
        let n = tcols.map(tc => tc.score).reduce((p, n) => p + n, 0);

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: n
        });
    }

    let pcolscores = normalize(results, false, true);

    if (DEBUG) console.log("Potential Collection Score")
    if (DEBUG) console.log(pcolscores.slice(0, 20));

    if (!QUIET) console.log("Scoring elevated-crit gauntlets...");

    results = [].slice();

    for (let c of crew) {
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: elacrit(gauntlets,c)
        });
    }

    let elacrits = normalize(results);

    if (DEBUG) console.log("Elevated Crit Gauntlet Score")
    if (DEBUG) console.log(elacrits.slice(0, 20));

    if (!QUIET) console.log("Scoring Antimatter traits...");

    results = [].slice();

    for (let c of crew) {
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: c.traits.map(m => lookupAMSeatsByTrait(m)).flat().length
        });
    }

    let amseats = normalize(results);

    if (DEBUG) console.log("Antimatter Seats")
    if (DEBUG) console.log(amseats.slice(0, 20));

    if (!QUIET) console.log("Scoring main-cast...");

    results = [].slice();

    for (let c of crew) {
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: castScore(c, crew, maincast)
        });
    }

    let mains = normalize(results, false, false, false, (a, b) => {
        let av = mainCastValue(a.symbol, maincast);
        let bv = mainCastValue(b.symbol, maincast);
        if (av && bv) return av - bv;
        else if (av) return -1;
        else if (bv) return 1;
        return 0;
    });

    if (DEBUG) console.log("Main cast score")
    if (DEBUG) console.log(mains.slice(0, 20));

    if (!QUIET) console.log("Scoring crew variants...");

    results = [].slice();

    for (let c of crew) {
        let variants = getVariantTraits(c);
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: variantScore(variants, crew)
        });
    }

    let variants = normalize(results);

    if (DEBUG) console.log("Variant score")
    if (DEBUG) console.log(variants.slice(0, 20));

    if (!QUIET) console.log("Scoring gauntlet plus...");

    results = [].slice();

    for (let c of crew) {
        let gauntlet_n = gauntlet.find(f => f.symbol === c.symbol)!.score;
        let i_crit_n = elacrits.findIndex(f => f.symbol === c.symbol);
        let crit_n = elacrits[i_crit_n].score;

        let i_quip_n = quips.findIndex(f => f.symbol === c.symbol);
        let qobj = quips[i_quip_n];
        let qp = qobj.data as QPowers | undefined;
        let quip_n = quips[i_quip_n].score;

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: (gauntlet_n + (crit_n * 0.75) + ((qp?.gpower ?? quip_n) * 0.5)) / 3
        });
    }

    let gauntlet_plus = normalize(results);

    if (DEBUG) console.log("Gauntlet-Plus score")
    if (DEBUG) console.log(gauntlet_plus.slice(0, 20));

    if (!QUIET) console.log("Scoring voyage plus...");

    results = [].slice();

    for (let c of crew) {
        let voyage_n = voyage.find(f => f.symbol === c.symbol)!.score;
        let i_amseat_n = amseats.findIndex(f => f.symbol === c.symbol);
        let amseat_n = amseats[i_amseat_n].score;

        let i_quip_n = quips.findIndex(f => f.symbol === c.symbol);
        let qobj = quips[i_quip_n];
        let qp = qobj.data as QPowers | undefined;
        let quip_n = quips[i_quip_n].score;

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: (voyage_n + (amseat_n * 0.2) + ((qp?.vpower ?? quip_n) * 0.75)) / 3
        });
    }

    let voyage_plus = normalize(results);

    if (DEBUG) console.log("Voyage-Plus score")
    if (DEBUG) console.log(voyage_plus.slice(0, 20));

    if (!QUIET) console.log("Scoring shuttle/core plus...");

    results = [].slice();

    for (let c of crew) {
        let i_shuttle_n = shuttle.findIndex(f => f.symbol === c.symbol);
        let shuttle_n = shuttle[i_shuttle_n].score;

        let i_quip_n = quips.findIndex(f => f.symbol === c.symbol);
        let qobj = quips[i_quip_n];
        let qp = qobj.data as QPowers | undefined;
        let quip_n = quips[i_quip_n].score;

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: (shuttle_n + ((qp?.bpower ?? quip_n) * 0.5)) / 2
        });
    }

    let shuttle_plus = normalize(results);

    if (DEBUG) console.log("Shuttle-Plus score")
    if (DEBUG) console.log(shuttle_plus.slice(0, 20));

    if (!QUIET) console.log("Applying weights and final scoring...");

    results = [].slice();

    for (let c of origCrew) {
        let gauntlet_n = gauntlet.find(f => f.symbol === c.symbol)!.score;
        let voyage_n = voyage.find(f => f.symbol === c.symbol)!.score;
        let i_core_n = shuttle.findIndex(f => f.symbol === c.symbol);
        let core_n = shuttle[i_core_n].score;

        c.ranks.scores.gauntlet = gauntlet_n;
        c.ranks.scores.voyage = voyage_n;
        c.ranks.scores.shuttle = core_n;
        c.ranks.shuttleRank = i_core_n + 1;

        let i_maincast_n = mains.findIndex(f => f.symbol === c.symbol);
        let maincast_n = mains[i_maincast_n].score;

        let i_variant_n = variants.findIndex(f => f.symbol === c.symbol);
        let variant_n = variants[i_variant_n].score;

        let i_pos_n = skillpos.findIndex(f => f.symbol === c.symbol);
        let skpos_n = skillpos[i_pos_n].score;

        let i_sk_rare_n = skillrare.findIndex(f => f.symbol === c.symbol);
        let sko_rare_n = skillrare[i_sk_rare_n].score;

        let i_tert_rare_n = tertrare.findIndex(f => f.symbol === c.symbol);
        let tert_rare_n = tertrare[i_tert_rare_n].score;

        let i_amseat_n = amseats.findIndex(f => f.symbol === c.symbol);
        let amseat_n = amseats[i_amseat_n].score;

        let i_quip_n = quips.findIndex(f => f.symbol === c.symbol);
        let quipment_n = quips[i_quip_n].score;

        c.ranks.scores.quipment_details = { ...quips[i_quip_n].data as QuipmentDetails ?? {} };

        if (c.ranks.scores.quipment_details) {
            delete c.ranks.scores.quipment_details["symbol"];
        }

        (c.ranks.scores as any).power_quipment_details = qpowersP.find(f => f.symbol === c.symbol) as QuipmentDetails;
        delete (c.ranks.scores as any).power_quipment_details["symbol"];

        (c.ranks.scores as any).versatility_quipment_details = qpowersV.find(f => f.symbol === c.symbol) as QuipmentDetails;
        delete (c.ranks.scores as any).versatility_quipment_details["symbol"];

        let i_trait_n = traits.findIndex(f => f.symbol === c.symbol);
        let fbbtrait_n = traits[i_trait_n].score;

        let i_colscore_n = cols.findIndex(f => f.symbol === c.symbol);
        let sbcolscore_n = cols[i_colscore_n].score;

        let i_pcs_n = pcolscores.findIndex(f => f.symbol === c.symbol);
        let pcol_n = pcolscores[i_pcs_n].score;

        let i_velocity_n = velocities.findIndex(f => f.symbol === c.symbol);
        let velocity_n = velocities[i_velocity_n].score;

        let i_crit_n = elacrits.findIndex(f => f.symbol === c.symbol);
        let elacrit_n = elacrits[i_crit_n].score;

        let i_gplus_n = gauntlet_plus.findIndex(f => f.symbol === c.symbol);
        let gplus_n = gauntlet_plus[i_gplus_n].score;

        let i_splus_n = shuttle_plus.findIndex(f => f.symbol === c.symbol);
        let splus_n = shuttle_plus[i_splus_n].score;

        let i_vplus_n = voyage_plus.findIndex(f => f.symbol === c.symbol);
        let vplus_n = voyage_plus[i_vplus_n].score;

        c.ranks.scores.main_cast = maincast_n;
        c.ranks.main_cast_rank = i_maincast_n + 1;

        c.ranks.scores.variant = variant_n;
        c.ranks.variant_rank = i_variant_n + 1;

        c.ranks.scores.skill_positions = skpos_n;
        c.ranks.skill_positions_rank = i_pos_n + 1;

        c.ranks.scores.skill_rarity = sko_rare_n;
        c.ranks.skill_rarity_rank = i_sk_rare_n + 1;

        c.ranks.scores.tertiary_rarity = tert_rare_n;
        c.ranks.tertiary_rarity_rank = i_tert_rare_n + 1;

        c.ranks.scores.quipment = quipment_n;
        c.ranks.quipment_rank = i_quip_n + 1;

        c.ranks.scores.am_seating = amseat_n;
        c.ranks.am_seating_rank = i_amseat_n + 1;

        c.ranks.scores.trait = fbbtrait_n;
        c.ranks.traitRank = i_trait_n + 1;

        c.ranks.scores.collections = sbcolscore_n;
        c.ranks.collections_rank = i_colscore_n + 1;

        c.ranks.scores.potential_cols = pcol_n;
        c.ranks.potential_cols_rank = i_pcs_n + 1;

        c.ranks.scores.velocity = velocity_n;
        c.ranks.velocity_rank = i_velocity_n + 1;

        c.ranks.scores.crit = elacrit_n;
        c.ranks.crit_rank = i_crit_n + 1;

        c.ranks.scores.gauntlet_plus = gplus_n;
        c.ranks.scores.gauntlet_plus_rank = i_gplus_n + 1;

        c.ranks.scores.voyage_plus = vplus_n;
        c.ranks.scores.voyage_plus_rank = i_vplus_n + 1;

        c.ranks.scores.shuttle_plus = splus_n;
        c.ranks.scores.shuttle_plus_rank = i_splus_n + 1;

        let ship_n = c.ranks.scores.ship.overall;
        c.ranks.ship_rank = c.ranks.scores.ship.overall_rank;

/*
    - Voyage-Plus Score                    Weight: 0.25
        - Voyage Score + (Antimatter Seats * 0.2) + (Quipment * 0.75)

    - Gauntlet-Plus Score                  Weight: 0.25
        - Gauntlet Score + (High Crit Gauntlets * 0.75) + (Quipment * 0.5)

    - Shuttle-Plus Score                   Weight: 0.25
        - Shuttle/Base Score + (Quipment * 0.5)

    - Voyage Score                         Weight: 2 + Rarity
    - Skill-Order Rarity                   Weight: 3
    - Gauntlet Score                       Weight: 1.7
    - Ship Ability Score                   Weight: 1.25
    - Skill Position Score                 Weight: 1.1
    - Shuttle/Base Score                   Weight: 1
    - Quipment Score                       Weight: 0.40
    - Antimatter Seating Score             Weight: 0.35
    - Elevated Crit Gauntlet               Weight: 0.267
    - Stat-Boosting Collection Score       Weight: 0.25
    - FBB Node-Cracking Trait Score        Weight: 0.25
    - Main Cast Score                      Weight: 0.2
    - Skill-Order Velocity Score           Weight: 0.15
    - Potential Collection Score           Weight: 0.15
    - Tertiary Skill Rarity Score          Weight: 0.1
    - Variant Score                        Weight: 0.04

*/
        Weights[c.max_rarity] ??= {
            voyage_plus: 0.25,
            shuttle_plus: 0.25,
            gauntlet_plus: 0.25,
            voyage: 2                   + ((c.max_rarity) * (c.max_rarity / 5)),
            skill_rarity: 3             - (0.2 * (5 - c.max_rarity)),
            gauntlet: 1.7,
            ship: 0.125                 + (0.5 * (5 - c.max_rarity)),
            skill_positions: 1.1        - (0.2 * (5 - c.max_rarity)),
            shuttle: 1                  - (0.1 * (5 - c.max_rarity)),
            quipment: 0.40              + (0.3 * (5 - c.max_rarity)),
            am_seating: 0.35            - (0.07 * (5 - c.max_rarity)),
            crit: 0.267,
            collections: 0.25           + (0.5 * (5 - c.max_rarity)),
            trait: 0.25                 + (0.5 * (5 - c.max_rarity)),
            main_cast: 0.20             + (0.1 * (5 - c.max_rarity)),
            potential_cols: 0.17        + (0.17 * (5 - c.max_rarity)),
            velocity: 0.15,
            tertiary_rarity: 0.1,
            variant: 0.04               + (0.02 * (5 - c.max_rarity)),
        }

        const weight = Weights[c.max_rarity];

        vplus_n *= weight.voyage_plus;
        gplus_n *= weight.gauntlet_plus;
        splus_n *= weight.shuttle_plus;

        voyage_n *= weight.voyage;
        sko_rare_n *= weight.skill_rarity;
        gauntlet_n *= weight.gauntlet;

        // ship is already * 10, this is effectively 1.25
        ship_n *= weight.ship;
        core_n *= weight.shuttle;
        skpos_n *= weight.skill_positions;
        quipment_n *= weight.quipment;
        amseat_n *= weight.am_seating;
        elacrit_n *= weight.crit;
        sbcolscore_n *= weight.collections;
        fbbtrait_n *= weight.trait;
        maincast_n *= weight.main_cast;
        velocity_n *= weight.velocity;
        pcol_n *= weight.potential_cols;
        tert_rare_n *= weight.tertiary_rarity;
        variant_n *= weight.variant;

        let scores = [
            amseat_n,
            maincast_n,
            variant_n,
            sbcolscore_n,
            gauntlet_n,
            pcol_n,
            quipment_n,
            ship_n,
            core_n,
            sko_rare_n,
            fbbtrait_n,
            tert_rare_n,
            velocity_n,
            voyage_n,
            elacrit_n,
            skpos_n,
            gplus_n,
            vplus_n,
            splus_n
        ];

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: (scores.reduce((p, n) => p + n, 0) / scores.length)
        });
    }

    normalize(results, false, true);

    origCrew.forEach((c) => {
        c.ranks.scores ??= {} as RankScoring;
        let ranks = results.find(f => f.symbol === c.symbol);
        if (ranks) {
            c.ranks.scores.overall = ranks.score;
        }
        else {
            c.ranks.scores.overall = -1;
            c.ranks.scores.overall_rank = -1;
            c.ranks.scores.overall_grade = "?";
        }

    });

    results.sort((a, b) => b.score - a.score);

    for (let r = 0; r <= 5; r++) {
        let filtered = results.filter(f => !r || f.rarity === r);
        filtered.sort((a, b) => b.score - a.score);
        let score_max = filtered[0].score;
        let len_max = filtered.length * 1.5;
        let rank = 1;
        let score_mul = 2;
        let rank_mul = 4;
        if (!r) {
            for (let rec of filtered) {
                let c = origCrew.find(fc => fc.symbol === rec.symbol);
                if (c) {
                    c.ranks.scores.overall_rank = rank++;
                }
            }
        }
        else {
            for (let rec of filtered) {
                let score_num = Number(((rec.score / score_max) * 100).toFixed(4));
                let rank_num = Number(((1 - ((rank - 1) / len_max)) * 100).toFixed(4));
                rec.score = ((score_num * score_mul) + (rank_num * rank_mul)) / (rank_mul + score_mul);
                rank++;
            }
        }
        if (r) normalize(filtered);
    }

    for (let r = 1; r <= 5; r++) {
        let filtered = results.filter(f => f.rarity === r);
        filtered.sort((a, b) => b.score - a.score);
        let rank = 1;
        for (let rec of filtered) {
            let c = origCrew.find(fc => fc.symbol === rec.symbol);
            if (c) {
                c.ranks.scores.rarity_overall = rec.score;
                c.ranks.scores.rarity_overall_rank = rank++;
                c.ranks.scores.overall_grade = numberToGrade(rec.score / 100);
            }
        }
    }

    let tuvix = [] as RarityScore[]

    for (let c of origCrew) {
        tuvix.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: ((Number(c.cab_ov) / 16) + (c.ranks.scores.overall / 100)) / 2
        });
    }

    tuvix = normalize(tuvix);

    for (let c of origCrew) {
        let tf = tuvix.find(ff => ff.symbol === c.symbol)!;
        if (!tf) continue;
        c.ranks.scores.tuvix = tf.score;
    }

    if (DEBUG) console.log("Tuvix")
    if (DEBUG) console.log(tuvix.slice(0, 20));

    if (DEBUG) console.log("Final scoring:");

    if (DEBUG) {
        results.forEach((result, idx) => {
            let c = origCrew.find(f => f.symbol === result.symbol)!;
            if (idx < 50) {
                console.log(`${c.name.padEnd(40, ' ')}`, `Score ${c.ranks.scores.rarity_overall}`.padEnd(15, ' '), `Grade: ${c.ranks.scores.overall_grade}`);
            }
        });
    }
    if (DEBUG) console.log(`Results: ${results.length}`);
    if (!QUIET) console.log("Writing crew.json...");
    fs.writeFileSync(STATIC_PATH + 'crew.json', JSON.stringify(origCrew));
    if (!QUIET) console.log("Writing current_weighting.json...");
    fs.writeFileSync(STATIC_PATH + 'current_weighting.json', JSON.stringify(Weights));
    if (!QUIET) console.log("Done.");
}

if (process.argv[1].includes('scoring')) {
    score();
}