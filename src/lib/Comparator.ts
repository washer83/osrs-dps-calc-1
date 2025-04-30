import { Player, PlayerSkills } from '@/types/Player'; //
import { Monster } from '@/types/Monster'; //
import { scaleMonster, scaleMonsterHpOnly } from '@/lib/MonsterScaling'; //
import { max } from 'd3-array';
import { keys, typedMerge } from '@/utils'; //
import { CalcOpts } from '@/lib/BaseCalc'; //
import { PartialDeep } from 'type-fest';
import merge from 'lodash.mergewith'; //
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc'; //
import NPCVsPlayerCalc from '@/lib/NPCVsPlayerCalc'; //
import { ChartAnnotation, ChartEntry } from '@/types/State'; //
import { DPS_PRECISION } from '@/lib/constants'; //

// Enums (no changes needed)
export enum CompareXAxis { MONSTER_DEF, MONSTER_MAGIC, MONSTER_HP, PLAYER_ATTACK_LEVEL, PLAYER_STRENGTH_LEVEL, PLAYER_RANGED_LEVEL, PLAYER_MAGIC_LEVEL, STAT_DECAY_RESTORE, PLAYER_DEFENCE_LEVEL, MONSTER_DEF_INITIAL } //
export enum CompareYAxis { PLAYER_DPS, PLAYER_EXPECTED_HIT, MONSTER_DPS, DAMAGE_TAKEN, PLAYER_TTK, PLAYER_MAX_HIT, MONSTER_EXPECTED_DEF_AFTER_SPEC } //

// Interfaces (no changes needed)
interface InputSet { xValue: number, loadouts: Player[], monster: Monster } //
export interface CompareResult { entries: ChartEntry[], annotations: { x: ChartAnnotation[], y: ChartAnnotation[] }, domainMax: number } //

export default class Comparator {
  private readonly baseLoadouts: Player[];

  private readonly originalMonster: Monster;

  private readonly scaledBaseMonster: Monster;

  private readonly xAxis: CompareXAxis;

  private readonly yAxis: CompareYAxis;

  private readonly commonOpts: CalcOpts;

  constructor(players: Player[], monster: Monster, xAxis: CompareXAxis, yAxis: CompareYAxis) {
    this.baseLoadouts = players;
    this.originalMonster = monster;
    this.scaledBaseMonster = scaleMonster(monster);
    this.xAxis = xAxis;
    this.yAxis = yAxis;
    this.commonOpts = {
      loadoutName: 'comparator',
      disableMonsterScaling: true,
    };
  }

  // --- calculateExpectedDefenceReductionValue (Helper function - no change needed from previous correct version) ---
  // Calculates reduction for the specific player/weapon passed in. Returns 0 if weapon is not relevant.
  private calculateExpectedDefenceReductionValue(player: Player, monsterForCalc: Monster): number {
    const weaponName = player.equipment.weapon?.name;
    const relevantWeapons = ['Dragon warhammer', 'Bandos godsword', 'Tonalztics of ralos', 'Elder maul']; // Define weapons with defence reduction specs

    if (!weaponName || !relevantWeapons.includes(weaponName)) {
      return 0; // Not a relevant weapon, or no weapon equipped
    }

    // Proceed only if the weapon is relevant
    const calcOpts: CalcOpts = {
      ...this.commonOpts,
      usingSpecialAttack: true,
    };
    const calc = new PlayerVsNPCCalc(player, monsterForCalc, calcOpts);
    return calc.getExpectedDefReduction();
  }

