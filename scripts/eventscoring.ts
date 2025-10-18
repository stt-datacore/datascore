
import * as fs from 'fs';
import { CrewMember } from '../../website/src/model/crew';
import { GameEvent } from '../../website/src/model/player';
import { TraitNames, TranslationSet } from '../../website/src/model/traits';
import { getVariantTraits } from '../../website/src/utils/crewutils';
import { getEventData } from '../../website/src/utils/events';

const DEBUG = process.argv.includes("--debug");

const STATIC_PATH = `${__dirname}/../../../../website/static/structured/`;

interface EventScoring {
    type: 'crew' | 'trait' | 'variant';
    symbol: string;
    score: number;
}

const series = ['discovery', 'voyager', 'enterprise', 'stt originals', 'deep space 9', 'deep space nine', 'next generation', 'lower decks', 'strange new worlds', 'starfleet academy'];
const short = ['dsc', 'voy', 'ent', 'original', 'ds9', 'ds9', 'tng', 'low', 'snw', 'sfa'];

export function getEventBonusTrait(event: GameEvent, crew: CrewMember[], trait_names: TraitNames) {
    let keys = Object.keys(trait_names);
    let values = Object.values(trait_names);
    let traits = {} as {[key: string]: number};
    const words = event.bonus_text.replace('Crew Bonus: ', '').replace('Bonus: ', '').replace(' crew', '').replace('(Ship/Crew)', '').replace('(Ship)', '').replace('(Crew)', '').replace(/\sor\s/, ',').split(',').filter(word => word !== '').map(s => s.trim().replace(" Crew", ""));
    words.forEach((w, idx) => {
        if (idx === words.length - 1) {
            let fc = crew.find(ff => ff.short_name === w);
            if (fc) return;
        }
        if (w === 'Xenoanthropologists') {
            traits['xenoanthropology'] ??= 0;
            traits['xenoanthropology']++;
            //etraits.push('xenoanthropology');
            return;
        }
        else if (w === 'Thieves') {
            traits['thief'] ??= 0;
            traits['thief']++;
            //etraits.push('thief');
            return;
        }
        else if (w.includes('Tribble')) {
            traits['tribbled'] ??= 0;
            traits['tribbled']++;
            //etraits.push('tribbled');
            return;
        }

        let f = values.findIndex(trait => trait === w || trait === w.slice(0, w.length - 1) || w.includes(trait));
        if (f === -1) {
            f = keys.findIndex(trait => trait === w || trait === w.slice(0, w.length - 1) || w.includes(trait));
        }
        if (f !== -1 || ['animated'].includes(w.toLowerCase())) {
            traits[keys[f]] ??= 0;
            traits[keys[f]]++;
            //etraits.push(keys[f]);
        }
        else {
            f = series.findIndex(seri => w.toLowerCase().includes(seri));
            if (f !== -1) {
                traits[short[f]] ??= 0;
                traits[short[f]]++;
                //etraits.push(short[f]);
            }
            f = short.findIndex(seri => w.toLowerCase().includes(seri));
            if (f !== -1) {
                traits[short[f]] ??= 0;
                traits[short[f]]++;
                //etraits.push(short[f]);
            }
        }
    });
    return traits;
}

export function eventScoring() {
    const inputCrew = JSON.parse(fs.readFileSync(`${STATIC_PATH}crew.json`, 'utf-8')) as CrewMember[];
    const translations = JSON.parse(fs.readFileSync(`${STATIC_PATH}translation_en.json`, 'utf-8')) as TranslationSet;

    const publicTraits = [...new Set(inputCrew.map(c => c.traits).flat())];

    const featured_crew = {} as {[key: string]: number };
    const bonus_traits = {} as {[key: string]: number };
    const variant_traits = {} as {[key: string]: number };

    const crew_score = {} as {[key: string]: number };
    const variant_score = {} as {[key: string]: number };
    const variant_ref = {} as {[key: string]: number };

    for (let c of inputCrew) {
        let vt = getVariantTraits(c);
        for (let v of vt) {
            variant_ref[v] ??= 0;
            variant_ref[v]++;
        }
    }

    for (let efile of fs.readdirSync(`${STATIC_PATH}events`)) {
        const event = JSON.parse(fs.readFileSync(`${STATIC_PATH}events/${efile}`, 'utf-8')) as GameEvent;
        const eventData = getEventData(event, inputCrew);

        if (eventData) {
            for (let fc of eventData.featured) {
                featured_crew[fc] ??= 0;
                featured_crew[fc] += 1;
            }
            for (let fc of eventData.bonus) {
                crew_score[fc] ??= 0;
                crew_score[fc] += 1;
            }
            if (eventData.activeContent?.bonus_traits?.length) {
                for (let bc of eventData.activeContent.bonus_traits) {
                    if (variant_ref[bc]) {
                        variant_traits[bc] ??= 0;
                        variant_traits[bc] += 1;
                    }
                    else if (publicTraits.includes(bc)) {
                        bonus_traits[bc] ??= 0;
                        bonus_traits[bc] += 1;
                    }
                }
            }
            else {
                let traits = getEventBonusTrait(event, inputCrew, translations.trait_names);
                Object.entries(traits).forEach(([trait, count]) => {
                    bonus_traits[trait] ??= 0;
                    bonus_traits[trait] += count;
                });
            }
        }
    }

    Object.entries(bonus_traits).forEach(([trait, score]) => {
        let filtered = inputCrew.filter(f => f.traits.includes(trait) || f.traits_hidden.includes(trait));
        for (let c of filtered) {
            crew_score[c.symbol] ??= 0;
            crew_score[c.symbol] += score;
        }
    });

    Object.entries(variant_traits).forEach(([trait, score]) => {
        let filtered = inputCrew.filter(f => f.traits.includes(trait) || f.traits_hidden.includes(trait));
        variant_score[trait] = score * filtered.length;
        for (let c of filtered) {
            crew_score[c.symbol] ??= 0;
            crew_score[c.symbol] += score;
        }
    });

    Object.entries(featured_crew).forEach(([symbol, score]) => {
        let c = inputCrew.find(f => f.symbol === symbol);
        if (!c) {
            console.log(`${c} not found!`);
            return;
        }
        crew_score[c.symbol] ??= 0;
        crew_score[c.symbol] += score * 10;
    });

    let crewobj = Object.entries(crew_score).map(([symbol, score]) => ({
        type: 'crew',
        symbol,
        score
    } as EventScoring));

    crewobj.sort((a, b) => b.score - a.score);

    let traitobj = Object.entries(bonus_traits).map(([symbol, score]) => ({
        type: 'trait',
        symbol,
        score
    } as EventScoring));

    traitobj.sort((a, b) => b.score - a.score);

    let variantobj = Object.entries(variant_score).map(([symbol, score]) => ({
        type: 'variant',
        symbol,
        score
    } as EventScoring));

    variantobj.sort((a, b) => b.score - a.score);

    if (DEBUG) console.log(`Crew Event Scores`);
    if (DEBUG) console.log(crewobj.slice(0, 20));

    if (DEBUG) console.log(`Trait Event Scores`);
    if (DEBUG) console.log(traitobj.slice(0, 20));

    if (DEBUG) console.log(`Variant Event Scores`);
    if (DEBUG) console.log(variantobj.slice(0, 20));

    return {
        crew: crewobj,
        variants: variantobj,
        traits: traitobj
    }
}

if (process.argv.includes('--runes')) {
    eventScoring();
}
