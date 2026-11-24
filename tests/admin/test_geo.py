"""Countries and regions: complete lists, unique region values, and an administrator's additions are kept."""

from app.core.geo import GEO_REGIONS, merge_geography


def test_regions_are_unique_and_spain_is_complete():
    values = [r["value"] for regions in GEO_REGIONS.values() for r in regions]
    assert len(values) == len(set(values))
    assert len(GEO_REGIONS["ES"]) == 52 and {"Huelva", "Madrid", "Ceuta", "Melilla"} <= {r["value"] for r in GEO_REGIONS["ES"]}
    assert len(GEO_REGIONS["US"]) == 52 and len(GEO_REGIONS["MX"]) == 32


def test_merge_keeps_what_an_administrator_added():
    data = {"countries": [{"code": "ES", "name": "Espana"}, {"code": "XX", "name": "Mi país"}],
            "provinces_by_country": {"ES": [{"value": "Huelva", "name": "Huelva"}, {"value": "Mi zona", "name": "Mi zona"}]}}
    assert merge_geography(data) is True
    assert {"code": "XX", "name": "Mi país"} in data["countries"]
    assert next(c for c in data["countries"] if c["code"] == "ES")["name"] == "España"
    assert {"value": "Mi zona", "name": "Mi zona"} in data["provinces_by_country"]["ES"]
    assert merge_geography(data) is False  # nothing more to add


def test_groups_name_existing_regions_and_cover_spain():
    from app.core.geo import GROUPS
    for code, groups in GROUPS.items():
        values = {r["value"] for r in GEO_REGIONS[code]}
        grouped = [r for _, _, regions in groups for r in regions]
        assert set(grouped) <= values and len(grouped) == len(set(grouped)), code
    assert {r for _, _, regions in GROUPS["ES"] for r in regions} == {r["value"] for r in GEO_REGIONS["ES"]}
