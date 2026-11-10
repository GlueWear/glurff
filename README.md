# Glurff

A shared pixel world on Urbit.

Walk around as a character you build. People standing near you can hear and see
you, and walking through a doorway into one of the rooms joins that room's call.
Chat, direct messages, pals and the call service all come from
[Noltbook](https://github.com/GlueWear/noltbook), which Glurff runs on top of.

Anybody can build a Glurff of their own and publish it for people to visit.
The official one is published by `~nolset`.

## Building your own Glurff

**EDIT GLURFF** on your own profile card opens the map editor:
- maps from a picture of your own, or in space;
- walls, foreground, areas with their own chat and calls;
- doors between maps and to other Glurffs;
- pictures, signs, characters, collectibles and drawing.

Until you first publish, your Glurff is only a draft on your ship: nothing of it
is anywhere else. The first **Publish** makes its Noltbook note, whose members
are its members, and lists it with `~nolset` so people can find it. Visitors
fetch its map from your ship through their own. Your ship is its host: when
your ship is down, your Glurff is offline.

## Requirements

- An Urbit ship with **Noltbook** installed. Glurff uses its notes, pals, DMs
  and managed calls.

## What's in this repository

| Path | Contents |
|---|---|
| repository root | The `%glurff` desk: `app/`, `sur/`, `lib/`, `mar/`, `desk.bill`, `desk.docket-0`, `sys.kelvin`. The built frontend is included in `lib/glurff/site/` — **apart from its artwork**, see below. |
| `ui/` | Frontend source (Vite and Pixi). You only need this to change the frontend. |

### The artwork is not in this repository

Glurff's characters are drawn from **Minifantasy** by **Krishna Palacio**, whose
licence permits using the art in a game but **not redistributing it**. A public
repository is redistribution, so they are left out of it deliberately:

```
lib/glurff/site/characters/   the packed character atlases the game loads
ui/public/characters/         where the build writes those atlases
```

**A checkout of this repository therefore runs without characters.** Everything
else works; people are invisible. To build a complete copy you need your own
licensed copy of the art: buy the [Minifantasy](https://krishna-palacio.itch.io/)
packs Glurff uses, put the character sheets where `ui/tools/build_characters.py`
expects them, and run it. It packs them into `ui/public/characters/` and writes
`ui/src/world/character-data.js`.

The app carries no map. Every Glurff's map, the official one's included, is
published by its host from the editor.

## Installing from this repository

In your ship's dojo:

```
|new-desk %glurff
|mount %glurff
```

Copy everything from this repository into the mounted `glurff` folder **except**
`ui/`, `README.md`, `LICENSE` and `.gitignore`. Add your own built
`lib/glurff/site/characters/` (see above). Without it, characters have no art.
Then:

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
  Glurff's characters are built from it under its licence, which allows
  use but not redistribution — so the art is **not** in this repository and is
  not covered by Glurff's MIT licence. See "The artwork is not in this
  repository" above. If you run Glurff, credit Krishna Palacio.
- Portions derived from Turf are MIT-licensed; see
  [LICENSE-turf.txt](LICENSE-turf.txt).
- Licenses for the bundled noise suppression and Jitsi components are in
  [`ui/public/licenses/`](ui/public/licenses).
