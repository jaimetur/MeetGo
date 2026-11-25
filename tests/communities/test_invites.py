"""Owners and administrators invite people registered in MeetGo (besides the link); they accept or decline."""

from tests.communities.test_communities import _create
from tests.helpers import make_user


async def test_invite_registered_people_who_accept_or_decline(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    far = await make_user(client, db_session, "far@example.com", "Far", province="Barcelona")
    com = await _create(client, ana[0], access_mode="invite")

    found = (await client.get(f"/communities/{com['id']}/invite-candidates", params={"q": "be"}, headers=ana[0])).json()
    assert [p["username"] for p in found] == ["Bea"]
    everyone = {p["username"] for p in (await client.get(f"/communities/{com['id']}/invite-candidates", headers=ana[0])).json()}
    assert {"Bea", "Cris"} <= everyone and not {"Far", "Ana"} & everyone  # not another zone, not herself
    # only the owner and administrators invite
    assert (await client.get(f"/communities/{com['id']}/invite-candidates", headers=bea[0])).status_code in (403, 404)

    res = await client.post(f"/communities/{com['id']}/invites", json={"user_ids": [bea[1]["id"], cris[1]["id"], far[1]["id"]]}, headers=ana[0])
    assert res.json() == {"invited": 2}
    again = await client.post(f"/communities/{com['id']}/invites", json={"user_ids": [bea[1]["id"]]}, headers=ana[0])
    assert again.json() == {"invited": 0}  # already invited
    assert all(p["invited"] for p in (await client.get(f"/communities/{com['id']}/invite-candidates", headers=ana[0])).json() if p["username"] in ("Bea", "Cris"))

    [inv] = (await client.get("/community-invites", headers=bea[0])).json()
    assert inv["community"]["id"] == com["id"] and inv["from_user"]["username"] == "Ana"
    assert (await client.post(f"/community-invites/{inv['id']}/resolve", json={"accept": True}, headers=cris[0])).status_code == 404
    joined = await client.post(f"/community-invites/{inv['id']}/resolve", json={"accept": True}, headers=bea[0])
    assert joined.json() == {"status": "joined", "community_id": com["id"]}
    assert (await client.get(f"/communities/{com['id']}", headers=bea[0])).json()["joined"] is True
    assert (await client.get("/community-invites", headers=bea[0])).json() == []

    [inv] = (await client.get("/community-invites", headers=cris[0])).json()
    assert (await client.post(f"/community-invites/{inv['id']}/resolve", json={"accept": False}, headers=cris[0])).json() == {"status": "declined"}
    assert (await client.get("/community-invites", headers=cris[0])).json() == []
    # members are no longer candidates
    assert "Bea" not in {p["username"] for p in (await client.get(f"/communities/{com['id']}/invite-candidates", headers=ana[0])).json()}
