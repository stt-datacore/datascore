import fs from 'fs';
import { getVariantTraits } from '../../website/src/utils/crewutils';
import { CrewMember, CrossFuseInfo, CrossFuseTarget } from "../../website/src/model/crew";
import { keyInPause } from 'readline-sync';
const STATIC_PATH = `${__dirname}/../../../../website/static/structured/`;

export function calcFuses() {
    const DEBUG = process.argv.includes("--debug");
    if (DEBUG) console.log("Calculating exclusive fusions...");
    const crew = JSON.parse(fs.readFileSync(STATIC_PATH + 'crew.json', 'utf-8')) as CrewMember[];

    let filtered = crew.filter(f => (f.cross_fuse_targets as CrossFuseTarget)?.symbol);
    const seen = {} as any;

    const crossFuses = [] as CrossFuseInfo[];

    filtered.forEach((f) => {
        let cf = f.cross_fuse_targets as CrossFuseTarget;
        let vta = getVariantTraits(f);
        let cfc = crew.find (f => f.symbol === cf.symbol);
        if (cfc) {
            let vtb = getVariantTraits(cfc);

            let potential = crew.find(c => c.obtained.toLowerCase().includes('fus') && c.traits_hidden.some(tr => vta.includes(tr) && c.traits_hidden.some(tr => vtb.includes(tr))));
            if (potential) {
                if (seen[potential.symbol]) return;
                seen[potential.symbol] = true;
                crossFuses.push({
                    sources: [f.symbol, cfc.symbol],
                    result: potential.symbol
                });
                if (DEBUG) console.log(`${f.name} + ${cfc.name} => ${potential.name}`);
            }
            else {
                potential = crew.find(c => c.obtained.toLowerCase().includes("fus") && c.traits_hidden.some(tr => vta.includes(tr) || c.traits_hidden.some(tr => vtb.includes(tr))));
                if (potential) {
                    if (seen[potential.symbol]) return;
                    seen[potential.symbol] = true;
                    crossFuses.push({
                        sources: [f.symbol, cfc.symbol],
                        result: potential.symbol
                    });
                    if (DEBUG) console.log(`${f.name} + ${cfc.name} => ${potential.name}`);
                }
            }
        }
    });

    for (let fuse of crossFuses) {
        let c = crew.find(f => f.symbol === fuse.result)!;
        c.cross_fuse_sources = fuse.sources;
    }

    fs.writeFileSync(`${STATIC_PATH}crew.json`, JSON.stringify(crew));
    if (DEBUG) console.log("Fusions saved to crew.json.");
    return crossFuses;
}

// function main() {
//     const fuses = calcFuses();
// }

// main();

