/**
 * Min-Cost Max-Flow solver via Successive Shortest Path (SSP).
 *
 * The forward-planning loot algorithm models loot distribution per
 * floor as a flow network:
 *   Source → drop nodes & page-buy nodes → (player, slot) need nodes → Sink.
 *
 * Solving this network with min-cost max-flow yields BOTH:
 *   - Which player gets which drop in which week (drop edges with
 *     positive flow), AND
 *   - Which player should buy which slot with their pages and when
 *     (page-buy edges with positive flow).
 *
 * The pre-v3.0 score-then-greedy approach suffered from
 * within-week sequencing bugs (the "Bracelet spillover", v2.5.1)
 * because each item was scored against a moving snapshot. A flow
 * solver decides every assignment in a single pass against a
 * single network, so item ordering inside a week is irrelevant.
 *
 * Algorithm: standard SSP. While an augmenting path of negative
 * reduced cost exists, push flow along it. Bellman-Ford / SPFA
 * tolerates negative edge costs (which our utility-as-cost model
 * uses to encode "fulfilling a need is desirable"). For the
 * 8-player × 4-floor × 8-week scale this is well below 1 ms per
 * floor; no need for exotic algorithms.
 *
 * The solver is graph-shape agnostic: caller is expected to add
 * nodes, add edges, set source/sink, and call `solve()`. See
 * `floor-planner.ts` for the loot-specific wiring.
 */

/**
 * Internal edge representation. SSP needs reverse edges so flow
 * can be cancelled along augmenting paths in either direction;
 * each `addEdge` actually inserts a forward + reverse pair.
 */
interface Edge {
  /** Index of the destination node. */
  to: number;
  /** Remaining capacity on this edge (forward) or reverse-flow capacity. */
  capacity: number;
  /** Cost per unit of flow sent over this edge. */
  cost: number;
  /** Index of the corresponding reverse edge in `nodes[to].edges`. */
  reverseIndex: number;
  /**
   * Outside the algorithm: the original capacity, so callers can
   * compute "flow on this edge" as `original - capacity` after
   * solving without having to track it themselves.
   */
  originalCapacity: number;
  /**
   * Set on the forward edge only; flag the reverse edge so the
   * "flow assigned" reader can distinguish them. Reverse edges
   * have `isReverse = true` and represent flow cancellation, not
   * real assignments.
   */
  isReverse: boolean;
}

interface Node {
  edges: Edge[];
}

export interface MinCostFlowResult {
  /** Total flow value pushed from source to sink. */
  flow: number;
  /** Total cost: sum of (flow_on_edge × edge.cost) over all forward edges. */
  cost: number;
}

/**
 * Successive-Shortest-Path Min-Cost Max-Flow solver.
 *
 * Lifecycle: construct → addEdge() repeatedly → solve(source, sink)
 * → flowOf(edgeId) to read assignments.
 */
export class MinCostFlow {
  private nodes: Node[] = [];
  /**
   * Stable indices into the (forward) edges, in `addEdge` insertion
   * order. Callers receive these on insertion and use them to query
   * `flowOf` post-solve. Reverse edges are not exposed.
   */
  private edgeRefs: Array<{ nodeIndex: number; edgeIndex: number }> = [];

  /**
   * Add a node and return its index. Index is monotonically
   * increasing from 0.
   */
  addNode(): number {
    this.nodes.push({ edges: [] });
    return this.nodes.length - 1;
  }

