import type { TileFace } from '../game-engine/tiles/tiles';
import { faceIndex } from '../game-engine/tiles/tiles';
export { countsFromFaces } from '../game-engine/traditional/hand';
export type { TileFace };
export const faceIndexFor = (f: TileFace) => faceIndex(f);
