import fs from 'fs';
import { ConstituentWeights, ComputedSkill, CrewMember, QuipmentDetails, GreatnessDetails, Ranks, RankScoring, Skill } from '../../website/src/model/crew';
import { EquipmentItem } from '../../website/src/model/equipment';
import { Collection } from '../../website/src/model/game-elements';
import { Gauntlet } from '../../website/src/model/gauntlets';
import { TraitNames } from '../../website/src/model/traits';
import { getAllCrewRewards, getAllStatBuffs } from '../../website/src/utils/collectionutils';
import { applyCrewBuffs, getSkillOrderScore, getSkillOrderStats, getVariantTraits, numberToGrade, SkillRarityReport, skillSum } from '../../website/src/utils/crewutils';
import { getItemWithBonus } from '../../website/src/utils/itemutils';
import { calculateMaxBuffs, lookupAMSeatsByTrait } from '../../website/src/utils/voyageutils';
import { computePotentialColScores, splitCollections } from './cols';
import { QPowers, scoreQuipment, sortingQuipmentScoring } from './quipment';
import { normalize as norm } from './normscores';
import CONFIG from '../../website/src/components/CONFIG';

const STATIC_PATH = `${__dirname}/../../../../website/static/structured/`;
const SCRIPTS_DATA_PATH = `${__dirname}/../../../../scripts/data/`;

const DEBUG = process.argv.includes('--debug');
const QUIET = process.argv.includes('--quiet');

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
    let vcrew = roster.filter(c => c.traits_hidden.some(th => variants.includes(th)));
    let count = vcrew.length;
    let rarescore = vcrew.map(v => v.max_rarity).reduce((p, n) => p + n, 0);
    return count * rarescore;
}

function mainCastValue(symbol: string, maincast: MainCast) {
    let shows = 0;
    let inc = 0;

    Object.entries(maincast).forEach(([key, value]: [string, string[]], idx) => {
        if (value.includes(symbol)) shows++;
        inc += (1 + idx);
    });
    if (shows === 0 || inc === 0) return 0;
    shows /= inc;
    return shows;
}

function skillRare(crew: CrewMember, roster: CrewMember[]) {
    let s1 = crew.skill_order[0] || "";
    let s2 = crew.skill_order[1] || "";
    let s3 = crew.skill_order[2] || "";
    let primes = [s1, s2];
    let ro = roster.filter(c => {
        if (c.max_rarity !== crew.max_rarity) return false;
        if (c.skill_order.length !== crew.skill_order.length) return false;
        //if (c.skill_order.length !== 3) return false;
        let n1 = c.skill_order[0] || "";
        let n2 = c.skill_order[1] || "";
        let n3 = c.skill_order[2] || "";
        if (c.skill_order.length === 3) {
            let primes2 = [n1, n2];
            if (s3 === n3 && primes.every(p => primes2.includes(p))) return true;
        }
        return (s1 === n1 && s2 === n2 && s3 === n3);
    });
    return (ro.length / roster.length) / crew.skill_order.length;
}
const rarecache = {} as {[key:string]: CrewMember[]};
function tertRare(crew: CrewMember, roster: CrewMember[]) {
    if (crew.skill_order.length !== 3) {
        return 1;
    }

    let s3 = crew.skill_order[2];
    let rkkey = `${crew.max_rarity}_${s3}_3`;

    let peers = rarecache[rkkey] || roster.filter(c => {
        if (c.max_rarity !== crew.max_rarity) return false;
        if (c.skill_order.length !== 3) return false;
        let n3 = c.skill_order[2];
        if (s3 === n3) return true;
        return false;
    });
    rarecache[rkkey] = peers;
    let powers = peers.map(cp => ({ power: skillSum(cp.base_skills[cp.skill_order[2]]), symbol: cp.symbol }));
    powers.sort((a, b) => a.power - b.power);
    let fi = powers.findIndex(c => c.symbol === crew.symbol);
    if (fi !== -1) return ((peers.length + fi) / 2) / roster.length;
    return peers.length / roster.length;
}

