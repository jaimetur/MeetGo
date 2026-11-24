"""My photo: uploaded, cropped square and served at a fixed address."""

import io

from PIL import Image

from tests.helpers import make_user


def _photo(w=800, h=600, fmt="JPEG"):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 80, 40)).save(buf, fmt)
    return buf.getvalue()


async def test_upload_replace_and_remove_my_photo(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    res = await client.post("/me/avatar", files={"file": ("me.jpg", _photo(), "image/jpeg")}, headers=ana[0])
    assert res.status_code == 200, res.text
    first = res.json()["avatar_url"]
    assert first.startswith("/avatars/")
    got = await client.get(first)
    assert got.status_code == 200 and got.headers["content-type"] == "image/webp"
    assert Image.open(io.BytesIO(got.content)).size == (512, 512)  # square

    second = (await client.post("/me/avatar", files={"file": ("b.png", _photo(300, 900, "PNG"), "image/png")}, headers=ana[0])).json()["avatar_url"]
    assert second != first and (await client.get(first)).status_code == 404  # the old one is gone
    assert (await client.get("/me", headers=ana[0])).json()["avatar_url"] == second

    assert (await client.post("/me/avatar", files={"file": ("x.jpg", b"not an image", "image/jpeg")}, headers=ana[0])).status_code == 400
    assert (await client.delete("/me/avatar", headers=ana[0])).json()["avatar_url"] is None
    assert (await client.get(second)).status_code == 404
    assert (await client.get("/avatars/../secret")).status_code == 404
