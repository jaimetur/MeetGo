from sqlalchemy import update

from app.core.models import User

_phone = [600000000]


async def make_user(client, db_session, email, name=None, province="Madrid", dob="1990-05-01", accept_dm=False, **extra):
    _phone[0] += 1
    payload = {"email": email, "phone": str(_phone[0]), "password": "secret123", "display_name": name or email.split("@")[0],
               "first_name": (name or email.split("@")[0]).split(".")[0], "last_name": "Prueba",
               "dob": dob, "country": "ES", "province": province, "accept_dm": accept_dm, **extra}
    res = await client.post("/auth/register", json=payload)
    assert res.status_code == 200, res.text
    async with db_session() as db:
        await db.execute(update(User).where(User.email == email).values(email_verified=True))
        await db.commit()
    res = await client.post("/auth/login", json={"email": email, "password": "secret123"})
    assert res.status_code == 200, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    me = (await client.get("/me", headers=headers)).json()
    return headers, me


async def admin_headers(client):
    res = await client.post("/admin/login", json={"username": "admin@test.local", "password": "admin-test-password"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def befriend(client, a, b):
    a_headers, a_me = a
    b_headers, b_me = b
    await client.post("/friends/requests", json={"to_user_id": b_me["id"]}, headers=a_headers)
    res = await client.post("/friends/requests", json={"to_user_id": a_me["id"]}, headers=b_headers)
    assert res.json()["status"] == "ACCEPTED"


async def register(client, email="ana@example.com", name="Ana", dob="1990-05-01", phone="612345678", **extra):
    payload = {"email": email, "phone": phone, "password": "secret123", "display_name": name,
               "first_name": name, "last_name": "Prueba", "dob": dob, "country": "ES", "province": "Madrid", **extra}
    return await client.post("/auth/register", json=payload)


async def verified_token(client, db_session, email="ana@example.com", **kw):
    res = await register(client, email=email, **kw)
    assert res.status_code == 200, res.text
    async with db_session() as db:
        await db.execute(update(User).where(User.email == email).values(email_verified=True))
        await db.commit()
    res = await client.post("/auth/login", json={"email": email, "password": "secret123"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}