function priRare(crew: CrewMember, roster: CrewMember[]) {
    let s3 = crew.skill_order[0];
    let rkkey = `${crew.max_rarity}_${s3}_1`;

    let peers = rarecache[rkkey] || roster.filter(c => {
        if (c.max_rarity !== crew.max_rarity) return false;
        let n3 = c.skill_order[0];
        if (s3 === n3) return true;
        return false;
    });
    rarecache[rkkey] = peers;
    let powers = peers.map(cp => ({ power: skillSum(cp.base_skills[cp.skill_order[0]]), symbol: cp.symbol }));
    powers.sort((a, b) => a.power - b.power);
    let fi = powers.findIndex(c => c.symbol === crew.symbol);
    if (fi !== -1) return ((peers.length + fi) / 2) / roster.length;
    return peers.length / roster.length;
}

function traitScoring(roster: CrewMember[]) {
	roster = [ ...roster ];

    const allowedTraits = [ ... new Set(roster.filter(f => f.in_portal).map(m => m.traits).flat()) ].sort();
	const traitCount = {} as { [key: string]: number };

    for (let c of roster) {
        for (let trait of allowedTraits) {
            if (c.traits.includes(trait)) {
                traitCount[trait] ??= 0;
                traitCount[trait]++;
            }
        }
    }

	roster.forEach((crew) => {
		crew.ranks ??= {} as Ranks;
        crew.ranks.scores ??= {} as RankScoring;
		let traitsum = crew.traits.map(t => (traitCount[t] || 0)).reduce((p, n) => p + n, 0);
		crew.ranks.scores.trait = (1 / traitsum) / crew.traits.filter(f => f in traitCount).length;
	});

	roster.sort((a, b) => a.ranks.scores.trait - b.ranks.scores.trait);
    let max = roster[roster.length - 1].ranks.scores.trait;
	roster.forEach((crew, idx) => crew.ranks.scores.trait = Number((((1 - crew.ranks.scores.trait / max)) * 100).toFixed(4)));
}


function collectionScore(c: CrewMember, collections: Collection[]) {
    const crewcols = c.collection_ids.map(id => collections.find(f => f.id?.toString() == id?.toString())!);
    let cc = crewcols.length;
    let bu = 0;
    let cr = 0;
    for (let col of crewcols) {
        let buffs = getAllStatBuffs(col);
        bu += buffs.map(b => b.quantity!).reduce((p, n) => p + n, 0);
        let crews = getAllCrewRewards(col);
        cr += crews.map(c => c.quantity!).reduce((p, n) => p + n, 0);
    }
    return (bu * 3) + (cr * 2) + (cc * 1);
}

