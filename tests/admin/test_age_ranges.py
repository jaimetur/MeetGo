"""Settings → Age ranges: the administration moves the limits; whoever changes range follows to the communities of the new
one (the old ones stay as away), a range of 0 years disappears, and widening it again brings its people back."""

from tests.helpers import admin_headers, make_user


def _year(age: int) -> str:
    from datetime import date
    today = date.today()
    return f"{today.year - age - 1}-01-15"


async def _my_communities(client, headers):
    return {(c["interest_slug"] if "interest_slug" in c else c["title"]): c for c in (await client.get("/communities", params={"mine": 1}, headers=headers)).json()}


async def test_moving_the_limits_moves_people_and_an_empty_range_comes_back(client, db_session):
    adm = await admin_headers(client)
    ana = await make_user(client, db_session, "ana@example.com", "Ana", dob=_year(25))
    leo = await make_user(client, db_session, "leo@example.com", "Leo", dob=_year(35))
    for who in (ana, leo):
        await client.post("/me/interests", json={"interest_slugs": ["senderismo"]}, headers=who[0])
    assert (await client.get("/me", headers=leo[0])).json()["age_range"] == "31_60"

    pre = (await client.post("/admin/age-ranges/preview", json={"young": 40, "middle": 60}, headers=adm)).json()
    assert pre["moving"] == 1 and [r["label"] for r in pre["ranges"]] == ["18-40", "41-60", "61+"]
    assert not (await client.put("/admin/age-ranges", json={"young": 40, "middle": 60}, headers=ana[0])).status_code == 200  # admins only

    res = (await client.put("/admin/age-ranges", json={"young": 40, "middle": 60}, headers=adm)).json()
    assert res["moved"] == 1
    assert (await client.get("/me", headers=leo[0])).json()["age_range"] == "18_30"
    labels = [r["label"] for r in (await client.get("/settings/public")).json()["age_ranges"]]
    assert labels == ["18-40", "41-60", "61+"]
    # Leo now shares the hiking community with Ana
    leo_mine = (await client.get("/communities", params={"mine": 1}, headers=leo[0])).json()
    ana_mine = (await client.get("/communities", params={"mine": 1}, headers=ana[0])).json()
    assert {c["id"] for c in leo_mine} & {c["id"] for c in ana_mine}

    # the first range left with no years: Ana goes to the next one
    res = (await client.put("/admin/age-ranges", json={"young": 17, "middle": 60}, headers=adm)).json()
    ranges = (await client.get("/settings/public")).json()["age_ranges"]
    assert ranges[0]["empty"] is True and ranges[1]["label"] == "18-60"
    assert (await client.get("/me", headers=ana[0])).json()["age_range"] == "31_60"
    ana_middle = {c["id"] for c in (await client.get("/communities", params={"mine": 1}, headers=ana[0])).json()}
    assert ana_middle and not ana_middle & {c["id"] for c in ana_mine}

    # widening it again brings them back to the communities they had
    await client.put("/admin/age-ranges", json={"young": 30, "middle": 60}, headers=adm)
    assert (await client.get("/me", headers=ana[0])).json()["age_range"] == "18_30"
    assert {c["id"] for c in (await client.get("/communities", params={"mine": 1}, headers=ana[0])).json()} == {c["id"] for c in ana_mine}