  // --- inputsIterator (no changes needed) ---
  private* inputsIterator(): Generator<InputSet> {
    const monsterInput = (x: number, alterations: PartialDeep<Monster>): InputSet => ({
      xValue: x,
      loadouts: this.baseLoadouts,
      monster: merge({}, this.originalMonster, alterations) as Monster,
    });
    const playerInput = (x: number, alterations: PartialDeep<Player>): InputSet => ({
      xValue: x,
      loadouts: this.baseLoadouts.map((p) => typedMerge(p, alterations)),
      monster: this.originalMonster,
    });
    const skillInput = (x: number, stat: keyof PlayerSkills): InputSet => playerInput(x, { skills: { [stat]: x }, boosts: { [stat]: 0 } });

    switch (this.xAxis) {
      case CompareXAxis.MONSTER_DEF:
      case CompareXAxis.MONSTER_DEF_INITIAL:
      { const initialDef = this.scaledBaseMonster.skills.def;
        for (let currentInitialDef = initialDef; currentInitialDef >= 0; currentInitialDef--) {
          yield monsterInput(currentInitialDef, { skills: { def: currentInitialDef } });
        }
        return; }
      // --- Other cases ---
      case CompareXAxis.MONSTER_MAGIC:
        for (let newMagic = this.scaledBaseMonster.skills.magic; newMagic >= 0; newMagic--) { yield monsterInput(newMagic, { skills: { magic: newMagic } }); } return;
      case CompareXAxis.MONSTER_HP: {
        const initialHp = this.scaledBaseMonster.skills.hp;
        for (let newHp = initialHp; newHp >= 0; newHp--) {
          const currentMonsterState = merge({}, this.originalMonster, { inputs: { monsterCurrentHp: newHp } });
          yield { xValue: newHp, loadouts: this.baseLoadouts, monster: scaleMonsterHpOnly(currentMonsterState) };
        }
        return;
      }
      case CompareXAxis.PLAYER_ATTACK_LEVEL:
        for (let newAttack = 0; newAttack <= 125; newAttack++) { yield skillInput(newAttack, 'atk'); } return;
      case CompareXAxis.PLAYER_STRENGTH_LEVEL:
        for (let newStrength = 0; newStrength <= 125; newStrength++) { yield skillInput(newStrength, 'str'); } return;
      case CompareXAxis.PLAYER_DEFENCE_LEVEL:
        for (let newDefence = 0; newDefence <= 125; newDefence++) { yield skillInput(newDefence, 'def'); } return;
      case CompareXAxis.PLAYER_RANGED_LEVEL:
        for (let newRanged = 0; newRanged <= 125; newRanged++) { yield skillInput(newRanged, 'ranged'); } return;
      case CompareXAxis.PLAYER_MAGIC_LEVEL:
        for (let newMagic = 0; newMagic <= 125; newMagic++) { yield skillInput(newMagic, 'magic'); } return;
      case CompareXAxis.STAT_DECAY_RESTORE: {
        const limit = max(this.baseLoadouts, (l) => max(keys(l.boosts), (k) => Math.abs(l.boosts[k]))) || 0;
        for (let restore = 0; restore <= limit; restore++) {
          const restoredLoadouts = this.baseLoadouts.map((p) => {
            const newBoosts: Partial<PlayerSkills> = {};
            keys(p.boosts).forEach((k) => {
              const boost = p.boosts[k]; if (boost === 0) return; const distFromZero = Math.abs(boost);
              if (restore >= distFromZero) { newBoosts[k] = 0; } else { newBoosts[k] = Math.sign(boost) * (distFromZero - restore); }
            });
            return Object.keys(newBoosts).length > 0 ? typedMerge(p, { boosts: newBoosts }) : p;
          });
          yield { xValue: restore, loadouts: restoredLoadouts, monster: this.originalMonster };
        }
        return;
      }
      default:
        throw new Error(`unimplemented xAxisType ${this.xAxis}`);
    }
  }

