# Portrait images

## Current setup
- `ali-source.jpg`: original photo of Ali Mehdi Hemani (untouched).
- `ali-mask.png`: cut-out mask of Ali made with person segmentation. Only the masked area becomes particles,
  so the background and the other people in the photo are ignored.
- `rahil-source.webp` / `rahil-mask.png`: same for Rahil Manji.
- `founders-source.jpg` / `founders-mask.png`: both founders together — used for the hero.

These are wired up in `js/main.js` under `PEOPLE` (`src`, `mask`, `crop` = `[x, y, w, h]` in the photo,
and `tone` = a brightness/contrast filter so faces read as clearly as bright jackets).
The hero uses the duo photo (`PEOPLE.duo`); each founder card uses his individual photo.
If the duo photo is missing, the hero falls back to combining the two individual photos.

## Simpler alternative (no mask needed)
Drop a background-removed PNG here and it takes priority automatically:

| File | Used in |
|------|---------|
| `hero.png` / `.webp` / `.jpg` | Hero particle portrait |
| `rahil.png` / `.webp` / `.jpg` | Founders section: Rahil Manji |
| `ali.png` / `.webp` / `.jpg` | Founders section: Ali Mehdi Hemani |

Use cut-outs or photos on a dark background: the particle engine turns brightness into dots,
so a bright background becomes a wall of particles.
