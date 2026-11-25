"""The creator changes who a community admits (scope and ages): whoever stops fitting is expelled with a notice and
keeps the chat read only up to then; widening it lets other provinces in."""

from tests.communities.test_communities import _create
from tests.helpers import make_user


async def test_creator_changes_scope_and_ages_expelling_who_no_longer_fits(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana", dob="1990-05-01")        # 36
    bea = await make_user(client, db_session, "bea@example.com", "Bea", dob="1975-05-01")        # 51
    toni = await make_user(client, db_session, "toni@example.com", "Toni", province="Toledo")    # Castilla-La Mancha
    com = await _create(client, ana[0])
    cid, conv_id = com["id"], com["conversation_id"]
    assert (await client.post(f"/communities/{cid}/join", headers=bea[0])).json() == {"status": "joined"}
    await client.post(f"/conversations/{conv_id}/messages", json={"body": "antes"}, headers=ana[0])

    filters = (await client.get(f"/communities/{cid}/filters", headers=ana[0])).json()
    assert filters["scope_kind"] == "province" and {o["kind"] for o in filters["options"]} == {"province", "region", "country"}
    assert (await client.get(f"/communities/{cid}/filters", headers=bea[0])).status_code == 403  # only the creator

    # 30 to 45: Bea (51) would leave; the dry run says so without changing anything
    body = {"scope_kind": "province", "age_limit": True, "min_age": 30, "max_age": 45}
    dry = (await client.post(f"/communities/{cid}/filters", json={**body, "dry_run": True}, headers=ana[0])).json()
    assert dry == {"expelled": 1, "names": ["Bea"]}
    assert (await client.get(f"/communities/{cid}", headers=bea[0])).json()["joined"] is True
    # the creator cannot leave themself out
    assert (await client.post(f"/communities/{cid}/filters", json={**body, "min_age": 40}, headers=ana[0])).status_code == 400

    res = await client.post(f"/communities/{cid}/filters", json=body, headers=ana[0])
    assert res.status_code == 200 and res.json()["expelled"] == 1
    await client.post(f"/conversations/{conv_id}/messages", json={"body": "después"}, headers=ana[0])
    # Bea keeps the chat read only: what was written before, nothing after; she cannot write
    conv = (await client.get(f"/conversations/{conv_id}", headers=bea[0])).json()
    assert conv["read_only"] is True and conv["unread_count"] == 0
    bodies = [m["body"] for m in (await client.get(f"/conversations/{conv_id}/messages", headers=bea[0])).json()["messages"]]
    assert "antes" in bodies and "después" not in bodies
    assert (await client.post(f"/conversations/{conv_id}/messages", json={"body": "hola"}, headers=bea[0])).status_code in (403, 404)
    out = await client.get(f"/communities/{cid}", headers=bea[0])
    assert out.status_code == 404 or out.json()["joined"] is False  # no longer her age: not even listed

    # the whole country: Toni (Toledo) can find it and join
    assert (await client.post(f"/communities/{cid}/join", headers=toni[0])).status_code in (403, 404)  # another province
    res = await client.post(f"/communities/{cid}/filters", json={"scope_kind": "country", "age_limit": False}, headers=ana[0])
    assert res.status_code == 200 and res.json()["province"] == "España"
    assert any(c["id"] == cid for c in (await client.get("/communities", headers=toni[0])).json())
    assert (await client.post(f"/communities/{cid}/join", headers=toni[0])).json() == {"status": "joined"}