  // --- getOutput (Corrected for specific loadout reduction) ---
  private getOutput(x: InputSet): { [key: string]: string | undefined } {
    const res: { [key: string]: string | undefined } = {};

    let monsterForCalcs: Monster;
    if (this.yAxis === CompareYAxis.MONSTER_EXPECTED_DEF_AFTER_SPEC) {
      // Use the monster state directly from the iterator for defence reduction graph
      monsterForCalcs = x.monster;
    } else if (this.xAxis === CompareXAxis.MONSTER_HP) {
      monsterForCalcs = x.monster; // HP scaling handled in iterator
    } else {
      // Apply scaling for other graphs (DPS, TTK, etc.)
      monsterForCalcs = scaleMonster(x.monster);
    }

    if (this.yAxis === CompareYAxis.MONSTER_EXPECTED_DEF_AFTER_SPEC) {
      // Iterate through the actual loadouts provided for this iteration
      x.loadouts.forEach((loadout, i) => {
        const key = loadout.name || `Set ${i + 1}`;
        // Calculate the reduction value *only for this specific loadout*
        // The helper function returns 0 if the loadout's weapon isn't relevant
        const reductionValue = this.calculateExpectedDefenceReductionValue(loadout, monsterForCalcs);

        // Only add the result if the reduction is potentially non-zero
        // (i.e., the loadout has a relevant weapon)
        // We still might plot 0 if the expected reduction calculates to 0 at certain def levels.
        if (loadout.equipment.weapon?.name && ['Dragon warhammer', 'Bandos godsword', 'Tonalztics of ralos', 'Elder maul'].includes(loadout.equipment.weapon.name)) {
          res[key] = reductionValue.toFixed(3);
        } else {
          // Optional: You could explicitly add 'undefined' or a placeholder if you
          // want to ensure all loadouts *always* appear in the data structure,
          // but leaving it out means Recharts won't try to plot a line for it.
          // res[key] = undefined; // Or some placeholder like 'N/A' if needed
        }
      });
    } else {
      // --- Existing Y-Axis logic (no changes needed) ---
      const apply = (resultProvider: (calcInstance: PlayerVsNPCCalc | NPCVsPlayerCalc) => string | undefined) => {
        x.loadouts.forEach((l, i) => {
          const key = l.name || `Set ${i + 1}`;
          if ([CompareYAxis.PLAYER_DPS, CompareYAxis.PLAYER_EXPECTED_HIT, CompareYAxis.PLAYER_TTK, CompareYAxis.PLAYER_MAX_HIT].includes(this.yAxis)) {
            const calc = new PlayerVsNPCCalc(l, monsterForCalcs, this.commonOpts);
            res[key] = resultProvider(calc);
          } else if ([CompareYAxis.MONSTER_DPS, CompareYAxis.DAMAGE_TAKEN].includes(this.yAxis)) {
            const calc = new NPCVsPlayerCalc(l, monsterForCalcs, this.commonOpts);
            res[key] = resultProvider(calc);
          }
        });
      };
      switch (this.yAxis) {
        case CompareYAxis.PLAYER_DPS: apply((calc) => (calc as PlayerVsNPCCalc).getDps().toFixed(DPS_PRECISION)); break;
        case CompareYAxis.PLAYER_EXPECTED_HIT: apply((calc) => (calc as PlayerVsNPCCalc).getDistribution().getExpectedDamage().toFixed(DPS_PRECISION)); break;
        case CompareYAxis.PLAYER_TTK: apply((calc) => (calc as PlayerVsNPCCalc).getTtk()?.toFixed(DPS_PRECISION)); break;
        case CompareYAxis.MONSTER_DPS: apply((calc) => (calc as NPCVsPlayerCalc).getDps().toFixed(DPS_PRECISION)); break;
        case CompareYAxis.DAMAGE_TAKEN: apply((calc) => (calc as NPCVsPlayerCalc).getAverageDamageTaken()?.toFixed(DPS_PRECISION)); break;
        case CompareYAxis.PLAYER_MAX_HIT: apply((calc) => (calc as PlayerVsNPCCalc).getMax().toString()); break;
        default: console.error(`Unhandled yAxisType ${this.yAxis} in getOutput`);
      }
      // --- End Existing ---
    }

    return res;
  }

  // --- getAnnotationsX / getAnnotationsY (no changes) ---
  public getAnnotationsX(): ChartAnnotation[] {
    if (this.xAxis === CompareXAxis.MONSTER_DEF_INITIAL) {
      // const annotations: ChartAnnotation[] = []; const initialDef = this.scaledBaseMonster.skills.def;
      // annotations.push({ label: `Base Def (${initialDef})`, value: initialDef }); return annotations;
    }
    if (this.xAxis === CompareXAxis.MONSTER_DEF) {
      const annotations: ChartAnnotation[] = []; let currentDef = this.scaledBaseMonster.skills.def;
      annotations.push({ label: `Base Def (${currentDef})`, value: currentDef }); let dwhCount = 1;
      while (currentDef >= 10 && dwhCount <= 5) {
        const reduction = Math.trunc(currentDef * 3 / 10); if (reduction === 0) break;
        currentDef -= reduction; annotations.push({ label: `DWH x${dwhCount}`, value: currentDef }); dwhCount += 1;
      } return annotations;
    }
    return [];
  }

  public getAnnotationsY(): ChartAnnotation[] {
    if (this.yAxis === CompareYAxis.MONSTER_EXPECTED_DEF_AFTER_SPEC) { return []; } return [];
  }

  // --- getEntries (no changes) ---
  public getEntries(): [ChartEntry[], number] {
    let domainMax: number = 0; const res: ChartEntry[] = [];
    for (const x of this.inputsIterator()) {
      const yOutputs = this.getOutput(x);
      for (const k of keys(yOutputs)) {
        const f = yOutputs[k] ? parseFloat(yOutputs[k]!) : 0;
        if (!Number.isNaN(f) && f > domainMax) { domainMax = f; }
      }
      res.push({ ...yOutputs, name: x.xValue });
    }
    domainMax = Math.max(1, Math.ceil(domainMax * 1.05));
    return [res, domainMax];
  }
}
