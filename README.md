# Glurff

A shared pixel world on Urbit.

Walk around as a character you build. People standing near you can hear and see
you, and walking through a doorway into one of the rooms joins that room's call.
Chat, direct messages, pals and the call service all come from
[Noltbook](https://github.com/GlueWear/noltbook), which Glurff runs on top of.

## Requirements

- An Urbit ship with **Noltbook** installed. Glurff uses its notes, pals, DMs
  and managed calls.

## What's in this repository

| Path | Contents |
|---|---|
| repository root | The `%glurff` desk: `app/`, `sur/`, `lib/`, `mar/`, `desk.bill`, `desk.docket-0`, `sys.kelvin`. The built frontend is included in `lib/glurff/site/` — **apart from its artwork**, see below. |
| `ui/` | Frontend source (Vite and Pixi). You only need this to change the frontend. |

### The artwork is not in this repository

Glurff's characters and its map are drawn from **Minifantasy** by **Krishna
Palacio**, whose licence permits using the art in a game but **not
redistributing it**. A public repository is redistribution, so these are left
out of it deliberately:

```
lib/glurff/site/characters/   the packed character atlases the game loads
lib/glurff/site/map/          the painted world and its over-layer
ui/public/characters/         where the build writes those atlases
ui/public/map/
ui/map/                       the drawn layers the map is built from
```

**A checkout of this repository therefore runs without characters or a map.**
Everything else works; people are invisible and the world is blank. To build a
complete copy you need your own licensed copy of the art:

1. buy the [Minifantasy](https://krishna-palacio.itch.io/) packs Glurff uses;
2. put the character sheets where `ui/tools/build_characters.py` expects them
   and run it — it packs them into `ui/public/characters/` and writes
   `ui/src/world/character-data.js`;
3. put your map's four layers in `ui/map/source/` and run
   `ui/tools/build_map.py` — it writes `ui/public/map/` and
   `ui/src/world/map-data.js`.

Both tools are here, and both are the whole recipe: nothing about the world is
written down twice.

## Installing from this repository

In your ship's dojo:

```
|new-desk %glurff
|mount %glurff
```

Copy everything from this repository into the mounted `glurff` folder **except**
`ui/`, `README.md`, `LICENSE` and `.gitignore`. Add your own built
`lib/glurff/site/characters/` and `lib/glurff/site/map/` (see above) — without
them the world has no art. Then:

```
|commit %glurff
|install our %glurff
```

## Building the frontend

```
cd ui
npm install
npm run build
python3 tools/package_frontend.py --desk ..
```

`npm run build` builds into `ui/dist/`. The packaging step copies that build into
the desk at `lib/glurff/site/` and rewrites the asset manifest,
`lib/glurff-assets.hoon`. Copy the desk to your ship and commit again to use it.

## Licenses

Glurff is released under the MIT License. See [LICENSE](LICENSE).

- **Art: Minifantasy by [Krishna Palacio](https://krishna-palacio.itch.io/).**
  Glurff's characters and map are built from it under its licence, which allows
  use but not redistribution — so the art is **not** in this repository and is
  not covered by Glurff's MIT licence. See "The artwork is not in this
  repository" above. If you run Glurff, credit Krishna Palacio.
- Portions derived from Turf are MIT-licensed; see
  [LICENSE-turf.txt](LICENSE-turf.txt).
- Licenses for the bundled noise suppression and Jitsi components are in
  [`ui/public/licenses/`](ui/public/licenses).
