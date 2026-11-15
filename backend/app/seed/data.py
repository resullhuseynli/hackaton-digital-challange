"""Static seed data for Baku. Polygons are simplified (they tile the city without overlaps)
but follow the real relative layout of the districts. Coordinates are (lng, lat)."""

# longitude / latitude breakpoints used to tile the districts
A, B, C, D, E, F = 49.775, 49.815, 49.860, 49.920, 49.975, 50.080

ZONES: list[dict] = [
    {"id": 1, "name": "Nəsimi", "population": 230_000,
     "polygon": [(B, 40.372), (C, 40.372), (C, 40.400), (B, 40.400)]},
    {"id": 2, "name": "Yasamal", "population": 250_000,
     "polygon": [(A, 40.360), (B, 40.360), (B, 40.425), (A, 40.425)]},
    {"id": 3, "name": "Səbail", "population": 100_000,
     "polygon": [(A, 40.330), (C, 40.330), (C, 40.372), (B, 40.372), (B, 40.360), (A, 40.360)]},
    {"id": 4, "name": "Nərimanov", "population": 170_000,
     "polygon": [(B, 40.400), (D, 40.400), (D, 40.425), (B, 40.425)]},
    {"id": 5, "name": "Xətai", "population": 280_000,
     "polygon": [(C, 40.340), (E, 40.340), (E, 40.400), (C, 40.400)]},
    {"id": 6, "name": "Binəqədi", "population": 260_000,
     "polygon": [(A, 40.425), (C, 40.425), (C, 40.500), (A, 40.500)]},
    {"id": 7, "name": "Nizami", "population": 200_000,
     "polygon": [(D, 40.400), (E, 40.400), (E, 40.425), (D, 40.425)]},
    {"id": 8, "name": "Sabunçu", "population": 240_000,
     "polygon": [(C, 40.425), (F, 40.425), (F, 40.520), (C, 40.520)]},
    {"id": 9, "name": "Suraxanı", "population": 210_000,
     "polygon": [(E, 40.360), (F, 40.360), (F, 40.425), (E, 40.425)]},
    {"id": 10, "name": "Xəzər", "population": 170_000,
     "polygon": [(F, 40.360), (50.220, 40.360), (50.220, 40.520), (F, 40.520)]},
    {"id": 11, "name": "Qaradağ", "population": 125_000,
     "polygon": [(49.680, 40.280), (A, 40.280), (A, 40.450), (49.680, 40.450)]},
]