type RarityScore = { symbol: string, score: number, rarity: number, data?: any, greatness?: number, greatness_details?: GreatnessDetails };

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
    const crewCSV = fs.readFileSync(STATIC_PATH + 'crew.csv', 'utf-8').split('\r\n');
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

    const highgreats = ['voyage', 'shuttle', 'gauntlet', 'ship', 'quipment', 'collections'];

    const greatpowers = {
        greater: 1,
        lesser: 0.25,
    }

    const greatStash = {} as { [key:string]: GreatnessDetails[] };

    CONFIG.RARITIES.forEach((data, idx) => {
        let c = { max_rarity: idx + 1};

        Weights[c.max_rarity] ??= {
            voyage: 3                   + ((c.max_rarity) * (c.max_rarity / 5)),
            skill_rarity: 2.75          - (0.2 * (5 - c.max_rarity)),
            gauntlet: 1.70              + (0.2 * (5 - c.max_rarity)),
            shuttle: 1                  - (0.1 * (5 - c.max_rarity)),
            quipment: 0.95              + (0.3 * (5 - c.max_rarity)),
            collections: 0.5            + (1.5 * (5 - c.max_rarity)),
            trait: 0.35                 + (0.5 * (5 - c.max_rarity)),
            crit: 0.267,
            ship: 0.275                 + (0.65 * (5 - c.max_rarity)),
            am_seating: 0.25            - (0.07 * (5 - c.max_rarity)),
            greatness: 0.2,
            velocity: 0.13,
            potential_cols: 0.1         + (0.17 * (5 - c.max_rarity)),
            main_cast: 0.1              + (0.1 * (5 - c.max_rarity)),
            variant: 0.08               + (0.02 * (5 - c.max_rarity)),
            skill_positions: 0.05       - (0.2 * (5 - c.max_rarity)),
            voyage_plus: 0.05,
            shuttle_plus: 0.05,
            gauntlet_plus: 0.05,
            tertiary_rarity: 0.01,
            primary_rarity: 0.01,
            voyage_plus_weights: {
                voyage: 1,
                am_seating: 0.2,
                quipment: 0.75
            },
            gauntlet_plus_weights: {
                gauntlet: 1,
                crit: 0.75,
                quipment: 0.5
            },
            base_plus_weights: {
                shuttleRank: 1,
                quipment: 0.5
            }
        }

    });

    function getEvenDistributions(scores: RarityScore[]) {
        const result = scores.map(score => ({ ...score }));
        return normalize(result, false, false, false, scores.length);
    }

    function measureGreatness(results: RarityScore[], name: string) {
        for (let rarity = 1; rarity <= 5; rarity++) {
            let workset = results.filter(f => f.rarity === rarity);
            let distrs = getEvenDistributions(workset);
            distrs.forEach(d => d.score = distrs.length - d.score);
            workset.forEach((item, idx) => {
                let dist = distrs.find(f => f.symbol === item.symbol)!;
                item.greatness = idx - dist.score;
                item.greatness_details = {
                    name,
                    rank: 0,
                    score: item.greatness,
                    rarity: item.rarity
                };
            });

            workset.sort((a, b) => a.greatness! - b.greatness!);
            let min = workset[0].greatness!;

            if (min < 0) {
                workset.forEach(ws => ws.greatness! -= min);
                workset.sort((a, b) => a.greatness! - b.greatness!);
            }

            let max = workset[workset.length - 1].greatness!;

            for (let ws of workset) {
                ws.greatness = Number(((1 - (ws.greatness! / max)) * 100).toFixed(4));
                ws.greatness_details!.score = ws.greatness;
                greatStash[ws.symbol] ??= [];
                if (!greatStash[ws.symbol].some(g => g.name === name)) {
                    greatStash[ws.symbol].push(ws.greatness_details!);
                }
            }

            workset.forEach((item, idx) => item.greatness_details!.rank = idx + 1);
            workset.sort((a, b) => b.score - a.score);
        }
    }

    function normalize(results: RarityScore[], inverse?: boolean, min_balance?: boolean, not_crew?: boolean, base = 100, tie_breaker?: <T extends { symbol: string }>(a: T, b: T) => number) {
        return norm(results, inverse, min_balance, not_crew, base, (a, b) => {
            let r = 0;
            if (tie_breaker) {
                r = tie_breaker(a, b);
            }
            if (!r && crewNames[a.symbol] && crewNames[b.symbol]) {
                r = crewNames[a.symbol].localeCompare(crewNames[b.symbol]);
            }
            return r;
        });
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
        results = normalize(results);
        measureGreatness(results, mode);
        return results;
    }

    const maxDate = crew.filter(c => !c.preview).map(c => (new Date(c.date_added)).getTime()).sort((a,b) => b - a)[0];

    const dateGradient = (() => {
        const Epoch = (new Date("2016-01-01T00:00:00Z")).getTime();
        const output = [] as RarityScore[];
        const week = (1000 * 60 * 60 * 24 * 7);
        origCrew.forEach((c) => {
            let d = new Date(c.date_added);
            if (c.preview) d = new Date(maxDate);
            output.push({
                symbol: c.symbol,
                score: Math.floor((d.getTime() - Epoch) / week),
                rarity: c.max_rarity
            });
        });
        return normalize(output);
    })();

    /** Begin the scoring section */

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
    measureGreatness(results, "trait");
    let traits = results;

    if (DEBUG) console.log("Traits")
    if (DEBUG) console.log(traits.slice(0, 20));

    const skills = CONFIG.SKILLS_SHORT.map(m => m.name);

    const quip_sections = [[...skills], [skills[0]], [skills[1]], [skills[2]], [skills[3]], [skills[4]], [skills[5]], [...skills]];

    let allpowers = [] as RarityScore[][];
    let allpowersP = [] as QPowers[][];
    let allpowersV = [] as QPowers[][];

    quip_sections.forEach((batch, idx) => {
        let testquipment = quipment.filter(f => Object.keys(f.bonusInfo.bonuses).some((b) => batch.includes(b)));
        if (idx && batch.length > 1) testquipment = testquipment.filter(f => f.item.traits_requirement?.length);

        let testcrew = crew.filter(c => c.skill_order.some(b => batch.includes(b)));
        results = [].slice();

        if (!QUIET) console.log(`Scoring ${batch.length > 1 ? 'all' : batch[0]} quipment using sorting method...`);
        let qpowersV = sortingQuipmentScoring(testcrew, testquipment, maxbuffs, true);
        let qpowers = [] as QPowers[];
        let qpowersP = [] as QPowers[];

        if (!QUIET) console.log(`Scoring ${batch.length > 1 ? 'all' : batch[0]} quipment using power method...`);
        for (let c of testcrew) {
            let data = scoreQuipment(c, testquipment, maxbuffs, batch.length === 1 ? batch[0] : undefined, true);
            qpowers.push(data);
        }

        qpowersP = JSON.parse(JSON.stringify(qpowers));

        for (const qp of qpowers) {
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
        allpowersP.push(qpowersP);
        allpowersV.push(qpowersV);
        allpowers.push(normalize(results));

        if (DEBUG) console.log("Quipment Score")
        if (DEBUG) console.log(allpowers[allpowers.length - 1].slice(0, 20));
    });

    let quips = allpowers[0];
    measureGreatness(quips, "quipment");

    let qpowersP = allpowersP[0];
    let qpowersV = allpowersV[0];

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
    measureGreatness(cols, "collections");
    if (DEBUG) console.log("Collections")
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
    measureGreatness(skillrare, 'skill_rarity');
    skillpos = normalize(skillpos);
    measureGreatness(skillpos, 'skill_positions');

    if (DEBUG) console.log("Skill-Order Rarity")
    if (DEBUG) console.log(skillrare.slice(0, 20));

    if (DEBUG) console.log("Triplet Power")
    if (DEBUG) console.log(skillpos.slice(0, 20));

    if (!QUIET) console.log("Scoring primary skill rarity...");

    results = [].slice();

    for (let c of crew) {
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: priRare(c, buckets[c.max_rarity])
        });
    }

    let prirare = normalize(results, true);
    measureGreatness(prirare, "primary_rarity");

    if (DEBUG) console.log("Primary Rarity")
    if (DEBUG) console.log(prirare.slice(0, 20));

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
    measureGreatness(tertrare, 'tertiary_rarity');
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
    measureGreatness(velocities, 'velocity');
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
    measureGreatness(pcolscores, 'potential_cols');

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
    measureGreatness(elacrits, 'crit');

    if (DEBUG) console.log("Elevated Crit Gauntlet Score")
    if (DEBUG) console.log(elacrits.slice(0, 20));

    if (!QUIET) console.log("Scoring Antimatter traits...");

    results = [].slice();

    for (let c of crew) {
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: c.traits.map(m => lookupAMSeatsByTrait(m).filter(skill => c.skill_order.includes(skill))).flat().length
        });
    }

    let amseats = normalize(results);
    measureGreatness(amseats, 'am_seating');

    if (DEBUG) console.log("Antimatter Seats")
    if (DEBUG) console.log(amseats.slice(0, 20));

    if (!QUIET) console.log("Scoring main-cast...");

    results = [].slice();

    for (let c of crew) {
        let cs = castScore(c, crew, maincast);
        let fm = dateGradient.find(f => f.symbol === c.symbol)!;
        cs = (cs + fm.score) / 2;
        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: cs
        });
    }

    let mains = normalize(results, false, false, false, 100, (a, b) => {
        let av = mainCastValue(a.symbol, maincast);
        let bv = mainCastValue(b.symbol, maincast);
        let r = 0;
        if (av && bv) r = av - bv;
        // else if (av) r = -1;
        // else if (bv) r = 1;
        // if (!r) {
        //     let acrew = crew.find(f => f.symbol === a.symbol);
        //     let bcrew = crew.find(f => f.symbol === b.symbol);
        //     if (acrew && bcrew) {
        //         r = ((new Date(bcrew.date_added)).getTime()) - ((new Date(acrew.date_added)).getTime());
        //     }
        // }
        return r;
    });

    measureGreatness(mains, 'main_cast');

    if (DEBUG) console.log("Main cast score")
    if (DEBUG) console.log(mains.slice(0, 20));

    if (!QUIET) console.log("Scoring crew variants/events...");

    results = [].slice();

    // let events = eventScoring();

    // for (let c of crew) {
    //     let ev = events.crew.find(evc => evc.symbol === c.symbol);
    //     if (ev) {
    //         results.push({
    //             symbol: c.symbol,
    //             rarity: c.max_rarity,
    //             score: ev.score
    //         });
    //     }
    //     else {
    //         results.push({
    //             symbol: c.symbol,
    //             rarity: c.max_rarity,
    //             score: 0
    //         });
    //     }
    // }
    for (let c of crew) {
        let variants = getVariantTraits(c);
        let vs = variantScore(variants, crew);
        let fm = dateGradient.find(f => f.symbol === c.symbol)!;
        vs = (vs + fm.score) / 2;

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: vs
        });
    }

    let variants = normalize(results);

    measureGreatness(variants, 'variant');

    if (DEBUG) console.log("Variant/event score")
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

        let gplus = Weights[c.max_rarity].gauntlet_plus_weights;

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: ((gauntlet_n * gplus.gauntlet) + (crit_n * gplus.crit) + ((qp?.gpower ?? quip_n) * gplus.quipment)) / 3
        });
    }

    let gauntlet_plus = normalize(results);
    measureGreatness(gauntlet_plus, 'gauntlet_plus');

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

        let vplus = Weights[c.max_rarity].voyage_plus_weights;

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: ((voyage_n * vplus.voyage) + (amseat_n * vplus.am_seating) + ((qp?.vpower ?? quip_n) * vplus.quipment)) / 3
        });
    }

    let voyage_plus = normalize(results);
    measureGreatness(voyage_plus, 'voyage_plus');

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

        let bplus = Weights[c.max_rarity].base_plus_weights;

        results.push({
            symbol: c.symbol,
            rarity: c.max_rarity,
            score: ((shuttle_n * bplus.shuttleRank) + ((qp?.bpower ?? quip_n) * bplus.quipment)) / 2
        });
    }

    let shuttle_plus = normalize(results);
    measureGreatness(shuttle_plus, 'shuttle_plus');

    if (DEBUG) console.log("Shuttle-Plus score")
    if (DEBUG) console.log(shuttle_plus.slice(0, 20));

    results = [].slice();
    results = crew.map(c => ({
        symbol: c.symbol,
        score: c.ranks.scores.ship.overall,
        rarity: c.max_rarity
    }));

    results.sort((a, b) => b.score - a.score);
    measureGreatness(results, 'ship');

    results = [].slice();
    if (!QUIET) console.log("Scoring greatness...");
    results = Object.entries(greatStash).map(([symbol, great]) => {
        let c = crew.find(f => f.symbol === symbol)!;
        let score = great.reduce((p, n) => {
            let res = n.score;
            if (highgreats.includes(n.name)) {
                res *= greatpowers.greater;
            }
            else {
                res *= greatpowers.lesser;
            }
            return res + p;
        }, 0);
        return {
            symbol,
            score,
            rarity: c.max_rarity
        } as RarityScore
    });

    [1,2,3,4,5].forEach((rarity) => {
        let rareres = results.filter(f => f.rarity === rarity);
        normalize(rareres);
    });

    results.sort((a, b) => b.rarity - a.rarity || b.score - a.score);
    let greatness = results;

    results = [].slice();
    if (!QUIET) console.log("Applying weights and final scoring...");

    for (let c of origCrew) {
        c.ranks.scores.greatness_details = greatStash[c.symbol] ?? [].slice();

        let gauntlet_n = gauntlet.find(f => f.symbol === c.symbol)!.score;
        let voyage_n = voyage.find(f => f.symbol === c.symbol)!.score;
        let i_core_n = shuttle.findIndex(f => f.symbol === c.symbol);
        let core_n = shuttle[i_core_n].score;

        c.ranks.scores.gauntlet = gauntlet_n;
        c.ranks.scores.voyage = voyage_n;
        c.ranks.scores.shuttle = core_n;
        c.ranks.shuttleRank = i_core_n + 1;

        let i_greatness_n = greatness.findIndex(f => f.symbol === c.symbol);
        let greatness_n = greatness[i_greatness_n].score;

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

        let i_pri_rare_n = prirare.findIndex(f => f.symbol === c.symbol);
        let pri_rare_n = prirare[i_pri_rare_n].score;

        let i_amseat_n = amseats.findIndex(f => f.symbol === c.symbol);
        let amseat_n = amseats[i_amseat_n].score;

        let i_quip_n = quips.findIndex(f => f.symbol === c.symbol);
        let quipment_n = quips[i_quip_n].score;

        c.ranks.scores.quipment_details = { ...quips[i_quip_n].data as QuipmentDetails ?? {} };

        if (c.ranks.scores.quipment_details) {
            delete c.ranks.scores.quipment_details["symbol"];
        }

        (c.ranks.scores).power_quipment_details = qpowersP.find(f => f.symbol === c.symbol) as QuipmentDetails;
        delete (c.ranks.scores).power_quipment_details["symbol"];

        (c.ranks.scores).versatility_quipment_details = qpowersV.find(f => f.symbol === c.symbol) as QuipmentDetails;
        delete (c.ranks.scores).versatility_quipment_details["symbol"];

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

        c.ranks.scores.greatness = greatness_n;
        c.ranks.scores.greatness_rank = i_greatness_n + 1;

        c.ranks.scores.main_cast = maincast_n;
        c.ranks.main_cast_rank = i_maincast_n + 1;

        c.ranks.scores.variant = variant_n;
        c.ranks.variant_rank = i_variant_n + 1;

        c.ranks.scores.skill_positions = skpos_n;
        c.ranks.skill_positions_rank = i_pos_n + 1;

        c.ranks.scores.skill_rarity = sko_rare_n;
        c.ranks.skill_rarity_rank = i_sk_rare_n + 1;

        c.ranks.scores.primary_rarity = pri_rare_n;
        c.ranks.primary_rarity_rank = i_pri_rare_n + 1;

        c.ranks.scores.tertiary_rarity = tert_rare_n;
        c.ranks.tertiary_rarity_rank = i_tert_rare_n + 1;

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

        // Quipment
        c.ranks.scores.quipment = quipment_n;
        c.ranks.quipment_rank = i_quip_n + 1;

        c.quipment_score = quipment_n;
        c.quipment_scores = {
            command_skill: 0,
            diplomacy_skill: 0,
            engineering_skill: 0,
            security_skill: 0,
            science_skill: 0,
            medicine_skill: 0,
            trait_limited: 0
        }
        quip_sections[0].forEach((skill, idx) => {
            let s_quipment_n = allpowers[idx + 1].find(f => f.symbol === c.symbol)?.score || 0;
            c.quipment_scores![skill] = s_quipment_n;
        });

        c.quipment_scores.trait_limited = allpowers[allpowers.length - 1].find(f => f.symbol === c.symbol)?.score || 0;

        const weight = Weights[c.max_rarity];

        vplus_n *= weight.voyage_plus;
        gplus_n *= weight.gauntlet_plus;
        splus_n *= weight.shuttle_plus;

        greatness_n *= weight.greatness;

        voyage_n *= weight.voyage;
        sko_rare_n *= weight.skill_rarity;
        gauntlet_n *= weight.gauntlet;
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
        pri_rare_n *= weight.primary_rarity;
        variant_n *= weight.variant;

        let scores = [
            greatness_n,
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
            pri_rare_n,
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
        //let rank_mul = 6 * (filtered[0].score - filtered[1].score);
        let rank_mul = filtered.length / (filtered.length / (6 * (filtered[0].score - filtered[1].score)));
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

    if (!QUIET) console.log("Updating crew CSV...");
    updateCrewCsv(crewCSV, origCrew, collections);

    fs.writeFileSync(STATIC_PATH + 'crew.csv', crewCSV.join("\r\n"));

    if (!QUIET) console.log("Writing current_weighting.json...");
    fs.writeFileSync(STATIC_PATH + 'current_weighting.json', JSON.stringify(Weights));

    if (!process.argv.includes("--nochange")) {
        const digestPath = `${SCRIPTS_DATA_PATH}change_log_digest.json`;
        const changeFile = `change_log_${(new Date()).getTime()}.json`;
        const changePath = `${SCRIPTS_DATA_PATH}${changeFile}`;

        let old = [] as Digest[];
        const current = makeLogFormat(origCrew);
        if (fs.existsSync(digestPath)) {
            old = JSON.parse(fs.readFileSync(digestPath, 'utf-8')) as Digest[];
        }
        const change_log = makeChangeLog(old, current);

        if (!QUIET) console.log("Writing change_log_digest.json...");
        fs.writeFileSync(digestPath, JSON.stringify(current, null, 4));
        if (change_log.length) {
            if (!QUIET) console.log(`Writing ${changeFile}...`);
            fs.writeFileSync(changePath, JSON.stringify(change_log, null, 4));
        }
    }
    else {
        console.log(`Not writing a change log.`);
    }

    if (!QUIET) console.log("Done.");
}

type Digest = {
    symbol: string,
    name: string,
    rarity: number,
    rank: number,
    rarity_rank: number,
    grade: string;
}

type Change = {
    symbol: string,
    rarity: number,
    is_new: boolean,
    is_published: boolean,
    old?: {
        name: string,
        rank: number,
        rarity_rank: number,
        grade: string
    },
    current: {
        name: string,
        rank: number,
        rarity_rank: number,
        grade: string
    }
}

function makeChangeLog(old: Digest[], current: Digest[]) {
    const result = [] as Change[];
    for (let obj of current) {
        let objold = old.find(f => f.symbol === obj.symbol);
        if (objold) {
            if (obj.grade !== objold.grade || obj.rank !== objold.rank || obj.rarity_rank !== objold.rarity_rank || obj.name !== objold.name) {
                result.push({
                    symbol: obj.symbol,
                    rarity: obj.rarity,
                    is_new: false,
                    is_published: false,
                    old: {
                        name: objold.name,
                        rank: objold.rank,
                        rarity_rank: objold.rarity_rank,
                        grade: objold.grade
                    },
                    current: {
                        name: obj.name,
                        rank: obj.rank,
                        rarity_rank: obj.rarity_rank,
                        grade: obj.grade
                    }
                });
            }
        }
        else {
            result.push({
                symbol: obj.symbol,
                rarity: obj.rarity,
                is_new: true,
                is_published: false,
                current: {
                    name: obj.name,
                    rank: obj.rank,
                    rarity_rank: obj.rarity_rank,
                    grade: obj.grade
                }
            });
        }
    }
    return result;
}

function makeLogFormat(origCrew: CrewMember[]) {
    let p = [] as Digest[];
    for (let c of origCrew) {
        p.push({
            symbol: c.symbol,
            name: c.name,
            rarity: c.max_rarity,
            rank: c.ranks.scores.overall_rank,
            rarity_rank: c.ranks.scores.rarity_overall_rank,
            grade: c.ranks.scores.overall_grade
        });
    }
    return p;
}

function updateCrewCsv(csv: string[], crew: CrewMember[], collections: Collection[]) {
    const { vanity, statBoosting, crewCols } = splitCollections(collections);

    if (csv[0].includes('potential_collections')) return;
    csv[0] += ", shuttle_rank, collections_rank, ship_rank, overall_rank, stat_collections, crew_collections, vanity_collections, potential_collections";
    let idx = 1;
    for (let c of crew) {
        let r = c.ranks.scores;
        let van = c.collection_ids.filter(id => vanity.some(vi => vi.id == Number(id)));
        let stat = c.collection_ids.filter(id => statBoosting.some(vi => vi.id == Number(id)));
        let cc = c.collection_ids.filter(id => crewCols.some(vi => vi.id == Number(id)));

        csv[idx++] += `, ${r.shuttle}, ${r.collections}, ${r.ship.overall}, ${r.overall}, ${stat.length}, ${cc.length}, ${van.length}, ${r.potential_cols}`;
    }
}

(async () => {
    if (process.argv.includes("--wait")) {
        await new Promise((resolve, reject) => setTimeout(resolve, 10000));
    }
    if (process.argv[1].includes('scoring')) {
        score();
    }
})();

