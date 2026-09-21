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
      (pairs ~[['look' (look-j look.upd)] ['rev' (numb rev.upd)]])
    ::
    ::  The room we hold for one of our notes, or null for none.
        %our-lease
      %+  frond  'our-lease'
      ?~  lease.upd  ~
      %-  pairs
      :~  ['place' (numb place.u.lease.upd)]
          ['note' s+(crip (trip note.u.lease.upd))]
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
