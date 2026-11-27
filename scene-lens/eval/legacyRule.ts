/** The blendshape rule of the app before Phase 3 (src/faces.ts @ 706e837), kept unchanged for comparisons. */
export type Emotion = "happy" | "neutral" | "surprised" | "sad" | "angry" | "thoughtful";

type Shapes = Record<string, number>;
const avg = (s: Shapes, a: string, b: string): number => ((s[a] ?? 0) + (s[b] ?? 0)) / 2;

/** Rule-based mapping, thresholds are hand-tuned estimates (not a trained emotion model). */
export function classify(s: Shapes): Emotion {
  const smile = avg(s, "mouthSmileLeft", "mouthSmileRight");
  const frown = avg(s, "mouthFrownLeft", "mouthFrownRight");
  const browDown = avg(s, "browDownLeft", "browDownRight");
  const browUp = Math.max(s.browInnerUp ?? 0, avg(s, "browOuterUpLeft", "browOuterUpRight"));
  const jaw = s.jawOpen ?? 0, wide = avg(s, "eyeWideLeft", "eyeWideRight");
  const press = avg(s, "mouthPressLeft", "mouthPressRight");
  const lookDown = avg(s, "eyeLookDownLeft", "eyeLookDownRight");
  const lookSide = Math.max(avg(s, "eyeLookOutLeft", "eyeLookInRight"), avg(s, "eyeLookInLeft", "eyeLookOutRight"));
  const pucker = Math.max(s.mouthPucker ?? 0, s.mouthShrugLower ?? 0, s.mouthRollLower ?? 0);
  if (smile > 0.45) return "happy";
  if ((jaw > 0.3 && (wide > 0.25 || browUp > 0.4)) || (browUp > 0.6 && wide > 0.3)) return "surprised";
  if (browDown > 0.45 && (frown > 0.1 || press > 0.2)) return "angry";
  if (frown > 0.25 || (s.browInnerUp ?? 0) > 0.45) return "sad";
  if (smile < 0.15 && (lookDown > 0.35 || lookSide > 0.4 || (browDown > 0.25 && (press > 0.1 || pucker > 0.2)) || pucker > 0.35)) return "thoughtful";
  return "neutral";
}

