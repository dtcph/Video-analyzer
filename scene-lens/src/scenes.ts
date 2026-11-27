/** Rough, hand-written "typical" object counts per scene. Heuristics, not measured statistics. */
export interface Scene { id: string; name: string; hint: string; typical: Record<string, number> }

export const SCENES: Scene[] = [
  { id: "office", name: "Office", hint: "Personen, Computer und Officematerial",
    typical: { person: 5, laptop: 4, keyboard: 4, mouse: 4, tv: 2, chair: 7, cup: 4, "cell phone": 3, book: 3, bottle: 2, "potted plant": 1 } },
  { id: "classroom", name: "Classroom", hint: "Many people and chairs, books, backpacks",
    typical: { person: 22, chair: 24, book: 10, backpack: 8, laptop: 4, "cell phone": 4, bottle: 4, clock: 1 } },
  { id: "street", name: "Public street", hint: "Cars, pedestrians, traffic signs",
    typical: { car: 9, person: 4, "traffic light": 2, "stop sign": 1, bicycle: 1, bus: 1, truck: 1, motorcycle: 1, "fire hydrant": 0.5 } },
  { id: "highway", name: "Highway / intersection", hint: "Lots of cars and trucks, hardly any people",
    typical: { car: 18, truck: 5, bus: 1, motorcycle: 1, person: 0.3 } },
  { id: "kitchen", name: "Kitchen", hint: "Tableware, bottles and appliances",
    typical: { cup: 4, bowl: 3, bottle: 4, refrigerator: 1, oven: 1, sink: 1, microwave: 1, knife: 2, fork: 2, spoon: 2, person: 1, "dining table": 1 } },
  { id: "living", name: "Living room", hint: "Sofa, TV, plants",
    typical: { couch: 1.5, tv: 1, chair: 3, "potted plant": 2, remote: 1, book: 4, vase: 1, person: 2, clock: 1 } },
  { id: "restaurant", name: "Restaurant / café", hint: "Tables, chairs, guests, glasses",
    typical: { person: 10, "dining table": 5, chair: 14, cup: 8, "wine glass": 6, bowl: 3, bottle: 5, fork: 6, knife: 6, "cell phone": 3 } },
  { id: "park", name: "Park / outdoors", hint: "People, benches, animals, bikes",
    typical: { person: 6, bench: 3, dog: 2, bicycle: 2, bird: 3, umbrella: 1, backpack: 2, kite: 0.5 } },
];

export interface Match { scene: Scene; score: number }

/** Cosine similarity on sqrt-scaled counts; returns scenes best first. */
export function rank(counts: Map<string, number>): Match[] {
  const v = (n: number): number => Math.sqrt(n);
  const norm = (m: Iterable<number>): number => Math.sqrt([...m].reduce((s, x) => s + v(x) ** 2, 0));
  const cn = norm(counts.values());
  if (!cn) return [];
  return SCENES.map((scene) => {
    let dot = 0;
    for (const [k, c] of counts) dot += v(c) * v(scene.typical[k] ?? 0);
    return { scene, score: dot / (cn * norm(Object.values(scene.typical))) };
  }).sort((a, b) => b.score - a.score);
}
