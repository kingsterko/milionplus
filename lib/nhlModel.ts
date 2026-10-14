import { scoreGrid, totalGoalsProbabilitiesFromGrid } from "./poisson";
import { NhlTeamStats } from "./nhlStatsClient";

/**
 * NHL predikcia. Znovupouziva ROVNAKU Poissonovu mriezku ako futbal (vratane
 * Dixon-Coles korekcie moznosti), lebo goly su goly - matematika sa neopakuje.
 * Odlisnosti oproti futbalu:
 * - Ziadna remiza vo vysledku - nerozhodne skore po zakladnej hracej dobe sa
 *   v hokeji rozhoduje predlzenim/najazdami. Kedze na to nemame data, tuto
 *   pravdepodobnost rozdelime medzi domacich/hosti pevnym pomerom (mierne
 *   v prospech domacich, bezne v hokejovej analytike).
 * - Vyssia hranica Nad/Pod (6.5 namiesto 2.5).
 * - Domaca vyhoda je PEVNA KONSTANTA (nie empiricky odmerana ako pri
 *   futbale), pretoze NHL standings neposkytuju rozdelenie doma/vonku.
 */

const HOME_ADVANTAGE = 1.06;
const OT_HOME_SHARE = 0.52;
export const NHL_TOTALS_LINE = 6.5;
const NHL_MAX_GOALS = 12;

export interface NhlExpectedGoals {
  home: number;
  away: number;
}

export function nhlExpectedGoals(
  homeStats: NhlTeamStats,
  awayStats: NhlTeamStats,
  leagueAvg: { scoredAvg: number; concededAvg: number }
): NhlExpectedGoals {
  const homeAttack = homeStats.scoredAvg / leagueAvg.scoredAvg;
  const awayDefense = awayStats.concededAvg / leagueAvg.concededAvg;
  const home = homeAttack * awayDefense * leagueAvg.scoredAvg * HOME_ADVANTAGE;

  const awayAttack = awayStats.scoredAvg / leagueAvg.scoredAvg;
  const homeDefense = homeStats.concededAvg / leagueAvg.concededAvg;
  const away = (awayAttack * homeDefense * leagueAvg.scoredAvg) / HOME_ADVANTAGE;

  return { home, away };
}

export interface NhlMatchProbabilities {
  [key: string]: number;
  home: number;
  away: number;
  over: number;
  under: number;
  home_exp_goals: number;
  away_exp_goals: number;
}

/** Postavi mriezku skore raz - pouziva sa spolocne pre moneyline aj regulation-time trh, aby sa nepocitala dvakrat. */
export function buildNhlGrid(homeExp: number, awayExp: number): number[][] {
  return scoreGrid(homeExp, awayExp, 0, NHL_MAX_GOALS);
}

function regulationSplitFromGrid(grid: number[][]): { homeReg: number; awayReg: number; tie: number } {
  let homeReg = 0, awayReg = 0, tie = 0;
  for (let hg = 0; hg < grid.length; hg++) {
    for (let ag = 0; ag < grid[hg].length; ag++) {
      const p = grid[hg][ag];
      if (hg > ag) homeReg += p;
      else if (hg < ag) awayReg += p;
      else tie += p;
    }
  }
  return { homeReg, awayReg, tie };
}

/** Moneyline (2-cestny, vratane predlzenia/najazdov) + Nad/Pod - hlavny, bezny trh u vsetkych bookmakerov. */
export function moneylineFromGrid(grid: number[][], homeExp: number, awayExp: number): NhlMatchProbabilities {
  const { homeReg, awayReg, tie } = regulationSplitFromGrid(grid);

  const home = (homeReg + tie * OT_HOME_SHARE) * 100;
  const away = (awayReg + tie * (1 - OT_HOME_SHARE)) * 100;

  const totals = totalGoalsProbabilitiesFromGrid(grid, NHL_TOTALS_LINE);

  return {
    home,
    away,
    over: totals.over,
    under: totals.under,
    home_exp_goals: Math.round(homeExp * 100) / 100,
    away_exp_goals: Math.round(awayExp * 100) / 100,
  };
}

export interface NhlRegulationProbabilities {
  [key: string]: number;
  home: number;
  draw: number;
  away: number;
}

/**
 * 3-cestny trh "vitaz po riadnej hracej dobe" (h2h_3_way u The Odds API) -
 * pripusta remizu ako samostatny vysledok, preto ma vyssie kurze nez moneyline.
 * Ziadne OT prerozdelenie - priamo surove cisla z mriezky.
 */
export function regulationFromGrid(grid: number[][]): NhlRegulationProbabilities {
  const { homeReg, awayReg, tie } = regulationSplitFromGrid(grid);
  return { home: homeReg * 100, draw: tie * 100, away: awayReg * 100 };
}

export function predictNhlMatch(homeExp: number, awayExp: number): NhlMatchProbabilities {
  const grid = buildNhlGrid(homeExp, awayExp);
  return moneylineFromGrid(grid, homeExp, awayExp);
}
