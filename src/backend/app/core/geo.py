"""Countries and their regions (provinces, states, regions or departments: the level people would call "where I live").

A community belongs to a region and an age range, without the country, so a region's value is unique across countries:
when two countries share a name (Córdoba, La Rioja, Limburg...), the later country's value carries its code, e.g.
"Córdoba (AR)". Spain keeps the values it always had (stored in accounts and communities); its names have accents.
"""

import unicodedata

# (code, name in Spanish, calling code, regions). A region is a name, or (value, name) when the value differs.
COUNTRIES: list[tuple[str, str, str, list]] = [
    ("ES", "España", "+34", [
        ("A Coruna", "A Coruña"), ("Alava", "Álava"), "Albacete", "Alicante", ("Almeria", "Almería"), "Asturias",
        ("Avila", "Ávila"), "Badajoz", "Barcelona", "Bizkaia", "Burgos", ("Caceres", "Cáceres"), ("Cadiz", "Cádiz"),
        "Cantabria", ("Castellon", "Castellón"), "Ceuta", "Ciudad Real", ("Cordoba", "Córdoba"), "Cuenca", "Gipuzkoa",
        "Girona", "Granada", "Guadalajara", "Huelva", "Huesca", "Illes Balears", ("Jaen", "Jaén"), "La Rioja",
        "Las Palmas", ("Leon", "León"), "Lleida", "Lugo", "Madrid", ("Malaga", "Málaga"), "Melilla", "Murcia", "Navarra",
        "Ourense", "Palencia", "Pontevedra", "Salamanca", "Santa Cruz de Tenerife", "Segovia", "Sevilla", "Soria",
        "Tarragona", "Teruel", "Toledo", "Valencia", "Valladolid", "Zamora", "Zaragoza",
    ]),
    ("DE", "Alemania", "+49", [
        "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hessen", "Mecklenburg-Vorpommern",
        "Niedersachsen", "Nordrhein-Westfalen", "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt",
        "Schleswig-Holstein", "Thüringen",
    ]),
    ("AD", "Andorra", "+376", [
        "Andorra la Vella", "Canillo", "Encamp", "Escaldes-Engordany", "La Massana", "Ordino", "Sant Julià de Lòria",
    ]),
    ("AR", "Argentina", "+54", [
        "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Ciudad Autónoma de Buenos Aires", "Córdoba", "Corrientes",
        "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta",
        "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
    ]),
    ("AT", "Austria", "+43", [
        "Burgenland", "Kärnten", "Niederösterreich", "Oberösterreich", "Salzburg", "Steiermark", "Tirol", "Vorarlberg",
        "Wien",
    ]),
    ("BE", "Bélgica", "+32", [
        "Antwerpen", "Bruxelles-Capitale / Brussels", "Brabant wallon", "Hainaut", "Liège", "Limburg", "Luxembourg",
        "Namur", "Oost-Vlaanderen", "Vlaams-Brabant", "West-Vlaanderen",
    ]),
    ("BO", "Bolivia", "+591", [
        "Beni", "Chuquisaca", "Cochabamba", "La Paz", "Oruro", "Pando", "Potosí", "Santa Cruz", "Tarija",
    ]),
    ("BR", "Brasil", "+55", [
        "Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal", "Espírito Santo", "Goiás",
        "Maranhão", "Mato Grosso", "Mato Grosso do Sul", "Minas Gerais", "Pará", "Paraíba", "Paraná", "Pernambuco",
        "Piauí", "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia", "Roraima", "Santa Catarina",
        "São Paulo", "Sergipe", "Tocantins",
    ]),
    ("CA", "Canadá", "+1", [
        "Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Northwest Territories",
        "Nova Scotia", "Nunavut", "Ontario", "Prince Edward Island", "Québec", "Saskatchewan", "Yukon",
    ]),
    ("CL", "Chile", "+56", [
        "Antofagasta", "Araucanía", "Arica y Parinacota", "Atacama", "Aysén", "Biobío", "Coquimbo", "Los Lagos",
        "Los Ríos", "Magallanes", "Maule", "Metropolitana de Santiago", "Ñuble", "O'Higgins", "Tarapacá", "Valparaíso",
    ]),
    ("CN", "China", "+86", [
        "Anhui", "Beijing", "Chongqing", "Fujian", "Gansu", "Guangdong", "Guangxi", "Guizhou", "Hainan", "Hebei",
        "Heilongjiang", "Henan", "Hong Kong", "Hubei", "Hunan", "Inner Mongolia", "Jiangsu", "Jiangxi", "Jilin",
        "Liaoning", "Macau", "Ningxia", "Qinghai", "Shaanxi", "Shandong", "Shanghai", "Shanxi", "Sichuan", "Tianjin",
        "Tibet", "Xinjiang", "Yunnan", "Zhejiang",
    ]),
    ("CO", "Colombia", "+57", [
        "Amazonas", "Antioquia", "Arauca", "Atlántico", "Bogotá D.C.", "Bolívar", "Boyacá", "Caldas", "Caquetá",
        "Casanare", "Cauca", "Cesar", "Chocó", "Córdoba", "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira",
        "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo", "Quindío", "Risaralda",
        "San Andrés y Providencia", "Santander", "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada",
    ]),
    ("CR", "Costa Rica", "+506", ["Alajuela", "Cartago", "Guanacaste", "Heredia", "Limón", "Puntarenas", "San José"]),
    ("CU", "Cuba", "+53", [
        "Artemisa", "Camagüey", "Ciego de Ávila", "Cienfuegos", "Granma", "Guantánamo", "Holguín", "Isla de la Juventud",
        "La Habana", "Las Tunas", "Matanzas", "Mayabeque", "Pinar del Río", "Sancti Spíritus", "Santiago de Cuba",
        "Villa Clara",
    ]),
    ("EC", "Ecuador", "+593", [
        "Azuay", "Bolívar", "Cañar", "Carchi", "Chimborazo", "Cotopaxi", "El Oro", "Esmeraldas", "Galápagos", "Guayas",
        "Imbabura", "Loja", "Los Ríos", "Manabí", "Morona Santiago", "Napo", "Orellana", "Pastaza", "Pichincha",
        "Santa Elena", "Santo Domingo de los Tsáchilas", "Sucumbíos", "Tungurahua", "Zamora Chinchipe",
    ]),
    ("SV", "El Salvador", "+503", [
        "Ahuachapán", "Cabañas", "Chalatenango", "Cuscatlán", "La Libertad", "La Paz", "La Unión", "Morazán",
        "San Miguel", "San Salvador", "San Vicente", "Santa Ana", "Sonsonate", "Usulután",
    ]),
    ("US", "Estados Unidos", "+1", [
        "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
        "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas",
        "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
        "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
        "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Puerto Rico", "Rhode Island", "South Carolina",
        "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin",
        "Wyoming",
    ]),
    ("FR", "Francia", "+33", [
        ("Auvergne-Rhone-Alpes", "Auvergne-Rhône-Alpes"), "Bourgogne-Franche-Comté", "Bretagne", "Centre-Val de Loire",
        "Corse", "Grand Est", "Guadeloupe", "Guyane", "Hauts-de-France", ("Ile-de-France", "Île-de-France"),
        "La Réunion", "Martinique", "Mayotte", "Normandie", "Nouvelle-Aquitaine", "Occitanie", "Pays de la Loire",
        "Provence-Alpes-Côte d'Azur",
    ]),
    ("GT", "Guatemala", "+502", [
        "Alta Verapaz", "Baja Verapaz", "Chimaltenango", "Chiquimula", "El Progreso", "Escuintla", "Guatemala",
        "Huehuetenango", "Izabal", "Jalapa", "Jutiapa", "Petén", "Quetzaltenango", "Quiché", "Retalhuleu", "Sacatepéquez",
        "San Marcos", "Santa Rosa", "Sololá", "Suchitepéquez", "Totonicapán", "Zacapa",
    ]),
    ("HN", "Honduras", "+504", [
        "Atlántida", "Choluteca", "Colón", "Comayagua", "Copán", "Cortés", "El Paraíso", "Francisco Morazán",
        "Gracias a Dios", "Intibucá", "Islas de la Bahía", "La Paz", "Lempira", "Ocotepeque", "Olancho", "Santa Bárbara",
        "Valle", "Yoro",
    ]),
    ("IE", "Irlanda", "+353", [
        "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois",
        "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo",
        "Tipperary", "Waterford", "Westmeath", "Wexford", "Wicklow",
    ]),
    ("IT", "Italia", "+39", [
        "Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli-Venezia Giulia", "Lazio", "Liguria",
        "Lombardia", "Marche", "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana", "Trentino-Alto Adige",
        "Umbria", "Valle d'Aosta", "Veneto",
    ]),
    ("JP", "Japón", "+81", [
        "Aichi", "Akita", "Aomori", "Chiba", "Ehime", "Fukui", "Fukuoka", "Fukushima", "Gifu", "Gunma", "Hiroshima",
        "Hokkaido", "Hyogo", "Ibaraki", "Ishikawa", "Iwate", "Kagawa", "Kagoshima", "Kanagawa", "Kochi", "Kumamoto",
        "Kyoto", "Mie", "Miyagi", "Miyazaki", "Nagano", "Nagasaki", "Nara", "Niigata", "Oita", "Okayama", "Okinawa",
        "Osaka", "Saga", "Saitama", "Shiga", "Shimane", "Shizuoka", "Tochigi", "Tokushima", "Tokyo", "Tottori", "Toyama",
        "Wakayama", "Yamagata", "Yamaguchi", "Yamanashi",
    ]),
    ("MX", "México", "+52", [
        "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México",
        "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán",
        "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa",
        "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
    ]),
    ("NI", "Nicaragua", "+505", [
        "Boaco", "Carazo", "Chinandega", "Chontales", "Costa Caribe Norte", "Costa Caribe Sur", "Estelí", "Granada",
        "Jinotega", "León", "Madriz", "Managua", "Masaya", "Matagalpa", "Nueva Segovia", "Río San Juan", "Rivas",
    ]),
    ("NL", "Países Bajos", "+31", [
        "Drenthe", "Flevoland", "Friesland", "Gelderland", "Groningen", "Limburg", "Noord-Brabant", "Noord-Holland",
        "Overijssel", "Utrecht", "Zeeland", "Zuid-Holland",
    ]),
    ("PA", "Panamá", "+507", [
        "Bocas del Toro", "Chiriquí", "Coclé", "Colón", "Darién", "Herrera", "Los Santos", "Panamá", "Panamá Oeste",
        "Veraguas",
    ]),
    ("PY", "Paraguay", "+595", [
        "Alto Paraguay", "Alto Paraná", "Amambay", "Asunción", "Boquerón", "Caaguazú", "Caazapá", "Canindeyú", "Central",
        "Concepción", "Cordillera", "Guairá", "Itapúa", "Misiones", "Ñeembucú", "Paraguarí", "Presidente Hayes",
        "San Pedro",
    ]),
    ("PE", "Perú", "+51", [
        "Amazonas", "Áncash", "Apurímac", "Arequipa", "Ayacucho", "Cajamarca", "Callao", "Cusco", "Huancavelica",
        "Huánuco", "Ica", "Junín", "La Libertad", "Lambayeque", "Lima", "Loreto", "Madre de Dios", "Moquegua", "Pasco",
        "Piura", "Puno", "San Martín", "Tacna", "Tumbes", "Ucayali",
    ]),
    ("PL", "Polonia", "+48", [
        "Dolnośląskie", "Kujawsko-Pomorskie", "Łódzkie", "Lubelskie", "Lubuskie", "Małopolskie", "Mazowieckie",
        "Opolskie", "Podkarpackie", "Podlaskie", "Pomorskie", "Śląskie", "Świętokrzyskie", "Warmińsko-Mazurskie",
        "Wielkopolskie", "Zachodniopomorskie",
    ]),
    ("PT", "Portugal", "+351", [
        "Açores", "Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco", "Coimbra", "Évora", "Faro", "Guarda", "Leiria",
        "Lisboa", "Madeira", "Portalegre", "Porto", "Santarém", ("Setubal", "Setúbal"), "Viana do Castelo", "Vila Real",
        "Viseu",
    ]),
    ("GB", "Reino Unido", "+44", [
        "East Midlands", "East of England", "London", "North East England", "North West England", "Northern Ireland",
        "Scotland", "South East England", "South West England", "Wales", "West Midlands", "Yorkshire and the Humber",
    ]),
    ("DO", "República Dominicana", "+1", [
        "Azua", "Bahoruco", "Barahona", "Dajabón", "Distrito Nacional", "Duarte", "El Seibo", "Elías Piña", "Espaillat",
        "Hato Mayor", "Hermanas Mirabal", "Independencia", "La Altagracia", "La Romana", "La Vega",
        "María Trinidad Sánchez", "Monseñor Nouel", "Monte Cristi", "Monte Plata", "Pedernales", "Peravia", "Puerto Plata",
        "Samaná", "San Cristóbal", "San José de Ocoa", "San Juan", "San Pedro de Macorís", "Sánchez Ramírez", "Santiago",
        "Santiago Rodríguez", "Santo Domingo", "Valverde",
    ]),
    ("CH", "Suiza", "+41", [
        "Aargau", "Appenzell Ausserrhoden", "Appenzell Innerrhoden", "Basel-Landschaft", "Basel-Stadt", "Bern",
        "Fribourg", "Genève", "Glarus", "Graubünden", "Jura", "Luzern", "Neuchâtel", "Nidwalden", "Obwalden",
        "Schaffhausen", "Schwyz", "Solothurn", "St. Gallen", "Thurgau", "Ticino", "Uri", "Valais", "Vaud", "Zug",
        "Zürich",
    ]),
    ("UY", "Uruguay", "+598", [
        "Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Flores", "Florida", "Lavalleja", "Maldonado",
        "Montevideo", "Paysandú", "Río Negro", "Rivera", "Rocha", "Salto", "San José", "Soriano", "Tacuarembó",
        "Treinta y Tres",
    ]),
    ("VE", "Venezuela", "+58", [
        "Amazonas", "Anzoátegui", "Apure", "Aragua", "Barinas", "Bolívar", "Carabobo", "Cojedes", "Delta Amacuro",
        "Distrito Capital", "Falcón", "Guárico", "La Guaira", "Lara", "Mérida", "Miranda", "Monagas", "Nueva Esparta",
        "Portuguesa", "Sucre", "Táchira", "Trujillo", "Yaracuy", "Zulia",
    ]),
]


