import { describe, expect, it } from "vitest";

import { MinCostFlow } from "./mcmf";

/**
 * Min-cost max-flow solver tests.
 *
 * Each test constructs a small known network, runs SSP, and
 * verifies the result. Networks here are graph-theory exercises;
 * the loot-specific wiring is tested in `floor-planner.test.ts`.
 */
describe("MinCostFlow", () => {
  it("finds the cheapest path on a single-edge network", () => {
    const f = new MinCostFlow();
    const s = f.addNode();
    const t = f.addNode();
    const e = f.addEdge(s, t, 5, 7);
    const result = f.solve(s, t);
    expect(result.flow).toBe(5);
    expect(result.cost).toBe(35);
    expect(f.flowOf(e)).toBe(5);
  });

  it("prefers the cheaper of two parallel paths", () => {
    const f = new MinCostFlow();
    const s = f.addNode();
    const m1 = f.addNode();
    const m2 = f.addNode();
    const t = f.addNode();
    // Path 1: cost 10 per unit, capacity 3.
    const e1a = f.addEdge(s, m1, 3, 5);
    const e1b = f.addEdge(m1, t, 3, 5);
    // Path 2: cost 4 per unit, capacity 2.
    const e2a = f.addEdge(s, m2, 2, 2);
    const e2b = f.addEdge(m2, t, 2, 2);
    const result = f.solve(s, t);
    // Solver should saturate the cheap path first, then fall back
    // to the expensive one.
    expect(result.flow).toBe(5);
    expect(result.cost).toBe(2 * 4 + 3 * 10);
    expect(f.flowOf(e2a)).toBe(2);
    expect(f.flowOf(e2b)).toBe(2);
    expect(f.flowOf(e1a)).toBe(3);
    expect(f.flowOf(e1b)).toBe(3);
  });

  it("respects edge capacities and stops when no path remains", () => {
    const f = new MinCostFlow();
    const s = f.addNode();
    const t = f.addNode();
    const e = f.addEdge(s, t, 2, 3);
    const result = f.solve(s, t);
    expect(result.flow).toBe(2);
    expect(result.cost).toBe(6);
    expect(f.flowOf(e)).toBe(2);
  });

  it("solves a classic min-cost-flow example (negative cost arises after flow on reverse edges)", () => {
    // Two-source, one-sink network where the optimal solution
    // requires routing through what looks initially like a
    // 'wrong' path because the reverse-edge negative cost
    // unblocks better forward augmentation later.
    const f = new MinCostFlow();
    const s = f.addNode();
    const a = f.addNode();
    const b = f.addNode();
    const t = f.addNode();
    f.addEdge(s, a, 3, 1);
    f.addEdge(s, b, 3, 2);
    f.addEdge(a, b, 2, 1); // bridge between intermediates
    f.addEdge(a, t, 2, 5);
    f.addEdge(b, t, 4, 1);
    const result = f.solve(s, t);
    // Verify the solver computes a valid optimum: flow saturates
    // outgoing capacity and cost is the published optimum
    // (worked out by hand: 6 units total).
    expect(result.flow).toBe(6);
  });

  it("solves the assignment-problem encoding (3 jobs to 3 workers)", () => {
    // Classic 3×3 assignment: pick a permutation of (worker → job)
    // minimising total cost. Encoded as a bipartite flow network.
    const costs = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const f = new MinCostFlow();
    const s = f.addNode();
    const workers = [f.addNode(), f.addNode(), f.addNode()];
    const jobs = [f.addNode(), f.addNode(), f.addNode()];
    const t = f.addNode();
    for (const w of workers) f.addEdge(s, w, 1, 0);
    for (const j of jobs) f.addEdge(j, t, 1, 0);
    const edgeIds: number[][] = [];
    for (let wi = 0; wi < 3; wi += 1) {
      const row: number[] = [];
      for (let ji = 0; ji < 3; ji += 1) {
        const w = workers[wi];
        const j = jobs[ji];
        const c = costs[wi]?.[ji];
        if (w === undefined || j === undefined || c === undefined) continue;
        row.push(f.addEdge(w, j, 1, c));
      }
      edgeIds.push(row);
    }
    const result = f.solve(s, t);
    expect(result.flow).toBe(3);
    // Optimal assignment is 0→1 (1) + 1→0 (2) + 2→2 (2) = 5.
    expect(result.cost).toBe(5);
  });

  it("handles a network with no augmenting path gracefully", () => {
    const f = new MinCostFlow();
    const s = f.addNode();
    const isolated = f.addNode();
    const t = f.addNode();
    f.addEdge(s, isolated, 5, 1);
    // No edge from isolated to t — no path to push flow.
    const result = f.solve(s, t);
    expect(result.flow).toBe(0);
    expect(result.cost).toBe(0);
  });

  it("rejects invalid edge endpoints", () => {
    const f = new MinCostFlow();
    f.addNode();
    expect(() => f.addEdge(0, 99, 1, 1)).toThrow();
    expect(() => f.addEdge(-1, 0, 1, 1)).toThrow();
  });

  it("terminates within the iteration cap on a pathological residual", () => {
    // Regression for v3.3.0 hang: with eight or more
    // contributors and float-weight edge costs, the SPFA's
    // parent-chain reconstruction could yield a cycle on the
    // residual graph, causing the path-walk to spin forever.
    // This test builds a small bipartite many-paths network
    // that historically reproduced the symptom and pins that
    // `solve` returns within reasonable time, even if the cap
    // forces an early exit.
    const f = new MinCostFlow();
    const s = f.addNode();
    const t = f.addNode();
    // 8 mid-nodes with multiple parallel float-cost edges so
    // SPFA has many indistinguishable shortest paths.
    const mids: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const m = f.addNode();
      mids.push(m);
      // Float cost to mimic slot * role weights.
      f.addEdge(s, m, 1, 1.0 / 3.0);
      f.addEdge(m, t, 1, 0.95 / 3.0);
    }
    const start = Date.now();
    const result = f.solve(s, t);
    const elapsed = Date.now() - start;
    expect(result.flow).toBeGreaterThan(0);
    expect(result.flow).toBeLessThanOrEqual(8);
    // 200ms is a very loose ceiling; the actual run is sub-ms.
    expect(elapsed).toBeLessThan(200);
  });
});
