"""The administration's Claude key, languages translated by Claude, interest settings and edited countries."""

import asyncio

from app.core import ai, languages
from app.core.geo import merge_geography

from tests.helpers import admin_headers, make_user


async def test_claude_key_is_stored_encrypted_and_can_be_removed(client, db_session):
    headers = await admin_headers(client)
    assert (await client.put("/admin/ai", json={"api_key": "not-a-key"}, headers=headers)).status_code == 400
    res = (await client.put("/admin/ai", json={"api_key": "sk-ant-test-0123456789abcd", "model": "claude-sonnet-5-5"}, headers=headers)).json()
    assert res["configured"] and res["source"] == "panel" and res["hint"].endswith("abcd") and res["model"] == "claude-sonnet-5-5"
    async with db_session() as db:
        from app.core.app_settings import get_section
        stored = await get_section(db, "anthropic")
    assert stored["api_key"] and "sk-ant" not in stored["api_key"]  # encrypted
    assert (await client.get("/admin/automod", headers=headers)).json()["enabled"] is True
    res = (await client.put("/admin/ai", json={"clear": True}, headers=headers)).json()
    assert res["source"] in ("", "env")


async def test_adding_a_language_translates_it_and_people_can_pick_it(client, db_session, monkeypatch):
    headers = await admin_headers(client)

    async def fake_batch(name, code, batch):  # Claude, simulated: keeps placeholders, marks the text
        return {k: f"[ro] {v}" for k, v in batch.items()}

    monkeypatch.setattr(languages, "_translate_batch", fake_batch)
    assert (await client.post("/admin/languages", json={"code": "ro", "name": "Română"}, headers=headers)).status_code == 400  # no key
    await client.put("/admin/ai", json={"api_key": "sk-ant-test-0123456789abcd"}, headers=headers)
    res = await client.post("/admin/languages", json={"code": "ro", "name": "Română"}, headers=headers)
    assert res.status_code == 200
    for _ in range(100):
        if (languages.jobs.get("ro") or {}).get("state") != "running":
            break
        await asyncio.sleep(0.05)
    ro = next(l for l in (await client.get("/admin/languages", headers=headers)).json() if l["code"] == "ro")
    assert ro["translated"] == ro["total"] and not ro["enabled"] and not ro["builtin"]
    assert (await client.get("/i18n/languages")).json()["added"] == []  # not switched on yet
    await client.patch("/admin/languages/ro", json={"enabled": True}, headers=headers)
    assert (await client.get("/i18n/languages")).json()["added"] == [{"code": "ro", "name": "Română"}]
    texts = (await client.get("/i18n/ro")).json()
    assert texts["ui_login_btn"].startswith("[ro] ")
    # switching off a language that comes with MeetGo; English cannot be
    await client.patch("/admin/languages/ja", json={"enabled": False}, headers=headers)
    assert "ja" in (await client.get("/i18n/languages")).json()["disabled"]
    assert (await client.patch("/admin/languages/en", json={"enabled": False}, headers=headers)).status_code == 400
    await client.delete("/admin/languages/ro", headers=headers)
    assert (await client.get("/i18n/ro")).status_code == 404
    await client.put("/admin/ai", json={"clear": True}, headers=headers)


def test_a_translation_that_breaks_placeholders_is_dropped():
    assert languages._same_markup("Hi {name}, <b>go</b>", "Hola {name}, <b>ve</b>")
    assert not languages._same_markup("Hi {name}", "Hola {nombre}")


async def test_interest_look_and_age_restrictions(client, db_session):
    headers = await admin_headers(client)
    ana_h, ana = await make_user(client, db_session, "ana.rules@example.com", "Ana", dob="1980-01-01")  # 31-60
    interests = (await client.get("/admin/interests", headers=headers)).json()
    cine = next(i for i in interests if i["slug"] == "cine")
    assert (await client.patch(f"/admin/interests/{cine['id']}", json={"slug": "cine", "name": "Cine", "color": "red"}, headers=headers)).status_code == 400
    res = await client.patch(f"/admin/interests/{cine['id']}", json={
        "slug": "cine", "name": "Cine", "icon": "film", "color": "#ec4899", "category": "ui_cat_culture", "age_ranges": ["18_30"]}, headers=headers)
    assert res.json()["age_ranges"] == ["18_30"] and res.json()["color"] == "#ec4899"
    listed = [c["slug"] for c in (await client.get("/communities", headers=ana_h)).json()]
    assert "cine" not in listed and "senderismo" in listed
    assert (await client.post(f"/channels/{cine['id']}/join", headers=ana_h)).status_code == 404
    await client.post("/me/interests", json={"interest_slugs": ["cine"]}, headers=ana_h)
    assert "cine" not in (await client.get("/me/interests", headers=ana_h)).json()
    # switched off for everyone, then back on with its look
    await client.patch(f"/admin/interests/{cine['id']}", json={"slug": "cine", "name": "Cine", "age_ranges": [], "active": False}, headers=headers)
    assert "cine" not in [c["slug"] for c in (await client.get("/communities", headers=ana_h)).json()]
    await client.patch(f"/admin/interests/{cine['id']}", json={"slug": "cine", "name": "Cine", "active": True}, headers=headers)
    found = next(c for c in (await client.get("/communities", headers=ana_h)).json() if c["slug"] == "cine")
    assert found["icon"] == "film" and found["category"] == "ui_cat_culture"


def test_an_edited_country_is_kept_and_a_deleted_one_stays_deleted():
    data = {}
    merge_geography(data)
    es = data["provinces_by_country"]["ES"]
    data["countries"] = [{**c, "name": "Spain"} if c["code"] == "ES" else c for c in data["countries"]]
    data["provinces_by_country"]["ES"] = [r for r in es if r["value"] != "Huelva"]
    data["geo_edited"] = ["ES"]
    data["countries"] = [c for c in data["countries"] if c["code"] != "AD"]
    data["geo_removed"] = ["AD"]
    merge_geography(data)
    assert next(c for c in data["countries"] if c["code"] == "ES")["name"] == "Spain"
    assert "Huelva" not in {r["value"] for r in data["provinces_by_country"]["ES"]}
    assert "AD" not in {c["code"] for c in data["countries"]} and "AD" not in data["provinces_by_country"]
    assert next(c for c in data["calling_codes"] if c.get("code") == "PT")["cc"] == "+351"