# What each country's regions are called (Spain and the rest: provinces).
REGION_KINDS = {
    "DE": "state", "AT": "state", "BR": "state", "MX": "state", "US": "state", "VE": "state",
    "CL": "region", "FR": "region", "IT": "region", "GB": "region",
    "BO": "department", "CO": "department", "SV": "department", "GT": "department", "HN": "department",
    "NI": "department", "PY": "department", "PE": "department", "UY": "department",
    "IE": "county", "JP": "prefecture", "CH": "canton", "PT": "district", "AD": "parish", "PL": "voivodeship",
}


# Where regions group into a bigger level (Spain's provinces into autonomous communities...): (value, name, regions).
GROUP_KINDS = {"ES": "autonomous_community", "IE": "province", "JP": "region"}
GROUPS: dict[str, list[tuple[str, str, list[str]]]] = {
    "ES": [
        ("andalucia", "Andalucía", ["Almeria", "Cadiz", "Cordoba", "Granada", "Huelva", "Jaen", "Malaga", "Sevilla"]),
        ("aragon", "Aragón", ["Huesca", "Teruel", "Zaragoza"]),
        ("asturias", "Asturias", ["Asturias"]),
        ("baleares", "Illes Balears", ["Illes Balears"]),
        ("canarias", "Canarias", ["Las Palmas", "Santa Cruz de Tenerife"]),
        ("cantabria", "Cantabria", ["Cantabria"]),
        ("castilla_la_mancha", "Castilla-La Mancha", ["Albacete", "Ciudad Real", "Cuenca", "Guadalajara", "Toledo"]),
        ("castilla_y_leon", "Castilla y León", ["Avila", "Burgos", "Leon", "Palencia", "Salamanca", "Segovia", "Soria",
                                                "Valladolid", "Zamora"]),
        ("cataluna", "Cataluña", ["Barcelona", "Girona", "Lleida", "Tarragona"]),
        ("ceuta", "Ceuta", ["Ceuta"]),
        ("valenciana", "Comunitat Valenciana", ["Alicante", "Castellon", "Valencia"]),
        ("extremadura", "Extremadura", ["Badajoz", "Caceres"]),
        ("galicia", "Galicia", ["A Coruna", "Lugo", "Ourense", "Pontevedra"]),
        ("madrid", "Comunidad de Madrid", ["Madrid"]),
        ("melilla", "Melilla", ["Melilla"]),
        ("murcia", "Región de Murcia", ["Murcia"]),
        ("navarra", "Navarra", ["Navarra"]),
        ("pais_vasco", "País Vasco", ["Alava", "Bizkaia", "Gipuzkoa"]),
        ("la_rioja", "La Rioja", ["La Rioja"]),
    ],
    "IE": [
        ("connacht", "Connacht", ["Galway", "Leitrim", "Mayo", "Roscommon", "Sligo"]),
        ("leinster", "Leinster", ["Carlow", "Dublin", "Kildare", "Kilkenny", "Laois", "Longford", "Louth", "Meath", "Offaly",
                                  "Westmeath", "Wexford", "Wicklow"]),
        ("munster", "Munster", ["Clare", "Cork", "Kerry", "Limerick", "Tipperary", "Waterford"]),
        ("ulster", "Ulster", ["Cavan", "Donegal", "Monaghan"]),
    ],
    "JP": [
        ("hokkaido", "Hokkaido", ["Hokkaido"]),
        ("tohoku", "Tohoku", ["Aomori", "Iwate", "Miyagi", "Akita", "Yamagata", "Fukushima"]),
        ("kanto", "Kanto", ["Ibaraki", "Tochigi", "Gunma", "Saitama", "Chiba", "Tokyo", "Kanagawa"]),
        ("chubu", "Chubu", ["Niigata", "Toyama", "Ishikawa", "Fukui", "Yamanashi", "Nagano", "Gifu", "Shizuoka", "Aichi"]),
        ("kansai", "Kansai", ["Mie", "Shiga", "Kyoto", "Osaka", "Hyogo", "Nara", "Wakayama"]),
        ("chugoku", "Chugoku", ["Tottori", "Shimane", "Okayama", "Hiroshima", "Yamaguchi"]),
        ("shikoku", "Shikoku", ["Tokushima", "Kagawa", "Ehime", "Kochi"]),
        ("kyushu", "Kyushu y Okinawa", ["Fukuoka", "Saga", "Nagasaki", "Kumamoto", "Oita", "Miyazaki", "Kagoshima", "Okinawa"]),
    ],
}
GEO_GROUPS = {code: [{"value": v, "name": n, "regions": r} for v, n, r in groups] for code, groups in GROUPS.items()}


