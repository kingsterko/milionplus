/**
 * Jednoduchy Poissonov model ocakavanych golov. Port z povodneho Python
 * poisson_model.py - rovnaka matematika, overena v Pythone aj v tomto
 * TypeScript porte (viz testovacia sekcia v README / dev poznamkach).
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

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function poissonPmf(k: number, lam: number): number {
  return (Math.pow(lam, k) * Math.exp(-lam)) / factorial(k);
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

export function matchProbabilities(homeExp: number, awayExp: number, maxGoals = 8) {
  let h = 0, d = 0, a = 0;
  for (let hg = 0; hg <= maxGoals; hg++) {
    for (let ag = 0; ag <= maxGoals; ag++) {
      const p = poissonPmf(hg, homeExp) * poissonPmf(ag, awayExp);
      if (hg > ag) h += p;
      else if (hg === ag) d += p;
      else a += p;
    }
  }
  const total = h + d + a;
  return { h: (h / total) * 100, d: (d / total) * 100, a: (a / total) * 100 };
}

export function totalGoalsProbabilities(homeExp: number, awayExp: number, line = 2.5, maxGoals = 8) {
  let over = 0, under = 0;
  for (let hg = 0; hg <= maxGoals; hg++) {
    for (let ag = 0; ag <= maxGoals; ag++) {
      const p = poissonPmf(hg, homeExp) * poissonPmf(ag, awayExp);
      if (hg + ag > line) over += p;
      else under += p;
    }
  }
  const total = over + under;
  return { over: (over / total) * 100, under: (under / total) * 100 };
}

export function predictMatch(homeStats: TeamVenueStats, awayStats: TeamVenueStats): MatchProbabilities {
  const [homeExp, awayExp] = expectedGoals(
    homeStats.scored_home,
    homeStats.conceded_home,
    awayStats.scored_away,
    awayStats.conceded_away
  );
  const probs = matchProbabilities(homeExp, awayExp);
  const totals = totalGoalsProbabilities(homeExp, awayExp);
  return {
    ...probs,
    ...totals,
    home_exp_goals: Math.round(homeExp * 100) / 100,
    away_exp_goals: Math.round(awayExp * 100) / 100,
  };
}