  /**
   * Add a directed edge `from → to` with given capacity and cost.
   * Also inserts the matching reverse edge with capacity 0 and
   * negated cost — required for SSP to cancel flow.
   *
   * Returns an opaque edge id which can be passed to `flowOf` to
   * read how much flow ended up on this edge.
   */
  addEdge(from: number, to: number, capacity: number, cost: number): number {
    if (from < 0 || from >= this.nodes.length) {
      throw new Error(`addEdge: invalid 'from' node ${from}`);
    }
    if (to < 0 || to >= this.nodes.length) {
      throw new Error(`addEdge: invalid 'to' node ${to}`);
    }

    const fromNode = this.nodes[from];
    const toNode = this.nodes[to];
    if (!fromNode || !toNode) {
      throw new Error(`addEdge: node lookup failed`);
    }

    const forwardIdx = fromNode.edges.length;
    const reverseIdx = toNode.edges.length;

    fromNode.edges.push({
      to,
      capacity,
      cost,
      reverseIndex: reverseIdx,
      originalCapacity: capacity,
      isReverse: false,
    });
    toNode.edges.push({
      to: from,
      capacity: 0,
      cost: -cost,
      reverseIndex: forwardIdx,
      originalCapacity: 0,
      isReverse: true,
    });

    const edgeId = this.edgeRefs.length;
    this.edgeRefs.push({ nodeIndex: from, edgeIndex: forwardIdx });
    return edgeId;
  }

