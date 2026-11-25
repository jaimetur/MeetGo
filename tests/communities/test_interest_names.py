"""Interest names in every language: built-in ones come translated; the administration edits them."""

from tests.helpers import admin_headers, make_user


async def test_interest_names_follow_the_language(client, db_session):
    h, _ = await make_user(client, db_session, "ana@example.com", "Ana")
    es = {i["slug"]: i["name"] for i in (await client.get("/interests", headers=h)).json()}
    en = {i["slug"]: i["name"] for i in (await client.get("/interests", headers={**h, "X-Lang": "en"})).json()}
    assert es["senderismo"] == "Senderismo" and en["senderismo"] == "Hiking"
    assert (es["economia"], en["economia"], es["politica"], en["politica"]) == ("Economía", "Economy", "Política", "Politics")

    admin = await admin_headers(client)
    created = (await client.post("/admin/interests", json={"slug": "astronomia", "name": "Astronomía", "names": {"en": "Astronomy", "fr": " "}},
                                 headers=admin)).json()
    assert created["base_name"] == "Astronomía" and created["names"] == {"en": "Astronomy"}  # an empty one is not kept
    fr = {i["slug"]: i["name"] for i in (await client.get("/interests", headers={**h, "X-Lang": "fr"})).json()}
    en = {i["slug"]: i["name"] for i in (await client.get("/interests", headers={**h, "X-Lang": "en"})).json()}
    assert en["astronomia"] == "Astronomy" and fr["astronomia"] == "Astronomía"