def _key(s: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(ch) != "Mn")


def _build() -> tuple[list[dict], list[dict], dict[str, list[dict]]]:
    taken: set[str] = set()
    countries, calling, regions = [], [], {}
    for code, name, cc, items in COUNTRIES:
        countries.append({"code": code, "name": name})
        calling.append({"cc": cc, "name": name, "code": code})
        out = []
        for item in items:
            value, label = item if isinstance(item, tuple) else (item, item)
            if _key(value) in taken:
                value = f"{value} ({code})"
            taken.add(_key(value))
            out.append({"value": value, "name": label})
        regions[code] = sorted(out, key=lambda r: _key(r["name"]))
    return countries, calling, regions


GEO_COUNTRIES, GEO_CALLING_CODES, GEO_REGIONS = _build()


GEO_KEYS = ("countries", "calling_codes", "provinces_by_country", "region_kinds", "group_kinds", "region_groups")


def merge_geography(data: dict) -> bool:
    """Brings the countries and regions above into the settings. True if anything changed.

    A country the administrator edited (listed in `geo_edited`) is kept exactly as they left it, and one they deleted
    (`geo_removed`) does not come back; the others follow the lists above, plus any region an administrator added.
    """
    before = repr([data.get(k) for k in GEO_KEYS])
    edited = set(data.get("geo_edited") or [])
    removed = set(data.get("geo_removed") or [])
    known = {c["code"] for c in GEO_COUNTRIES}
    old_countries = {c.get("code"): c for c in data.get("countries") or []}
    data["countries"] = [old_countries.get(c["code"], c) if c["code"] in edited else c for c in GEO_COUNTRIES if c["code"] not in removed] \
        + [c for c in data.get("countries") or [] if c.get("code") not in known]

    old_ccs = data.get("calling_codes") or []
    by_code = {c.get("code"): c for c in old_ccs if c.get("code")}
    ccs = {(c["cc"], c["name"]) for c in GEO_CALLING_CODES}
    old_names = {_key(c["name"]) for c in GEO_CALLING_CODES} | {"espana", "mexico", "canada", "japon", "peru", "panama"}
    data["calling_codes"] = [by_code.get(c["code"], c) if c["code"] in edited else c for c in GEO_CALLING_CODES if c["code"] not in removed] \
        + [c for c in old_ccs if (c.get("code") and c["code"] not in known)
           or (not c.get("code") and (c.get("cc"), c.get("name")) not in ccs and _key(c.get("name") or "") not in old_names)]

    provinces = dict(data.get("provinces_by_country") or {})
    for code, regions in GEO_REGIONS.items():
        if code in removed:
            provinces.pop(code, None)
        elif code in edited and code in provinces:
            continue
        else:
            values = {r["value"] for r in regions}
            provinces[code] = regions + [r for r in provinces.get(code) or [] if r.get("value") not in values]
    data["provinces_by_country"] = provinces

    for key, builtin in (("region_kinds", REGION_KINDS), ("group_kinds", GROUP_KINDS), ("region_groups", GEO_GROUPS)):
        old = dict(data.get(key) or {})
        merged = {k: v for k, v in builtin.items() if k not in removed and k not in edited}
        merged.update({k: v for k, v in old.items() if k in edited or (k not in known)})
        data[key] = merged
    return repr([data.get(k) for k in GEO_KEYS]) != before