  /**
   * Run min-cost max-flow from `source` to `sink`. Returns the
   * total flow value and total cost.
   *
   * Implementation: repeatedly find a shortest path (by cost) from
   * source to sink in the residual graph; push as much flow as the
   * path's bottleneck capacity allows; repeat until no path exists.
   * Bellman-Ford handles the negative cost edges that arise on
   * reverse edges after flow has been sent.
   *
   * The outer augmenting-path loop is bounded by
   * `MAX_AUGMENTING_ITERATIONS` (a multiple of the node count) as
   * a safety net against pathological floating-point edge costs
   * that can otherwise stall the SPFA in a degenerate residual
   * graph (observed v3.3.0: 8 players × mixed Savage/TomeUp BiS
   * with default role weights would not converge). When the
   * limit is hit the result captures the best-feasible flow
   * found so far rather than hanging the whole request.
   */
  solve(source: number, sink: number): MinCostFlowResult {
    if (source < 0 || source >= this.nodes.length) {
      throw new Error(`solve: invalid source ${source}`);
    }
    if (sink < 0 || sink >= this.nodes.length) {
      throw new Error(`solve: invalid sink ${sink}`);
    }

    let totalFlow = 0;
    let totalCost = 0;

    // SPFA (queue-based Bellman-Ford) is faster than vanilla
    // Bellman-Ford on sparse graphs and tolerates negative edges
    // — exactly what we need on the residual graph.
    const n = this.nodes.length;
    const dist = new Array<number>(n);
    const inQueue = new Array<boolean>(n);
    const parentNode = new Array<number>(n);
    const parentEdge = new Array<number>(n);

    // Hard ceiling on augmenting iterations. Each augment pushes
    // ≥ 1 unit of flow, so the natural bound is `total source
    // capacity`; we use a generous multiple of n to allow for
    // unit-cap edges (1 augment per drop). The constant 64 was
    // chosen empirically: a fully-loaded floor (8 players × 8
    // weeks × 4 items) sees ~250 augments, well under 64×n.
    const maxIterations = Math.max(1024, n * 64);
    let iteration = 0;
    // SPFA pop budget per shortest-path probe. Theoretical SPFA
    // bound is O(V*E); we cap at 16*V*V which is a generous
    // constant-factor overshoot for sparse layered graphs but
    // keeps a single solve in the millisecond range even under
    // pathological floating-point residuals.
    const spfaPopLimit = Math.max(4096, 16 * n * n);
    let spfaPops = 0;

    while (true) {
      iteration += 1;
      if (iteration > maxIterations) break;
      // SPFA from source.
      dist.fill(Infinity);
      inQueue.fill(false);
      parentNode.fill(-1);
      parentEdge.fill(-1);
      dist[source] = 0;
      const queue: number[] = [source];
      inQueue[source] = true;

      while (queue.length > 0) {
        spfaPops += 1;
        if (spfaPops > spfaPopLimit) {
          // SPFA stalled (likely a degenerate residual graph
          // produced by float-precision edge costs). Break out;
          // the outer iteration limit will then terminate the
          // solver with the best-so-far result.
          queue.length = 0;
          break;
        }
        const u = queue.shift();
        if (u === undefined) break;
        inQueue[u] = false;
        const node = this.nodes[u];
        if (!node) continue;
        for (let ei = 0; ei < node.edges.length; ei += 1) {
          const e = node.edges[ei];
          if (!e || e.capacity <= 0) continue;
          const du = dist[u];
          const dv = dist[e.to];
          if (du === undefined || dv === undefined) continue;
          const newDist = du + e.cost;
          if (newDist < dv) {
            dist[e.to] = newDist;
            parentNode[e.to] = u;
            parentEdge[e.to] = ei;
            if (!inQueue[e.to]) {
              queue.push(e.to);
              inQueue[e.to] = true;
            }
          }
        }
      }

      const sinkDist = dist[sink];
      if (sinkDist === undefined || sinkDist === Infinity) {
        // No augmenting path remains.
        break;
      }

      // Find the bottleneck along the path source → sink.
      // Both this loop and the push-flow loop below are bounded
      // by `pathStepLimit` (n + 1 = max valid path length). A
      // longer chain means SPFA produced a parent cycle — bail
      // safely instead of looping.
      let bottleneck = Infinity;
      let pathOk = true;
      let pathSteps = 0;
      const pathStepLimit = n + 1;
      for (let v = sink; v !== source; ) {
        pathSteps += 1;
        if (pathSteps > pathStepLimit) {
          pathOk = false;
          break;
        }
        const pu = parentNode[v];
        const pe = parentEdge[v];
        if (pu === undefined || pu < 0 || pe === undefined || pe < 0) {
          // SPFA reported a finite distance to sink but the
          // parent chain isn't fully populated — defensive bail-
          // out so we never push `Infinity` flow.
          pathOk = false;
          break;
        }
        const node = this.nodes[pu];
        if (!node) {
          pathOk = false;
          break;
        }
        const edge = node.edges[pe];
        if (!edge) {
          pathOk = false;
          break;
        }
        if (edge.capacity < bottleneck) bottleneck = edge.capacity;
        v = pu;
      }
      if (!pathOk || !Number.isFinite(bottleneck) || bottleneck <= 0) {
        // Path reconstruction failed or yielded a zero/infinite
        // bottleneck — nothing safe to augment, treat as the end
        // of the algorithm.
        break;
      }

      // Push flow.
      let pushSteps = 0;
      for (let v = sink; v !== source; ) {
        pushSteps += 1;
        if (pushSteps > pathStepLimit) break;
        const pu = parentNode[v];
        const pe = parentEdge[v];
        if (pu === undefined || pu < 0 || pe === undefined || pe < 0) break;
        const node = this.nodes[pu];
        if (!node) break;
        const edge = node.edges[pe];
        if (!edge) break;
        edge.capacity -= bottleneck;
        const targetNode = this.nodes[edge.to];
        if (targetNode) {
          const reverseEdge = targetNode.edges[edge.reverseIndex];
          if (reverseEdge) reverseEdge.capacity += bottleneck;
        }
        v = pu;
      }

      totalFlow += bottleneck;
      totalCost += bottleneck * sinkDist;
    }

    return { flow: totalFlow, cost: totalCost };
  }

  /**
   * Read the amount of flow assigned to a forward edge by its
   * `addEdge` insertion id. Reverse edges are private to the
   * solver and not addressable here.
   */
  flowOf(edgeId: number): number {
    const ref = this.edgeRefs[edgeId];
    if (!ref) throw new Error(`flowOf: invalid edge id ${edgeId}`);
    const node = this.nodes[ref.nodeIndex];
    if (!node) throw new Error(`flowOf: node ${ref.nodeIndex} not found`);
    const edge = node.edges[ref.edgeIndex];
    if (!edge) throw new Error(`flowOf: edge ${ref.edgeIndex} not found`);
    return edge.originalCapacity - edge.capacity;
  }
}
