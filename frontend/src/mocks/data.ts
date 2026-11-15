import type { Polygon, Position } from 'geojson';
import type { AssemblyPoint, Brigade, PointType, RoadFeature, RoadStatus, Zone } from '@/types/api';

/** Approximate district rectangles for central Baku (demo data, not official borders). */
const rect = (minLng: number, minLat: number, maxLng: number, maxLat: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ],
  ],
});

export const ZONES: Zone[] = [
  { id: 1, name: 'Səbail', geometry: rect(49.79, 40.355, 49.875, 40.385) },
  { id: 2, name: 'Xətai', geometry: rect(49.875, 40.355, 49.97, 40.385) },
  { id: 3, name: 'Yasamal', geometry: rect(49.79, 40.385, 49.835, 40.415) },
  { id: 4, name: 'Nəsimi', geometry: rect(49.835, 40.385, 49.875, 40.415) },
  { id: 5, name: 'Nərimanov', geometry: rect(49.875, 40.385, 49.92, 40.415) },
  { id: 6, name: 'Nizami', geometry: rect(49.92, 40.385, 49.97, 40.415) },
  { id: 7, name: 'Binəqədi', geometry: rect(49.79, 40.415, 49.875, 40.45) },
  { id: 8, name: 'Sabunçu', geometry: rect(49.875, 40.415, 49.97, 40.45) },
].map((z) => {
  const ring = (z.geometry as Polygon).coordinates[0];
  return {
    ...z,
    center: { lng: (ring[0][0] + ring[2][0]) / 2, lat: (ring[0][1] + ring[2][1]) / 2 },
  };
});

type PointSeed = [string, PointType, number, number, number, number, number, 'active' | 'reserve'];
// name, type, lat, lng, zone, capacity, initial occupancy %, status
const POINT_SEEDS: PointSeed[] = [
  ['Tofiq Bəhramov Respublika Stadionu', 'stadium', 40.3963, 49.8607, 4, 25000, 41, 'active'],
  ['Bakı Olimpiya Stadionu', 'stadium', 40.43, 49.9197, 8, 30000, 22, 'active'],
  ['Dənizkənarı Milli Park', 'park', 40.3672, 49.844, 1, 8000, 63, 'active'],
  ['Dağüstü Park', 'park', 40.358, 49.827, 1, 3500, 78, 'active'],
  ['Heydər Əliyev Mərkəzi parkı', 'park', 40.3959, 49.8678, 4, 6000, 55, 'active'],
  ['Nərimanov parkı', 'park', 40.4045, 49.8755, 5, 4000, 86, 'active'],
  ['Səməd Vurğun parkı', 'park', 40.3775, 49.846, 1, 2500, 93, 'active'],
  ['Atatürk parkı', 'park', 40.4, 49.865, 4, 2200, 47, 'active'],
  ['Yasamal sığınacağı №3', 'shelter', 40.395, 49.815, 3, 900, 68, 'active'],
  ['Gənclik metrosu sığınacağı', 'shelter', 40.4005, 49.851, 4, 1500, 72, 'active'],
  ['28 May metrosu sığınacağı', 'shelter', 40.38, 49.849, 1, 1800, 58, 'active'],
  ['Koroğlu sığınacağı', 'shelter', 40.421, 49.918, 8, 1200, 34, 'active'],
  ['Xətai sığınacağı №1', 'shelter', 40.383, 49.893, 2, 1000, 81, 'active'],
  ['Ağ Şəhər parkı', 'park', 40.377, 49.883, 2, 5000, 29, 'active'],
  ['Binəqədi parkı', 'park', 40.435, 49.82, 7, 3000, 38, 'active'],
  ['Binəqədi sığınacağı №2', 'shelter', 40.428, 49.85, 7, 800, 44, 'active'],
  ['Nizami sığınacağı №4', 'shelter', 40.4, 49.945, 6, 1100, 61, 'active'],
  ['8 Noyabr parkı', 'park', 40.395, 49.93, 6, 3500, 52, 'active'],
  ['Sabunçu stadionu', 'stadium', 40.44, 49.95, 8, 7000, 0, 'reserve'],
  ['Yasamal parkı', 'park', 40.392, 49.8, 3, 2500, 0, 'reserve'],
  ['Nərimanov sığınacağı №5', 'shelter', 40.41, 49.89, 5, 1400, 0, 'reserve'],
  ['Fəvvarələr meydanı', 'park', 40.3705, 49.8365, 1, 2000, 0, 'reserve'],
];

export const POINTS: AssemblyPoint[] = POINT_SEEDS.map(
  ([name, type, lat, lng, zone_id, capacity, pct, status], i) => ({
    id: 100 + i,
    name,
    type,
    lat,
    lng,
    zone_id,
    capacity,
    current_count: Math.round((capacity * pct) / 100),
    occupancy_pct: pct,
    status,
    // Demo assumption: metro shelters have stairs; parks and stadiums are step-free.
    wheelchair_accessible: type !== 'shelter',
  }),
);

