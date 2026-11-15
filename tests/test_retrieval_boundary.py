import pytest
from helpers import fresh_graph, run

from selfgraph.retrieval import HUB_DEGREE


@pytest.mark.parametrize("strategy", ["bfs", "dfs", "ppr"])
@pytest.mark.parametrize("depth", [0, 1])
def test_retrieve_collects_relations_between_boundary_entities(strategy, depth):
    g = fresh_graph("boundary")
    run(
        g.insert.facts(
            {
                "entities": [{"type": "Thing", "name": n} for n in ["Ada", "Bob", "Cy"]],
                "relations": [
                    {"id": "relation:ab", "from_entity": "thing:ada", "type": "LINKS", "to_entity": "thing:bob"},
                    {"id": "relation:ac", "from_entity": "thing:ada", "type": "LINKS", "to_entity": "thing:cy"},
                    {"id": "relation:bc", "from_entity": "thing:bob", "type": "KNOWS", "to_entity": "thing:cy"},
                ],
                "decisions": [{"title": "Choose Cy", "steps": ["relation:bc"]}],
            }
        )
    )
    result = run(g.retrieve("Ada" if depth else "Ada Bob Cy", k=1 if depth else 3, depth=depth, strategy=strategy))
    assert {e.id for e in result.subgraph.entities} == {"thing:ada", "thing:bob", "thing:cy"}
    assert {r.id for r in result.subgraph.relations} == {"relation:ab", "relation:ac", "relation:bc"}
    assert [d.title for d in result.subgraph.decisions] == ["Choose Cy"]


@pytest.mark.parametrize("strategy", ["bfs", "dfs", "ppr"])
def test_retrieve_marks_boundary_hubs_without_expanding_them(strategy):
    g = fresh_graph("boundary-hub")
    names = ["Ada", *(f"Leaf{i}" for i in range(HUB_DEGREE - 1))]
    run(
        g.insert.facts(
            {
                "entities": [{"type": "Thing", "name": n} for n in ["Hub", *names]],
                "relations": [
                    {"from_entity": "thing:hub", "type": "HAS", "to_entity": f"thing:{n.lower()}"} for n in names
                ],
            }
        )
    )
    result = run(g.retrieve("Ada", k=1, depth=1, skip_hubs=True, strategy=strategy))
    assert {e.id for e in result.subgraph.entities} == {"thing:ada", "thing:hub"}
    assert result.hubs == ["thing:hub"]
    assert "Hub -[HAS]-> Ada (via hub)" in result.context.splitlines()


@pytest.mark.parametrize("strategy", ["bfs", "dfs", "ppr"])
def test_boundary_completion_obeys_relation_time_filters(strategy):
    g = fresh_graph("boundary-time")
    run(
        g.insert.facts(
            {
                "entities": [{"type": "Thing", "name": n} for n in ["Ada", "Bob", "Cy"]],
                "relations": [
                    {
                        "id": f"relation:{b}",
                        "from_entity": "thing:ada",
                        "type": "LINKS",
                        "to_entity": f"thing:{b}",
                        "event_time": "2020-01-01",
                    }
                    for b in ["bob", "cy"]
                ]
                + [
                    {
                        "id": "relation:bc",
                        "from_entity": "thing:bob",
                        "type": "KNOWS",
                        "to_entity": "thing:cy",
                        "event_time": "2030-01-01",
                    }
                ],
            }
        )
    )
    for when, expected in [
        ("2025-01-01", {"relation:bob", "relation:cy"}),
        ("2035-01-01", {"relation:bob", "relation:cy", "relation:bc"}),
    ]:
        result = run(g.retrieve("Ada", k=1, depth=1, strategy=strategy, as_of=when))
        assert {r.id for r in result.subgraph.relations} == expected
    result = run(g.retrieve("Ada", k=1, depth=1, strategy=strategy, as_of="2035-01-01", known_at="2000-01-01"))
    assert result.subgraph.entities == []
    assert result.subgraph.relations == []
