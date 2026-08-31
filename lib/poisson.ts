/**
 * Poissonov model ocakavanych golov s Dixon-Colesovou korekciou pre nizke skore.
 *
 * Nezavisly Poissonov model (kazdy tim strieli goly nezavisle od druheho)
 * systematicky PODCENUJE pravdepodobnost nizkych remiz (0:0, 1:1) - v realite
 * timy pri vyrovnanom stave hraju opatrnejsie, co tento efekt sposobuje.
 * Dixon-Coles (1997) to opravuju korekcnym faktorom tau pre skore 0:0, 1:0,
 * 0:1, 1:1 - vsetky ostatne skore ostavaju nezmenene.
 *
 * Hodnota rho (-0.1) je standardna literaturou odporucana konstanta
 * (Dixon & Coles, 1997, dodatocne pouzivana vo vacsine praktickych
 * implementacii), nie je fitovana na nasich datach - presnejsie by bolo
 * odhadnut rho z historickych vysledkov konkretnej ligy, co je mozne
 * doplnit neskor.
 */

export interface TeamVenueStats {
  scored_home: number;
  conceded_home: number;
  scored_away: number;
  conceded_away: number;
  sample_home?: number;
  sample_away?: number;
}

export interface MatchProbabilities {
  [key: string]: number;
  h: number;
  d: number;
  a: number;
  over: number;
  under: number;
  home_exp_goals: number;
  away_exp_goals: number;
}

const LEAGUE_AVG_GOALS = 1.4;
const DIXON_COLES_RHO = -0.1;
const MAX_GOALS = 8;

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function poissonPmf(k: number, lam: number): number {
  return (Math.pow(lam, k) * Math.exp(-lam)) / factorial(k);
}

function dixonColesTau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function expectedGoals(
  homeScoredAvg: number,
  homeConcededAvg: number,
  awayScoredAvg: number,
  awayConcededAvg: number,
  leagueAvg: number = LEAGUE_AVG_GOALS
): [number, number] {
  const homeAttack = homeScoredAvg / leagueAvg;
  const awayDefense = awayConcededAvg / leagueAvg;
  const homeExp = homeAttack * awayDefense * leagueAvg;

  const awayAttack = awayScoredAvg / leagueAvg;
  const homeDefense = homeConcededAvg / leagueAvg;
  const awayExp = awayAttack * homeDefense * leagueAvg;

  return [homeExp, awayExp];
}

/**
 * Spocita celu 2D mriezku pravdepodobnosti skore (0:0 az maxGoals:maxGoals)
 * s aplikovanou Dixon-Colesovou korekciou. Pouziva sa spolocne pre 1X2 aj
 * Nad/Pod, aby oba trhy vychadzali z tej istej, konzistentnej mriezky.
 */
export function scoreGrid(homeExp: number, awayExp: number, rho: number = DIXON_COLES_RHO, maxGoals: number = MAX_GOALS): number[][] {
  const grid: number[][] = [];
  let total = 0;

  for (let hg = 0; hg <= maxGoals; hg++) {
    grid[hg] = [];
    for (let ag = 0; ag <= maxGoals; ag++) {
      const base = poissonPmf(hg, homeExp) * poissonPmf(ag, awayExp);
      const tau = dixonColesTau(hg, ag, homeExp, awayExp, rho);
      const p = Math.max(base * tau, 0); // tau moze byt teoreticky zaporne pri extremnych vstupoch, poistka
      grid[hg][ag] = p;
      total += p;
    }
  }

  // Korekcia mierne zmeni celkovu hmotnost mriezky - prenormalizuje sa spat na sucet 1.
  for (let hg = 0; hg <= maxGoals; hg++) {
    for (let ag = 0; ag <= maxGoals; ag++) {
      grid[hg][ag] /= total;
    }
  }

  return grid;
}

export function matchProbabilitiesFromGrid(grid: number[][]) {
  let h = 0, d = 0, a = 0;
  for (let hg = 0; hg < grid.length; hg++) {
    for (let ag = 0; ag < grid[hg].length; ag++) {
      const p = grid[hg][ag];
      if (hg > ag) h += p;
      else if (hg === ag) d += p;
      else a += p;
    }
  }
  return { h: h * 100, d: d * 100, a: a * 100 };
}