type RoadSeed = [string, Position[], RoadStatus[]?];
const ROAD_SEEDS: RoadSeed[] = [
  [
    'Neftçilər prospekti',
    [
      [49.833, 40.364],
      [49.842, 40.366],
      [49.852, 40.369],
      [49.862, 40.372],
      [49.872, 40.374],
      [49.882, 40.377],
    ],
    ['open', 'congested', 'open', 'open', 'open'],
  ],
  [
    'Azadlıq prospekti',
    [
      [49.856, 40.38],
      [49.851, 40.39],
      [49.845, 40.4],
      [49.838, 40.41],
      [49.83, 40.42],
    ],
  ],
  [
    'Heydər Əliyev prospekti',
    [
      [49.87, 40.399],
      [49.885, 40.404],
      [49.9, 40.409],
      [49.915, 40.415],
      [49.93, 40.422],
      [49.945, 40.429],
    ],
    ['open', 'congested', 'congested', 'open', 'open'],
  ],
  [
    'Tbilisi prospekti',
    [
      [49.846, 40.388],
      [49.835, 40.393],
      [49.823, 40.398],
      [49.812, 40.403],
    ],
  ],
  [
    'Bakıxanov küçəsi',
    [
      [49.84, 40.379],
      [49.83, 40.383],
      [49.82, 40.386],
      [49.81, 40.389],
    ],
  ],
  [
    'Atatürk prospekti',
    [
      [49.862, 40.399],
      [49.864, 40.406],
      [49.866, 40.414],
      [49.87, 40.422],
    ],
  ],
  [
    'Babək prospekti',
    [
      [49.87, 40.389],
      [49.883, 40.392],
      [49.896, 40.395],
      [49.91, 40.399],
    ],
    ['open', 'open', 'congested'],
  ],
  [
    'Zərifə Əliyeva küçəsi',
    [
      [49.85, 40.372],
      [49.856, 40.378],
      [49.863, 40.385],
      [49.87, 40.392],
    ],
  ],
  [
    'Nobel prospekti',
    [
      [49.876, 40.374],
      [49.889, 40.376],
      [49.902, 40.379],
      [49.915, 40.382],
    ],
  ],
  [
    'Ziya Bünyadov prospekti',
    [
      [49.885, 40.42],
      [49.895, 40.426],
      [49.908, 40.432],
      [49.92, 40.438],
    ],
  ],
  [
    'Moskva prospekti',
    [
      [49.84, 40.405],
      [49.85, 40.41],
      [49.86, 40.412],
      [49.87, 40.413],
    ],
  ],
  [
    'Hüseyn Cavid prospekti',
    [
      [49.82, 40.373],
      [49.815, 40.38],
      [49.809, 40.387],
      [49.803, 40.394],
    ],
  ],
  [
    'Binəqədi şossesi',
    [
      [49.83, 40.42],
      [49.825, 40.43],
      [49.82, 40.44],
      [49.815, 40.448],
    ],
  ],
  [
    'Füzuli küçəsi',
    [
      [49.846, 40.374],
      [49.855, 40.376],
      [49.862, 40.379],
      [49.868, 40.382],
    ],
  ],
  [
    'Sabunçu yolu',
    [
      [49.92, 40.415],
      [49.933, 40.43],
      [49.945, 40.44],
      [49.955, 40.448],
    ],
  ],
  [
    '8 Noyabr prospekti',
    [
      [49.87, 40.374],
      [49.88, 40.382],
      [49.89, 40.388],
      [49.9, 40.394],
    ],
  ],
];

export const ROADS: RoadFeature[] = ROAD_SEEDS.flatMap(([name, coords, statuses], r) =>
  coords.slice(1).map((c, i) => ({
    type: 'Feature' as const,
    id: (r + 1) * 100 + i,
    properties: { id: (r + 1) * 100 + i, name, status: statuses?.[i] ?? 'open' },
    geometry: { type: 'LineString' as const, coordinates: [coords[i], c] },
  })),
);

type BrigadeSeed = [string, Brigade['type'], number, number];
const BRIGADE_SEEDS: BrigadeSeed[] = [
  ['Yanğın-1 Səbail', 'fire', 40.371, 49.838],
  ['Yanğın-2 Nərimanov', 'fire', 40.407, 49.882],
  ['Yanğın-3 Binəqədi', 'fire', 40.432, 49.833],
  ['Yanğın-4 Xətai', 'fire', 40.38, 49.905],
  ['Təcili-1 Nəsimi', 'medical', 40.392, 49.85],
  ['Təcili-2 Yasamal', 'medical', 40.4, 49.82],
  ['Təcili-3 Nizami', 'medical', 40.402, 49.935],
  ['Təcili-4 Sabunçu', 'medical', 40.437, 49.94],
  ['Xilasetmə-1 Mərkəz', 'rescue', 40.386, 49.862],
  ['Xilasetmə-2 Şimal', 'rescue', 40.425, 49.9],
  ['Xilasetmə-3 Qərb', 'rescue', 40.41, 49.805],
  ['Xilasetmə-4 Şərq', 'rescue', 40.39, 49.955],
];

export const BRIGADES: Brigade[] = BRIGADE_SEEDS.map(([name, type, lat, lng], i) => ({
  id: 500 + i,
  name,
  type,
  lat,
  lng,
  status: 'idle',
  target_sos_id: null,
  route_geometry: null,
}));

export const SOS_NOTES = [
  'Binanın 3-cü mərtəbəsində tüstü var',
  'Yaşlı qonşu çıxa bilmir',
  'Uşaq yaralanıb',
  'Zirzəmini su basıb',
  'Divar çöküb, insanlar altında qalıb',
  'Nəfəs almaqda çətinlik',
  null,
  null,
  null,
];
