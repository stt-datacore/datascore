import { CrewMember } from "../../../website/src/model/crew";
import { Ship } from "../../../website/src/model/ship";
import { getPermutations } from "../../../website/src/utils/misc";
import { canSeatAll } from "../../../website/src/workers/battleworkerutils";

export function getSeatingCombos(set: CrewMember[], ship: Ship, ignore_skill = false) {
    let c = ship.battle_stations!.length;
    let cbs = [] as number[][];
    for (let i = 0; i < c; i++) {
        for (let j = 0; j < c; j++) {
            cbs.push([i, j]);
        }
    }

    const allseat = getPermutations<number[], number[]>(cbs, c).filter((f) => {
        let xseen = ship.battle_stations!.map(x => false);
        let yseen = ship.battle_stations!.map(x => false);
        for (let [x, y] of f) {
            xseen[x] = true;
            yseen[y] = true;
        }
        return (xseen.every(x => x) && yseen.every(y => y));
    });

    return canSeatAll(allseat, ship, set, !!ignore_skill);
}

export function createMulitpleShips(ship: Ship) {
    if (!ship.battle_stations?.length || !ship.battle_stations.every(e => e.crew)) return false;
    let set = ship.battle_stations!.map(m => m.crew!);
    let result = getSeatingCombos(set, ship);
    if (!result) {
        result = getSeatingCombos(set, ship, true);
    }
    if (result) {
        let ships: Ship[] = [];
        for (let sub of result) {
            let newship: Ship = JSON.parse(JSON.stringify(ship));
            let c = newship.battle_stations!.length;
            for (let i = 0; i < c; i++) {
                newship.battle_stations![i].crew = sub[i];
            }
            ships.push(newship);
        }
        return ships;
    }
    return false;
}