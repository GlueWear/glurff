::  glurff-update: agent -> our own client, on /world.
/-  g=glurff
|_  upd=update:g
++  grow
  |%
  ++  noun  upd
  ++  json
    ^-  ^json
    =,  enjs:format
    =/  dir-s  |=(d=dir:g `^json`s+(crip (trip (scot %tas d))))
    =/  spot-j
      |=  s=spot:g
      ^-  ^json
      %-  pairs
      :~  ['place' (numb place.s)]
          ['x' (numb x.s)]
          ['y' (numb y.s)]
          ['dir' (dir-s dir.s)]
      ==
    =/  look-j
      |=  lk=look:g
      ^-  ^json
      %-  pairs
      %+  turn  ~(tap by lk)
      |=  [s=slot:g p=piece:g]
      ^-  [@t ^json]
      :-  (crip (trip (scot %tas s)))
      %-  pairs
      :~  ['part' s+(crip (trip part.p))]
          ['tint' ?~(tint.p ~ (numb u.tint.p))]
      ==
    ?-    -.upd
        %peer-here
      %+  frond  'peer-here'
      %-  pairs
      :~  ['who' s+(scot %p who.upd)]
          ['spot' (spot-j spot.upd)]
          ['rev' (numb rev.upd)]
          ['host' ?~(host.upd ~ s+(scot %p u.host.upd))]
      ==
    ::
        %peer-gone
      (frond 'peer-gone' (pairs ~[['who' s+(scot %p who.upd)]]))
    ::
        %peer-look
      %+  frond  'peer-look'
      %-  pairs
      :~  ['who' s+(scot %p who.upd)]
          ['look' (look-j look.upd)]
          ['rev' (numb rev.upd)]
      ==
    ::
        %our-look
      %+  frond  'our-look'
      %-  pairs
      :~  ['look' (look-j look.upd)]
          ['rev' (numb rev.upd)]
          ['equipment' b+sprite-lab.upd]
          ['spriteLab' b+sprite-lab.upd]
      ==
    ::
    ::  The room we hold for one of our notes, or null for none.
        %our-lease
      %+  frond  'our-lease'
      ?~  lease.upd  ~
      %-  pairs
      :~  ['place' (numb place.u.lease.upd)]
          ['note' s+(crip (trip note.u.lease.upd))]
          ['gen' (numb gen.u.lease.upd)]
          ['world' ?~(world.upd ~ s+(scot %p u.world.upd))]
      ==
    ::
        %seat-ok
      %+  frond  'seat-ok'
      %-  pairs
      :~  ['place' (numb place.upd)]
          ['gen' (numb gen.upd)]
      ==
    ::
        %lease-gone
      %+  frond  'lease-gone'
      %-  pairs
      :~  ['who' s+(scot %p who.upd)]
          ['place' (numb place.upd)]
          ['gen' (numb gen.upd)]
      ==
    ::
        %our-prefs
      (frond 'our-prefs' s+text.upd)
    ::
    ::  The world's spots: {"spots": {"<spot>": {desk, publisher, title, context}}}.
        %spots
      %+  frond  'spots'
      %-  pairs
      %+  turn  ~(tap by spots.upd)
      |=  [id=@tas a=spot-app:g]
      ^-  [@t ^json]
      :-  (crip (trip (scot %tas id)))
      %-  pairs
      :~  ['desk' s+(crip (trip (scot %tas desk.a)))]
          ['publisher' s+(scot %p publisher.a)]
          ['title' s+title.a]
          ['context' (pairs (turn context.a |=([k=@t v=@t] [k s+v])))]
      ==
    ::
    ::  The websites on spots: {"spot-webs": {"<spot>": {url, title}}}.
        %spot-webs
      %+  frond  'spot-webs'
      %-  pairs
      %+  turn  ~(tap by webs.upd)
      |=  [id=@tas w=spot-web:g]
      ^-  [@t ^json]
      :-  (crip (trip (scot %tas id)))
      (pairs ~[['url' s+url.w] ['title' s+title.w]])
    ::
        %session
      %+  frond  'session'
      %-  pairs
      :~  ['tab' s+tab.upd]
          ['gen' (numb gen.upd)]
      ==
    ::
    ::  Signs people changed in a host's world: {"signs": {host, signs:
    ::  {"<item>": {text, by, at}}}}, `at` in Unix milliseconds.
        %signs
      %+  frond  'signs'
      %-  pairs
      :~  ['host' s+(scot %p host.upd)]
          :-  'signs'
          %-  pairs
          %+  turn  ~(tap by signs.upd)
          |=  [item=@t s=sign:g]
          ^-  [@t ^json]
          :-  item
          %-  pairs
          :~  ['text' s+text.s]
              ['by' s+(scot %p by.s)]
              ['at' (numb (div (sub at.s ~1970.1.1) (div ~s1 1.000)))]
          ==
      ==
    ::
        %signs-shut
      (frond 'signs-shut' (pairs ~[['host' s+(scot %p host.upd)]]))
    ::
    ::  The Glurffs a ship is in (2026-11-08): {"glurff-list": {host,
    ::  glurffs: [{host, note, name, members}]}}.
        %glurff-list
      %+  frond  'glurff-list'
      %-  pairs
      :~  ['host' s+(scot %p host.upd)]
          :-  'glurffs'
          :-  %a
          %+  turn  glurffs.upd
          |=  e=glurff-entry:g
          %-  pairs
          :~  ['host' s+(scot %p host.e)]
              ['note' s+(crip (trip note.e))]
              ['name' s+name.e]
              ['members' (numb members.e)]
          ==
      ==
    ::
        %glurff-list-shut
      (frond 'glurff-list-shut' (pairs ~[['host' s+(scot %p host.upd)]]))
    ::
        %sign-refused
      (frond 'sign-refused' (pairs ~[['host' s+(scot %p host.upd)] ['item' s+item.upd]]))
    ::
    ::  A host's world card: {"world-card": {host, card: null | {note, name,
    ::  live: null | {release, doc, size}}}}. `doc` is the hex of its hash.
        %world-card
      %+  frond  'world-card'
      %-  pairs
      :~  ['host' s+(scot %p host.upd)]
          :-  'card'
          ?~  card.upd  ~
          %-  pairs
          :~  ['note' s+(crip (trip note.u.card.upd))]
              ['name' s+name.u.card.upd]
              :-  'live'
              ?~  live.u.card.upd  ~
              %-  pairs
              :~  ['release' (numb n.u.live.u.card.upd)]
                  ['doc' s+(en:base16:mimes:html [32 doc.u.live.u.card.upd])]
                  ['size' (numb size.u.live.u.card.upd)]
              ==
          ==
      ==
    ::
        %call-refused
      %+  frond  'call-refused'
      %-  pairs
      :~  ['who' s+(scot %p who.upd)]
          ['place' (numb place.upd)]
          ['attempt' (numb attempt.upd)]
          ['why' s+why.upd]
      ==
    ::
    ::  A call's record, from the Glurff's host. `since` is Unix milliseconds.
        %call-mod-snap
      =/  ships
        |=  s=(set @p)
        ^-  ^json
        a+(turn (sort ~(tap in s) lth) |=(w=@p s+(scot %p w)))
      %+  frond  'call-mod-snap'
      %-  pairs
      :~  ['host' s+(scot %p host.upd)]
          ['place' (numb place.upd)]
          ['inc' (numb inc.snap.upd)]
          ['rev' (numb rev.snap.upd)]
          ['admins' (ships admins.snap.upd)]
          ['mods' (ships mods.snap.upd)]
          ['muted' (ships muted.snap.upd)]
          ['gmuted' (ships gmuted.snap.upd)]
          ['booted' (ships booted.snap.upd)]
          :-  'recording'
          ?~  recording.snap.upd  ~
          %-  pairs
          :~  ['by' s+(scot %p by.u.recording.snap.upd)]
              :-  'since'
              (numb (div (sub since.u.recording.snap.upd ~1970.1.1) (div ~s1 1.000)))
          ==
      ==
    ::
        %lease-info
      %+  frond  'lease-info'
      %-  pairs
      :~  ['who' s+(scot %p who.upd)]
          ['place' (numb place.upd)]
          ['note' s+(crip (trip note.upd))]
          ['vis' s+vis.upd]
          ['gen' (numb gen.upd)]
      ==
    ::
        %lease-private
      %+  frond  'lease-private'
      %-  pairs
      :~  ['who' s+(scot %p who.upd)]
          ['place' (numb place.upd)]
          ['gen' (numb gen.upd)]
      ==
    ::
        %peer-hosting
      %+  frond  'peer-hosting'
      %-  pairs
      :~  ['who' s+(scot %p who.upd)]
          ['place' (numb place.upd)]
          ['mode' s+(crip (trip (scot %tas mode.upd)))]
      ==
    ::
        %peer-unhosting
      %+  frond  'peer-unhosting'
      (pairs ~[['who' s+(scot %p who.upd)] ['place' (numb place.upd)]])
    ::
        %knocked
      %+  frond  'knocked'
      (pairs ~[['who' s+(scot %p who.upd)] ['place' (numb place.upd)]])
    ::
        %refused
      %+  frond  'refused'
      %-  pairs
      :~  ['host' s+(scot %p host.upd)]
          ['place' (numb place.upd)]
          ['why' s+(crip (trip (scot %tas why.upd)))]
      ==
    ::
        %splashed
      (frond 'splashed' (pairs ~[['who' s+(scot %p who.upd)]]))
    ::
        %presence-event
      (frond 'presence-event' (pairs ~[['who' s+(scot %p who.upd)] ['body' s+body.upd]]))
    ::
        %room-event
      (frond 'room-event' (pairs ~[['who' s+(scot %p who.upd)] ['place' (numb place.upd)] ['body' s+body.upd]]))
    ::
        %rolled
      %+  frond  'rolled'
      %-  pairs
      :~  ['who' s+(scot %p who.upd)]
          ['place' (numb place.upd)]
          :-  'stage'
          ?-  -.stage.upd
            %commit  (pairs ~[['kind' s+'commit'] ['hash' s+(scot %uv hash.stage.upd)]])
            %reveal  (pairs ~[['kind' s+'reveal'] ['secret' s+(scot %uv secret.stage.upd)]])
          ==
      ==
    ==
  --
++  grab
  |%
  ++  noun  update:g
  --
++  grad  %noun
--
