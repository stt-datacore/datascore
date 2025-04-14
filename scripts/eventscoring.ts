
import * as fs from 'fs';
import { GameEvent } from '../../website/src/model/player';
import { CrewMember } from '../../website/src/model/crew';
import { getVariantTraits } from '../../website/src/utils/crewutils';
import { getEventData } from '../../website/src/utils/events';

const DEBUG = process.argv.includes("--debug");

const STATIC_PATH = `${__dirname}/../../../../website/static/structured/`;

interface EventScoring {
    type: 'crew' | 'trait' | 'variant';
    symbol: string;
    score: number;
}

export function eventScoring() {

    const inputCrew = JSON.parse(fs.readFileSync(`${STATIC_PATH}crew.json`, 'utf-8')) as CrewMember[];

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
