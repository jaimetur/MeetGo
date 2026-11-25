"""Everyone gives a first name and surname(s); the display name is a one-word alias nobody else has (case aside)."""

from tests.helpers import make_user, register


async def test_sign_up_needs_names_and_a_free_one_word_alias(client, db_session):
    base = {"email": "jaime@example.com", "phone": "611000001", "password": "secret123", "dob": "1990-01-01",
            "country": "ES", "province": "Madrid", "display_name": "jaimetur", "first_name": "Jaime", "last_name": "Tur"}
    for missing in ("first_name", "last_name"):
        assert (await client.post("/auth/register", json={**base, missing: " "})).status_code == 400
    for bad in ("jaime tur", "ja", ".jaime", "jaime!"):
        assert (await client.post("/auth/register", json={**base, "display_name": bad})).status_code == 400, bad
    res = await client.post("/auth/register", json={**base, "display_name": "@jaimetur"})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["display_name"] == "jaimetur" and out["first_name"] == "Jaime" and out["last_name"] == "Tur"
    taken = await client.post("/auth/register", json={**base, "email": "otro@example.com", "phone": "611000002",
                                                      "display_name": "JaimeTur"})
    assert taken.status_code == 409


async def test_profile_changes_alias_and_names(client, db_session):
    h, me = await make_user(client, db_session, "javier@example.com", "javier")
    await make_user(client, db_session, "otro@example.com", "zirintione")
    assert (await client.patch("/me/profile", json={"display_name": "Zirintione"}, headers=h)).status_code == 409
    assert (await client.patch("/me/profile", json={"last_name": ""}, headers=h)).status_code == 400
    res = await client.patch("/me/profile", json={"display_name": "javier.c", "last_name": "  Calderón  "}, headers=h)
    assert res.status_code == 200 and res.json()["display_name"] == "javier.c" and res.json()["last_name"] == "Calderón"
    # keeping my own alias (any case) is not "taken"
    assert (await client.patch("/me/profile", json={"display_name": "javier.c"}, headers=h)).status_code == 200
    card = (await client.get(f"/users/{me['id']}", headers=h)).json()
    assert card["first_name"] == "javier" and card["last_name"] == "Calderón"
