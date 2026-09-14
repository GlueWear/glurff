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
| repository root | The `%glurff` desk: `app/`, `sur/`, `lib/`, `mar/`, `desk.bill`, `desk.docket-0`, `sys.kelvin`. The built frontend is already included in `lib/glurff/site/`. |
| `ui/` | Frontend source (Vite and Pixi). You only need this to change the frontend. |

## Installing from this repository

In your ship's dojo:

```
|new-desk %glurff
|mount %glurff
```

Copy everything from this repository into the mounted `glurff` folder **except**
`ui/`, `README.md`, `LICENSE` and `.gitignore`. Then:

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

- Portions derived from Turf are MIT-licensed; see
  [LICENSE-turf.txt](LICENSE-turf.txt).
- Licenses for the bundled noise suppression and Jitsi components are in
  [`ui/public/licenses/`](ui/public/licenses).
