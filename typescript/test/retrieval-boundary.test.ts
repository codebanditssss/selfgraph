import { expect, it } from "vitest";

import { HUB_DEGREE } from "../src/retrieval.js";
import { forEachStore, freshGraphs, type StoreSpec } from "./helpers.js";

function suite(spec: StoreSpec): void {
  const open = freshGraphs(spec, "boundary");
  for (const strategy of ["bfs", "dfs", "ppr"] as const) {
    for (const depth of [0, 1]) {
      it(`collects boundary relations and their decisions: ${strategy}, depth ${depth}`, async () => {
        const g = open();
        await g.insert.facts({
          entities: ["Ada", "Bob", "Cy"].map((name) => ({ type: "Thing", name })),
          relations: [
            { id: "relation:ab", from_entity: "thing:ada", type: "LINKS", to_entity: "thing:bob" },
            { id: "relation:ac", from_entity: "thing:ada", type: "LINKS", to_entity: "thing:cy" },
            { id: "relation:bc", from_entity: "thing:bob", type: "KNOWS", to_entity: "thing:cy" },
          ],
          decisions: [{ title: "Choose Cy", steps: ["relation:bc"] }],
        });
        const result = await g.retrieve(depth ? "Ada" : "Ada Bob Cy", { k: depth ? 1 : 3, depth, strategy });
        expect(result.subgraph.entities.map((e) => e.id).sort()).toEqual(["thing:ada", "thing:bob", "thing:cy"]);
        expect(result.subgraph.relations.map((r) => r.id).sort()).toEqual([
          "relation:ab",
          "relation:ac",
          "relation:bc",
        ]);
        expect(result.subgraph.decisions.map((d) => d.title)).toEqual(["Choose Cy"]);
      });
    }
    it(`marks boundary hubs without expanding them: ${strategy}`, async () => {
      const g = open();
      const names = ["Ada", ...Array.from({ length: HUB_DEGREE - 1 }, (_, i) => `Leaf${i}`)];
      await g.insert.facts({
        entities: ["Hub", ...names].map((name) => ({ type: "Thing", name })),
        relations: names.map((n) => ({ from_entity: "thing:hub", type: "HAS", to_entity: `thing:${n.toLowerCase()}` })),
      });
      const result = await g.retrieve("Ada", { k: 1, depth: 1, skip_hubs: true, strategy });
      expect(result.subgraph.entities.map((e) => e.id).sort()).toEqual(["thing:ada", "thing:hub"]);
      expect(result.hubs).toEqual(["thing:hub"]);
      expect(result.context.split("\n")).toContain("Hub -[HAS]-> Ada (via hub)");
    });
    it(`obeys time filters when completing boundary relations: ${strategy}`, async () => {
      const g = open();
      await g.insert.facts({
        entities: ["Ada", "Bob", "Cy"].map((name) => ({ type: "Thing", name })),
        relations: [
          ...["bob", "cy"].map((b) => ({
            id: `relation:${b}`,
            from_entity: "thing:ada",
            type: "LINKS",
            to_entity: `thing:${b}`,
            event_time: "2020-01-01",
          })),
          {
            id: "relation:bc",
            from_entity: "thing:bob",
            type: "KNOWS",
            to_entity: "thing:cy",
            event_time: "2030-01-01",
          },
        ],
      });
      for (const [as_of, expected] of [
        ["2025-01-01", ["relation:bob", "relation:cy"]],
        ["2035-01-01", ["relation:bc", "relation:bob", "relation:cy"]],
      ] as const) {
        const result = await g.retrieve("Ada", { k: 1, depth: 1, strategy, as_of });
        expect(result.subgraph.relations.map((r) => r.id).sort()).toEqual(expected);
      }
      const unknown = await g.retrieve("Ada", {
        k: 1,
        depth: 1,
        strategy,
        as_of: "2035-01-01",
        known_at: "2000-01-01",
      });
      expect(unknown.subgraph.entities).toEqual([]);
      expect(unknown.subgraph.relations).toEqual([]);
    });
  }
}

await forEachStore("boundary retrieval", suite);
