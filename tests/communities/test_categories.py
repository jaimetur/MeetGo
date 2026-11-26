"""Categories of communities: the built-in ones, choosing one or proposing a new one when creating a community, and the
administration (create, rename, delete, approve proposals, move communities in bulk)."""

from tests.helpers import admin_headers, make_user


async def _create(client, headers, title, **kw):
    res = await client.post("/communities", json={"title": title, "access_mode": "open", "board_mode": "open", **kw}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def test_built_in_categories_choose_and_propose(client, db_session):
    cats = (await client.get("/categories", headers={"X-Lang": "es"})).json()
    keys = [c["key"] for c in cats]
    assert keys[0] == "ui_cat_social" and keys[-1] == "ui_cat_other" and len(keys) == 8
    assert next(c for c in cats if c["key"] == "ui_cat_sports")["name"] == "Deportes"
    assert next(c for c in (await client.get("/categories", headers={"X-Lang": "en"})).json() if c["key"] == "ui_cat_sports")["name"] == "Sports"

    ana, _ = await make_user(client, db_session, "ana@example.com", "Ana")
    running = await _create(client, ana, "Runners de Madrid", category="ui_cat_sports")
    assert running["category"] == "ui_cat_sports"
    assert (await client.post("/communities", json={"title": "X", "category": "nope"}, headers=ana)).status_code == 400
    # none fits: proposed to the administration, in "Other" meanwhile
    stars = await _create(client, ana, "Astrónomos aficionados", category_proposal="Astronomía")
    assert stars["category"] == "ui_cat_other"

    admin = await admin_headers(client)
    assert (await client.get("/admin/categories", headers=ana)).status_code == 403
    data = (await client.get("/admin/categories", headers=admin)).json()
    [proposal] = data["proposals"]
    assert proposal["name"] == "Astronomía" and proposal["community"]["id"] == stars["id"]
    res = await client.post(f"/admin/categories/proposals/{proposal['id']}/approve",
                            json={"names": {"es": "Astronomía", "en": "Astronomy"}}, headers=admin)
    key = res.json()["key"]
    assert key == "cat_astronomia"
    assert (await client.get(f"/communities/{stars['id']}", headers=ana)).json()["category"] == key
    assert not (await client.get("/admin/categories", headers=admin)).json()["proposals"]
    assert next(c for c in (await client.get("/categories", headers={"X-Lang": "en"})).json() if c["key"] == key)["name"] == "Astronomy"


async def test_admin_edits_and_moves_in_bulk(client, db_session):
    ana, _ = await make_user(client, db_session, "ana@example.com", "Ana")
    a = await _create(client, ana, "Club uno", category="ui_cat_social")
    b = await _create(client, ana, "Club dos", category="ui_cat_social")
    admin = await admin_headers(client)
    made = (await client.post("/admin/categories", json={"names": {"es": "Juegos de mesa", "en": "Board games"}}, headers=admin)).json()
    assert made["key"] == "cat_juegos_de_mesa"
    assert (await client.post("/admin/categories", json={"names": {"en": "No Spanish"}}, headers=admin)).status_code == 400
    renamed = (await client.patch(f"/admin/categories/{made['key']}", json={"names": {"es": "Juegos", "en": "Games"}}, headers=admin)).json()
    assert renamed["names"]["es"] == "Juegos"
    data = (await client.get("/admin/categories", headers=admin)).json()
    interest = next(i for i in data["interests"] if i["slug"] == "cine")
    moved = (await client.post("/admin/categories/assign", json={"key": made["key"], "community_ids": [a["id"], b["id"]],
                                                                 "interest_ids": [interest["id"]]}, headers=admin)).json()
    assert moved["changed"] == 3
    assert (await client.get(f"/communities/{a['id']}", headers=ana)).json()["category"] == made["key"]
    assert next(c for c in (await client.get("/admin/categories", headers=admin)).json()["categories"] if c["key"] == made["key"])["count"] == 3
    # deleting it sends its communities to "Other"; the built-in ones cannot go
    assert (await client.delete("/admin/categories/ui_cat_sports", headers=admin)).status_code == 400
    assert (await client.delete(f"/admin/categories/{made['key']}", headers=admin)).json()["ok"] is True
    assert (await client.get(f"/communities/{b['id']}", headers=ana)).json()["category"] == "ui_cat_other"


async def test_proposals_notify_admins_and_approval_translates(client, db_session, monkeypatch):
    """A proposal waits as a notice for the administrators until one of them reviews it; approving it with only the
    Spanish name fills the other languages (translated with Claude, here a stand-in)."""
    from app.categories import service as cats

    async def fake_complete(names):
        return {**{c: f"{names['es']} ({c})" for c in ("en", "ca", "de", "fr", "it", "pt", "nl", "ja", "zh")}, **names}
    monkeypatch.setattr(cats, "complete_names", fake_complete)
    events = []

    async def fake_publish(to, event):
        if event.get("type") == "admin.pending":
            events.append((sorted(to), event))
    import app.realtime.service as rt
    monkeypatch.setattr(rt, "publish", fake_publish)

    admin = await admin_headers(client)
    ana, _ = await make_user(client, db_session, "ana@example.com", "Ana")
    assert (await client.get("/admin/categories/pending", headers=ana)).status_code == 403
    assert (await client.get("/admin/categories/pending", headers=admin)).json() == {"categories": 0}
    await _create(client, ana, "Tertulias", category_proposal="Opinión")
    assert (await client.get("/admin/categories/pending", headers=admin)).json() == {"categories": 1}
    assert len(events) == 1  # the administrators connected see it now

    [proposal] = (await client.get("/admin/categories", headers=admin)).json()["proposals"]
    res = await client.post(f"/admin/categories/proposals/{proposal['id']}/approve", json={"names": {"es": "Opinión"}}, headers=admin)
    key = res.json()["key"]
    assert (await client.get("/admin/categories/pending", headers=admin)).json() == {"categories": 0}  # gone for all
    assert len(events) == 2
    assert next(c for c in (await client.get("/categories", headers={"X-Lang": "de"})).json() if c["key"] == key)["name"] == "Opinión (de)"