# (name, type, lat, lng, capacity, initial current_count, status)
ASSEMBLY_POINTS: list[tuple] = [
    ("Dənizkənarı Milli Park", "park", 40.3667, 49.8352, 20000, 6200, "active"),
    ("Fəvvarələr meydanı", "park", 40.3707, 49.8370, 5000, 2100, "active"),
    ("Dağüstü Park", "park", 40.3555, 49.8270, 6000, 1500, "active"),
    ("Dalğa Arena", "stadium", 40.3420, 49.8150, 6500, 900, "active"),
    ("Səməd Vurğun parkı", "park", 40.3790, 49.8410, 3000, 1800, "active"),
    ("Sahil bağı", "park", 40.3735, 49.8460, 2500, 600, "active"),
    ("28 May metrosu sığınacağı", "shelter", 40.3800, 49.8490, 1500, 1200, "active"),
    ("Tofiq Bəhramov adına Respublika Stadionu", "stadium", 40.4015, 49.8610, 18000, 4000, "active"),
    ("Atatürk parkı", "park", 40.4040, 49.8680, 4000, 1100, "active"),
    ("Gənclik metrosu sığınacağı", "shelter", 40.4005, 49.8510, 1500, 700, "active"),
    ("Nəriman Nərimanov metrosu sığınacağı", "shelter", 40.4030, 49.8720, 1200, 300, "active"),
    ("Heydər Əliyev Mərkəzi parkı", "park", 40.3960, 49.8680, 8000, 2500, "active"),
    ("Xətai parkı (Ağ şəhər bulvarı)", "park", 40.3800, 49.8900, 7000, 1400, "active"),
    ("Xətai metrosu sığınacağı", "shelter", 40.3830, 49.8720, 1500, 1250, "active"),
    ("Yasamal parkı", "park", 40.3870, 49.8000, 5000, 1000, "active"),
    ("İnşaatçılar metrosu sığınacağı", "shelter", 40.3910, 49.8030, 1000, 450, "active"),
    ("Elmlər Akademiyası metrosu sığınacağı", "shelter", 40.3750, 49.8140, 1200, 600, "active"),
    ("Mərkəzi Nəbatat bağı", "park", 40.3700, 49.7900, 4500, 500, "active"),
    ("Nizami parkı", "park", 40.4080, 49.9450, 3500, 900, "active"),
    ("Qara Qarayev metrosu sığınacağı", "shelter", 40.4170, 49.9340, 1500, 400, "active"),
    ("Binəqədi parkı", "park", 40.4600, 49.8250, 4000, 1300, "active"),
    ("Azadlıq prospekti metrosu sığınacağı", "shelter", 40.4300, 49.8400, 1200, 350, "active"),
    ("Bakı Olimpiya Stadionu", "stadium", 40.4300, 49.9197, 20000, 2000, "active"),
    ("Bakıxanov parkı", "park", 40.4500, 49.9600, 3000, 700, "active"),
    ("Qaraçuxur parkı", "park", 40.3950, 49.9950, 3000, 1600, "active"),
    ("Mərdəkan parkı", "park", 40.4920, 50.1450, 4000, 800, "active"),
    ("Lökbatan parkı", "park", 40.3250, 49.7300, 2500, 500, "active"),
    # --- reserve points (activated by the crisis engine) ---
    ("Yasamal idman kompleksi", "stadium", 40.3980, 49.7880, 4000, 0, "reserve"),
    ("Nizami kinoteatrı sığınacağı", "shelter", 40.3830, 49.8300, 1500, 0, "reserve"),
    ("Bayıl parkı", "park", 40.3450, 49.8350, 5000, 0, "reserve"),
    ("Nərimanov idman sarayı", "stadium", 40.4150, 49.8850, 6000, 0, "reserve"),
    ("Xətai Olimpiya mərkəzi", "stadium", 40.3880, 49.9100, 7000, 0, "reserve"),
    ("Binəqədi ehtiyat sığınacağı", "shelter", 40.4400, 49.8500, 2000, 0, "reserve"),
]

# Points without a step-free entrance (metro shelters: stairs/escalators; basement cinema shelter).
# Persons with reduced mobility are never routed to these.
NOT_WHEELCHAIR_ACCESSIBLE: set[str] = {
    "28 May metrosu sığınacağı", "Gənclik metrosu sığınacağı", "Nəriman Nərimanov metrosu sığınacağı",
    "Xətai metrosu sığınacağı", "İnşaatçılar metrosu sığınacağı", "Elmlər Akademiyası metrosu sığınacağı",
    "Qara Qarayev metrosu sığınacağı", "Azadlıq prospekti metrosu sığınacağı", "Nizami kinoteatrı sığınacağı",
}

# Share of street links (both directions) that get a barrier in the synthetic graph:
# Baku has many pedestrian underpasses with stairs and steep streets (e.g. around İçərişəhər/Dağüstü).
SYNTHETIC_BARRIERS: list[tuple[str, float]] = [("stairs", 0.05), ("underpass", 0.03), ("steep", 0.03)]

# (name, type, lat, lng)
BRIGADES: list[tuple] = [
    ("Yanğın-1 (Nəsimi)", "fire", 40.3850, 49.8350),
    ("Yanğın-2 (Xətai)", "fire", 40.3850, 49.9000),
    ("Yanğın-3 (Binəqədi)", "fire", 40.4500, 49.8200),
    ("Təcili Yardım-1 (Yasamal)", "medical", 40.3900, 49.7950),
    ("Təcili Yardım-2 (Səbail)", "medical", 40.3600, 49.8400),
    ("Təcili Yardım-3 (Nərimanov)", "medical", 40.4100, 49.8700),
    ("Təcili Yardım-4 (Sabunçu)", "medical", 40.4600, 49.9500),
    ("Xilasetmə-1 (Nizami)", "rescue", 40.4100, 49.9400),
    ("Xilasetmə-2 (Suraxanı)", "rescue", 40.4000, 50.0200),
    ("Xilasetmə-3 (Yasamal)", "rescue", 40.4050, 49.8050),
]

# (username, password, role) - demo accounts; change passwords before any shared deployment
DISPATCHERS: list[tuple[str, str, str]] = [
    ("admin", "admin123", "admin"),
    ("dispatcher", "dispatcher123", "dispatcher"),
    ("operator", "operator123", "operator"),
]