export function totalGoalsProbabilitiesFromGrid(grid: number[][], line = 2.5) {
  let over = 0, under = 0;
  for (let hg = 0; hg < grid.length; hg++) {
    for (let ag = 0; ag < grid[hg].length; ag++) {
      const p = grid[hg][ag];
      if (hg + ag > line) over += p;
      else under += p;
    }
  }
  return { over: over * 100, under: under * 100 };
}

// Zachovane kvoli spatnej kompatibilite (napr. buduce priame pouzitie bez grid) -
// interne uz len postavia grid a delegujuce vypocty z neho.
export function matchProbabilities(homeExp: number, awayExp: number, maxGoals = MAX_GOALS) {
  return matchProbabilitiesFromGrid(scoreGrid(homeExp, awayExp, DIXON_COLES_RHO, maxGoals));
}

export function totalGoalsProbabilities(homeExp: number, awayExp: number, line = 2.5, maxGoals = MAX_GOALS) {
  return totalGoalsProbabilitiesFromGrid(scoreGrid(homeExp, awayExp, DIXON_COLES_RHO, maxGoals), line);
}

export function predictMatch(homeStats: TeamVenueStats, awayStats: TeamVenueStats): MatchProbabilities {
  const [homeExp, awayExp] = expectedGoals(
    homeStats.scored_home,
    homeStats.conceded_home,
    awayStats.scored_away,
    awayStats.conceded_away
  );
  const grid = scoreGrid(homeExp, awayExp);
  const probs = matchProbabilitiesFromGrid(grid);
  const totals = totalGoalsProbabilitiesFromGrid(grid);
  return {
    ...probs,
    ...totals,
    home_exp_goals: Math.round(homeExp * 100) / 100,
    away_exp_goals: Math.round(awayExp * 100) / 100,
  };
}

/**
 * In-play predikcia: zoberie predzapasove ocakavane goly (na cely zapas),
 * prepocita ich na ZVYSNY cas (predpoklad rovnomerneho tempa strielania
 * golov pocas zapasu - bezny zjednodusujuci predpoklad in-play modelov),
 * a skombinuje s uz odohranym skore. Vysledok su pravdepodobnosti FINALNEHO
 * vysledku zapasu (nie len zvysku).
 *
 * elapsedMinutes je odhad (cas od zaciatku zapasu), nie presny zivy cas -
 * The Odds API neposkytuje presnu minutu/polcas, len skore.
 */
export function inPlayProbabilities(
  preMatchHomeExp: number,
  preMatchAwayExp: number,
  elapsedMinutes: number,
  currentHomeScore: number,
  currentAwayScore: number,
  totalMinutes = 90
): MatchProbabilities {
  const remainingFraction = Math.max((totalMinutes - elapsedMinutes) / totalMinutes, 0.02);
  const remHomeExp = preMatchHomeExp * remainingFraction;
  const remAwayExp = preMatchAwayExp * remainingFraction;

  const grid = scoreGrid(remHomeExp, remAwayExp);

  let h = 0, d = 0, a = 0;
  for (let hg = 0; hg < grid.length; hg++) {
    for (let ag = 0; ag < grid[hg].length; ag++) {
      const p = grid[hg][ag];
      const finalHome = currentHomeScore + hg;
      const finalAway = currentAwayScore + ag;
      if (finalHome > finalAway) h += p;
      else if (finalHome === finalAway) d += p;
      else a += p;
    }
  }

  // Nad/Pod 2.5 pre CELY zapas - uz strelene goly sa odratavaju od hranice.
  const remainingLine = 2.5 - (currentHomeScore + currentAwayScore);
  let over = 0, under = 0;
  for (let hg = 0; hg < grid.length; hg++) {
    for (let ag = 0; ag < grid[hg].length; ag++) {
      const p = grid[hg][ag];
      if (hg + ag > remainingLine) over += p;
      else under += p;
    }
  }

  return {
    h: h * 100,
    d: d * 100,
    a: a * 100,
    over: over * 100,
    under: under * 100,
    home_exp_goals: Math.round(remHomeExp * 100) / 100,
    away_exp_goals: Math.round(remAwayExp * 100) / 100,
  };
}
