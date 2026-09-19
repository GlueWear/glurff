::  glurff: a shared pixel world, with Noltbook underneath it.
::
::  This agent owns the WORLD and the BODIES: where people are standing, what
::  they look like, and which room hosts which call. It owns no words at all --
::  chat, DMs, pals and call infrastructure are Noltbook's, and %glurff never
::  stores a message or keeps a contact list.
::
::  PRESENCE IS STATELESS. An incoming claim is handed straight to our own
::  client as a fact and forgotten. A position that outlived the ship that
::  claimed it would be a lie, and the client ages entries out on its own.
::
::  ON `peers`: COOPERATIVE, NOT ENFORCED. The peer set is asserted by OUR OWN
::  client, taken from Noltbook's pal list at the current dial. We cannot verify
::  the pal graph without reaching into %noltbook, and a ship that IS visible can
::  claim any position it likes. Hygiene, not access control.
|%
::  ---------------------------------------------------------- the commons
::
::  ONE id, hardcoded, identical on every install.
::
::  Noltbook mints gossip ids from `now`, so a note created independently on
::  each ship is a private island: gossip propagates BY id and two notes sharing
::  a name never merge. But %remote-gossip-invite installs a gossip note with
::  the id it is GIVEN, and takes a local poke like any other agent-to-agent
::  one. So we hand Noltbook the packet ourselves and every install materialises
::  the same commons -- no seed ship, no link to share, nothing provisional.
::
::  Fresh note for the tightly framed icon. Existing v1/v2 histories are kept;
::  gossip metadata is immutable in Noltbook, so this is a new local install.
::  Never reinstall an existing note: Noltbook's invite receiver clears messages.
++  commons-note-id  `@ta`'glurff-commons-v3'
::  Each ship supplies our.bowl as creator for its own copy. Gossip delivery
::  is hostless, but Noltbook's active-status API requires a local creator.
++  commons-name     'Glurff'
++  commons-headline  'the glurff commons'
::  Noltbook's single anonymous system note, used as the Rumors room's chat.
++  rumors-note-id  `@ta`'ars-rumors'
::  ------------------------------------------------------- the rooms' chat
::
::  Every room has a note of its own, installed exactly like the commons and
::  for exactly the same reason: an id minted from `now` is a private island on
::  each ship, and two notes sharing a name never merge.
::
::  Room chat used to live only in the browser tab that typed it. That is why a
::  room looked like it worked -- you saw your own lines -- while nobody else in
::  the room saw anything, and why replies had nothing to hang off.
::
::  Rumors is absent on purpose: it uses Noltbook's own anonymous system note.
::
::  CHANGING AN ID HERE ABANDONS THAT ROOM'S HISTORY.
++  room-notes
  ^-  (map @ud [id=@ta name=@t headline=@t])
  %-  malt
  ^-  (list [@ud [id=@ta name=@t headline=@t]])
  ::  The ids are the rooms of the painted map; see ui/src/world/map-data.js,
  ::  and lib/noltbook.js, which MUST agree with this table.
  :~  [1 ['glurff-room-bar' 'Bar' 'the glurff bar']]
      [2 ['glurff-room-auditorium' 'Amphitheatre' 'the glurff amphitheatre']]
      [3 ['glurff-room-movie' 'Movie Theater' 'the glurff movie theater']]
      [4 ['glurff-room-office-1' 'Office 1' 'glurff office 1']]
      [5 ['glurff-room-office-2' 'Office 2' 'glurff office 2']]
      [6 ['glurff-room-office-3' 'Office 3' 'glurff office 3']]
      [7 ['glurff-room-office-4' 'Office 4' 'glurff office 4']]
      [8 ['glurff-room-office-5' 'Office 5' 'glurff office 5']]
      [9 ['glurff-room-office-6' 'Office 6' 'glurff office 6']]
      [10 ['glurff-room-office-7' 'Office 7' 'glurff office 7']]
      [11 ['glurff-room-office-8' 'Office 8' 'glurff office 8']]
      [12 ['glurff-room-board' 'Board Room' 'the glurff board room']]
      [14 ['glurff-room-library' 'Library' 'the glurff library']]
      [15 ['glurff-room-game' 'Game Room' 'the glurff game room']]
  ==
::  How many rooms the painted map has, and which of them is Rumors.
++  last-room  `@ud`15
++  rumors-room  `@ud`13
::  The note for a place, the commons included. `~` means "none of ours": the
::  Rumors room, and anywhere that is not a room.
++  note-for
  |=  p=@ud
  ^-  (unit [id=@ta name=@t headline=@t])
  ?:  =(0 p)  `[commons-note-id commons-name commons-headline]
  (~(get by room-notes) p)
::
::  ------------------------------------------------------------- the world
::
::  place: where in the world someone is. NUMERIC, always.
::
::  The JSON mark parses this as a @ud, so a string here goes out on the wire as
::  0 and then never matches the local value -- everyone becomes invisible to
::  everyone else while looking perfectly fine on their own screen.
+$  place  @ud
++  commons-place  `place`0
::  dir: the renderer's vocabulary, not the compass. Turf's sprites are drawn
::  down/right/up/left and a mismatch yields an undefined sprite key, which
::  Phaser and Pixi both render as nothing -- a name gliding around with nobody
::  under it.
+$  dir  ?(%down %right %up %left)
::  spot: position within a place. x/y are scaled by 16 for sub-tile precision
::  on the wire (x=64 means 4.0 tiles) without floats.
+$  spot
  $:  =place
      x=@ud
      y=@ud
      =dir
  ==
::
::  ------------------------------------------------------------- the bodies
::
::  look: a character, as a SPEC rather than an image. Small enough to travel
::  with presence, and re-renderable at any zoom. Slot -> part id plus an
::  optional tint; Pixi multiplies the tint through the greyscale sprite, which
::  is what turns a small part set into a wide one.
::  The slots of the layered character art: a body, what it wears, and what is
::  on its head. Parts are ids into that art, never images.
+$  slot  ?(%body %bottom %shoes %top %gloves %shoulders %beard %hair %hat)
+$  piece  [part=@ta tint=(unit @ux)]
+$  look   (map slot piece)
::  Bumped on every change. Peers refetch when the number moves, the way a
::  profile picture updates -- the look itself does not ride on every beat.
+$  look-rev  @ud
::
::  ------------------------------------------------------------ movement
::
::  A movement session's Galene room is the place movement-base + term, on the
::  broker of whichever ship hosts that term. Clear of rooms (1-7) and of
::  proximity huddles (1.000-900.999), so a movement grant is never mistaken
::  for a call grant. Mirrored in lib/movement-session.js; the two MUST agree.
::
::  A knock on such a place, held %open, admits the knocker AND extends the
::  room's lease -- see %knock in app/glurff.
++  movement-base  950.000
::  Fifteen minutes, renewed by active participants. Long enough that a busy
::  host ship does not end a session people are still using; an abandoned
::  room is gone soon after renewals stop. Mirrored in lib/movement.js.
++  movement-ttl  900
::
::  -------------------------------------------------------------- presence
::
::  `peers` sits at the SAME AXIS in every variant so a receiver can read it
::  without branching. That needs matching position AND matching arity: a
::  two-tuple puts the field at axis 3 because it IS the tail, while a
::  three-tuple puts it at axis 6. The `~` padding is what aligns them, not a
::  spare field. Get it wrong and a wing through the union fails to resolve at
::  all -- a compile error, not a subtle bug.
+$  action
  $%  ::  we moved. The client throttles; the agent does not.
      [%move peers=(list @p) =spot rev=look-rev host=(unit @p)]
      [%leave peers=(list @p) ~]
      ::  our own look changed; store it and bump the revision.
      [%dress peers=(list @p) =look]
      ::  someone we can see is wearing a look we have not got.
      [%fetch-look peers=(list @p) who=@p]
      ::  claim / release / hand off a room, and set its lock.
      [%claim peers=(list @p) =place]
      [%release peers=(list @p) =place]
      [%lock peers=(list @p) =place mode=lock-mode]
      ::  ask a host -- who need not be a pal -- to let us into their room.
      [%knock peers=(list @p) host=@p =place]
      ::  materialise the commons note. See commons-note-id above.
      [%ensure-commons peers=(list @p) ~]
      ::  transient world events: a water gun hit, a dice roll.
      [%splash peers=(list @p) target=@p]
      [%roll peers=(list @p) =place stage=roll-stage]
      [%room-event peers=(list @p) =place body=@t]
      [%presence-event peers=(list @p) body=@t]
  ==
::  How a host answers a knock. No Noltbook admin controls exist yet, so a host
::  confers only "the ship that mints tokens" -- no kick, no mute.
+$  lock-mode  ?(%open %pals %ask %locked)
::  Cee-lo without a server. Each client publishes a hash, then the secret; the
::  seed is every secret combined, so no player can bias the result unless all
::  of them collude, and a lie is caught because the reveal must match.
+$  roll-stage
  $%  [%commit hash=@uv]
      [%reveal secret=@uv]
  ==
::
::  agent -> agent, over Ames. Noun-only mark; unreachable from a browser.
+$  remote
  $%  [%here =spot rev=look-rev host=(unit @p)]
      [%gone ~]
      ::  a look, sent on request rather than on every beat.
      [%wearing =look rev=look-rev]
      [%ask-look ~]
      ::  hosting claims travel so a door can show who is holding a room.
      [%hosting =place mode=lock-mode]
      [%unhosting =place]
      ::  knock, and the host's answer. A refusal is a value, never silence.
      [%knock =place]
      [%refused =place why=@tas]
      ::  transient world events
      [%splashed ~]
      [%rolled =place stage=roll-stage]
      [%room-event =place body=@t]
      [%presence-event body=@t]
  ==
::
::  agent -> our own client, as facts on /world.
+$  update
  $%  [%peer-here who=@p =spot rev=look-rev host=(unit @p)]
      [%peer-gone who=@p]
      [%peer-look who=@p =look rev=look-rev]
      [%our-look =look rev=look-rev]
      [%peer-hosting who=@p =place mode=lock-mode]
      [%peer-unhosting who=@p =place]
      [%knocked who=@p =place]
      [%refused host=@p =place why=@tas]
      [%splashed who=@p]
      [%rolled who=@p =place stage=roll-stage]
      [%room-event who=@p =place body=@t]
      [%presence-event who=@p body=@t]
  ==
--
