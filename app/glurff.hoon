::  %glurff: a shared pixel world, with Noltbook underneath it.
::
::  WHAT THIS IS
::  The world and the bodies. Where people stand, what they look like, and the
::  calls in its rooms and huddles. It is a fan-out with almost no memory.
::
::  WHAT IT IS NOT
::  It stores no message, no contact list and no chat history. Those are
::  Noltbook's, reached from the browser over the same Eyre channel that serves
::  this page. This agent never modifies the %noltbook desk. On the Glurff's
::  host it does keep each call's record -- who is in it and its moderation --
::  because every call is held there (see `host-call` in /sur).
::
::  PRESENCE IS STATELESS
::  An incoming claim goes straight out as a fact to our own client and is
::  forgotten. A position that survived an agent restart would be a lie, and the
::  client ages entries out on a TTL anyway. That also means no presence map to
::  migrate, sweep or leak.
::
::  ON `peers`: COOPERATIVE, NOT ENFORCED
::  The browser derives its audience from the official shared note's members
::  and their direct live presence. The transport authenticates the sending
::  ship; it does not prove that a member's claimed position is physically true.
/-  g=glurff, gc=glurff-calls
/+  default-agent, dbug, verb, server, glurff-site, gw=glurff-world
/$  c1  %json  %glurff-action
/$  c2  %json  %glurff-room
/$  c3  %json  %glurff-commons
|%
+$  versioned-state  $%(state-0 state-1 state-2)
+$  state-0
  $:  %0
      ::  our own character, as a spec. Peers refetch when `rev` moves.
      =look:g
      rev=look-rev:g
      ::  rooms WE are holding, and how each answers a knock.
      hosting=(map place:g lock-mode:g)
  ==
::  state-1 adds the LEASE: the one room we hold for one of our own Noltbook
::  notes. It is a real upgrade rather than a reset, because state-0 carries
::  everybody's character and throwing that away to add a field would be
::  charging them for our change.
+$  state-1
  $:  %1
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      ::  one at a time, by rule. `~` is holding none.
      lease=(unit lease:g)
  ==
::  state-2 adds an owner-controlled preview switch for unfinished character
::  art. It defaults off and survives agent reloads; saved equipment remains.
::  Since 2026-10-12 it says only whether we may CHOOSE that art -- everybody
::  sees it -- and our page turns it on (the Library's secret; see /mar
::  glurff-action, 'unlock-equipment').
+$  state-2
  $:  %2
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit lease:g)
      sprite-lab=?
  ==
::  state-3 replaces the permanent lease with an occupancy-tracked one. The
::  lease itself is unchanged in spirit -- one room, one note, one per ship --
::  but this agent now knows who is in the room and ends the lease when the last
::  of them goes, whether or not the owner's browser is still running.
+$  state-3
  $:  %3
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
  ==
::  state-4 adds the SESSION LEASE: which one browser session this ship is
::  using Glurff from. See `live` in /sur.
+$  state-4
  $:  %4
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
  ==
::  state-5 adds the per-ship METER on pokes from other ships (see `meter` in
::  /sur), HOST-SHIP ADMISSION -- who our browser has let into each of our
::  calls, so our agent can let them back in alone -- and the leased room's
::  DOOR.
+$  state-5
  $:  %5
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      admits=(map place:g (set @p))
      door=(unit door:g)
  ==
::  state-6 adds THE WORLD ROOM: the relay room this ship keeps for everybody
::  when it is the world's host. `~` until somebody first asks to be let in.
::  See `world-room` in /sur.
+$  state-6
  $:  %6
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      admits=(map place:g (set @p))
      door=(unit door:g)
      world=(unit world-room:g)
  ==
::  state-7 adds OUR SETTINGS: owner-local JSON from our own browser -- the
::  clocks in the sky, our time zone -- kept so they follow us to any browser.
::  See `prefs-max` in /sur.
+$  state-7
  $:  %7
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      admits=(map place:g (set @p))
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
  ==
::  state-8 adds THE WORLD'S SPOTS: which app each spot on the map opens, when
::  we are a world's host. See `spot-app` in /sur.
+$  state-8
  $:  %8
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      admits=(map place:g (set @p))
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
  ==
::  state-9 adds WEBSITES ON SPOTS: an https address a world's host put on a
::  spot instead of an app. See `spot-web` in /sur.
+$  state-9
  $:  %9
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      admits=(map place:g (set @p))
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
      webs=(map @tas spot-web:g)
  ==
::  state-10 moves EVERY CALL ONTO THE GLURFF'S HOST (2026-10-31): the calls
::  this ship keeps when it is that host, one record per room and huddle --
::  see `host-call` in /sur. HOST-SHIP ADMISSION goes: nobody's browser lets
::  anybody into a call any more, the host's agent decides.
+$  state-10
  $:  %10
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
      webs=(map @tas spot-web:g)
      calls=(map place:g host-call-10:g)
  ==
::  state-11 adds what each call's server was told to keep QUIET (2026-10-31):
::  a member muted in the whole Glurff by its note is muted in every call, and
::  a mute of one kind never lifts the other. See `host-call` in /sur.
+$  state-11
  $:  %11
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
      webs=(map @tas spot-web:g)
      calls=(map place:g host-call:g)
  ==
::  state-12 adds THE WORLD AS DATA (2026-11-04): the world this ship hosts,
::  if it hosts one -- its document, its images, what it has published -- and
::  the browsers waiting on assets from other hosts. See `home` in /sur.
+$  state-12
  $:  %12
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
      webs=(map @tas spot-web:g)
      calls=(map place:g host-call:g)
      home=(unit home:g)
      fetches=(map [@p hash:g] fetch:g)
  ==
::  state-13 remembers WHICH WORLD our lease was taken in (2026-11-05). One
::  lease at a time still; but a room's number means something only in its
::  own world, so a browser visiting another must not take that world's room
::  of the same number for ours. `~` is the official world's, where every
::  lease before this one was taken.
+$  state-13
  $:  %13
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
      webs=(map @tas spot-web:g)
      calls=(map place:g host-call:g)
      home=(unit home:g)
      fetches=(map [@p hash:g] fetch:g)
      lease-world=(unit @p)
  ==
::  state-14 keeps the SIGNS PEOPLE CHANGED in the world we host
::  (2026-11-07): see `sign` in /sur.
+$  state-14
  $:  %14
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
      webs=(map @tas spot-web:g)
      calls=(map place:g host-call:g)
      home=(unit home:g)
      fetches=(map [@p hash:g] fetch:g)
      lease-world=(unit @p)
      signs=(map @t sign:g)
  ==
::  state-15 LISTS GLURFFS (2026-11-08): where our Publish lists ours
::  (`listing-host` to start with), and the Glurffs listed with us.
+$  state-15
  $:  %15
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
      webs=(map @tas spot-web:g)
      calls=(map place:g host-call:g)
      home=(unit home:g)
      fetches=(map [@p hash:g] fetch:g)
      lease-world=(unit @p)
      signs=(map @t sign:g)
      listing=(unit @p)
      listed=(map @p listing:g)
  ==
::  state-16 lived a few hours, on the dev ships only (2026-11-10): it kept
::  other hosts' assets, which visitors must not. Read only to drop them
::  (on-load); the state is state-15 again.
+$  state-16
  $:  %16
      =look:g
      rev=look-rev:g
      hosting=(map place:g lock-mode:g)
      lease=(unit held:g)
      sprite-lab=?
      live=(unit live:g)
      meters=(map @p meter:g)
      door=(unit door:g)
      world=(unit world-room:g)
      prefs=@t
      spots=(map @tas spot-app:g)
      webs=(map @tas spot-web:g)
      calls=(map place:g host-call:g)
      home=(unit home:g)
      fetches=(map [@p hash:g] fetch:g)
      lease-world=(unit @p)
      signs=(map @t sign:g)
      listing=(unit @p)
      listed=(map @p listing:g)
      stash=(map hash:g kept:g)
  ==
+$  card  card:agent:gall
--
::
=|  state-15
=*  state  -
^-  agent:gall
=<
|_  =bowl:gall
+*  this  .
    def   ~(. (default-agent this %.n) bowl)
    hc    ~(. ^hc bowl)
::
++  on-init
  ^-  (quip card _this)
  :_  this(look *look:g, rev 0, hosting ~, lease ~, sprite-lab %.n, live ~, meters ~, door ~, world ~, prefs '', spots ~, webs ~, calls ~, home ~, fetches ~, lease-world ~, signs ~, listing `listing-host:g, listed ~)
  [(bind:glurff-site) calls-watch:hc]
::
++  on-save  !>(state)
++  on-load
  |=  old=vase
  ^-  (quip card _this)
  ::  Anything we do not recognise -- including every shape the previous,
  ::  Turf-derived Glurff saved -- is discarded for a clean start rather than
  ::  crashing the agent.
  ::
  ::  state-0 IS recognised and upgraded: it holds the character somebody built,
  ::  and adding a field is our business, not theirs.
  ::  Browsers waiting on an asset are kept: their requests, and the fetches
  ::  answering them, outlive a reload of this agent.
  =/  fifteen=(unit state-15)
    =/  res  (mule |.(!<(state-15 old)))
    ?:(?=(%| -.res) ~ `p.res)
  ?^  fifteen
    :_  this(state u.fifteen)
    [(bind:glurff-site) calls-watch:hc]
  ::  The dev ships' few hours of state-16: what it kept of other hosts'
  ::  pictures is dropped. A visitor's ship keeps none; its browser does.
  =/  sixteen=(unit state-16)
    =/  res  (mule |.(!<(state-16 old)))
    ?:(?=(%| -.res) ~ `p.res)
  ?^  sixteen
    =/  w=state-16  u.sixteen
    :_  %=  this
          state  :*  %15  look.w  rev.w  hosting.w  lease.w  sprite-lab.w  live.w
                     meters.w  door.w  world.w  prefs.w  spots.w  webs.w  calls.w
                     home.w  fetches.w  lease-world.w  signs.w  listing.w  listed.w
                 ==
        ==
    [(bind:glurff-site) calls-watch:hc]
  ::  Listed where Glurffs are listed for now, and nothing listed with us.
  =/  lift-15
    |=  w=state-14
    ^-  state-15
    :*  %15  look.w  rev.w  hosting.w  lease.w  sprite-lab.w  live.w  meters.w
        door.w  world.w  prefs.w  spots.w  webs.w  calls.w  home.w  fetches.w
        lease-world.w  signs.w  `listing-host:g  ~
    ==
  =/  fourteen=(unit state-14)
    =/  res  (mule |.(!<(state-14 old)))
    ?:(?=(%| -.res) ~ `p.res)
  ?^  fourteen
    :_  this(state (lift-15 u.fourteen))
    [(bind:glurff-site) calls-watch:hc]
  ::  No sign changed yet.
  =/  lift-14
    |=  w=state-13
    ^-  state-14
    :*  %14  look.w  rev.w  hosting.w  lease.w  sprite-lab.w  live.w  meters.w
        door.w  world.w  prefs.w  spots.w  webs.w  calls.w  home.w  fetches.w
        lease-world.w  ~
    ==
  =/  thirteen=(unit state-13)
    =/  res  (mule |.(!<(state-13 old)))
    ?:(?=(%| -.res) ~ `p.res)
  ?^  thirteen
    :_  this(state (lift-15 (lift-14 u.thirteen)))
    [(bind:glurff-site) calls-watch:hc]
  ::  A lease held from before is the official world's.
  =/  lift-13
    |=  w=state-12
    ^-  state-13
    :*  %13  look.w  rev.w  hosting.w  lease.w  sprite-lab.w  live.w  meters.w
        door.w  world.w  prefs.w  spots.w  webs.w  calls.w  home.w  fetches.w  ~
    ==
  =/  twelve=(unit state-12)
    =/  res  (mule |.(!<(state-12 old)))
    ?:(?=(%| -.res) ~ `p.res)
  ?^  twelve
    :_  this(state (lift-15 (lift-14 (lift-13 u.twelve))))
    [(bind:glurff-site) calls-watch:hc]
  ::  No world hosted, and nothing being fetched: a ship hosts a world only
  ::  once its operator says so (see `home` in /sur).
  =/  lift-12
    |=  w=state-11
    ^-  state-12
    :*  %12  look.w  rev.w  hosting.w  lease.w  sprite-lab.w  live.w  meters.w
        door.w  world.w  prefs.w  spots.w  webs.w  calls.w  ~  ~
    ==
  =/  eleven=(unit state-11)
    =/  res  (mule |.(!<(state-11 old)))
    ?:(?=(%| -.res) ~ `p.res)
  ?^  eleven
    :_  this(state (lift-15 (lift-14 (lift-13 (lift-12 u.eleven)))))
    [(bind:glurff-site) calls-watch:hc]
  =/  ten=(unit state-10)
    =/  res  (mule |.(!<(state-10 old)))
    ?:(?=(%| -.res) ~ `p.res)
  =/  nine=(unit state-9)
    ?^  ten  ~
    =/  res  (mule |.(!<(state-9 old)))
    ?:(?=(%| -.res) ~ `p.res)
  =/  eight=(unit state-8)
    ?:  |(?=(^ ten) ?=(^ nine))  ~
    =/  res  (mule |.(!<(state-8 old)))
    ?:(?=(%| -.res) ~ `p.res)
  =/  seven=(unit state-7)
    ?:  |(?=(^ ten) ?=(^ nine) ?=(^ eight))  ~
    =/  res  (mule |.(!<(state-7 old)))
    ?:(?=(%| -.res) ~ `p.res)
  =/  current=(unit state-6)
    ?:  |(?=(^ ten) ?=(^ nine) ?=(^ eight) ?=(^ seven))  ~
    =/  res  (mule |.(!<(state-6 old)))
    ?:(?=(%| -.res) ~ `p.res)
  =/  now-state=(unit state-5)
    ?:  |(?=(^ ten) ?=(^ current))  ~
    =/  res  (mule |.(!<(state-5 old)))
    ?:(?=(%| -.res) ~ `p.res)
  ::  An older lease was permanent and had no occupancy at all. It is carried
  ::  over rather than dropped -- a live lease is somebody's room and must not
  ::  disappear because we reloaded -- and it starts at generation 1 with no
  ::  seats. The first person to walk in takes the first seat; until then the
  ::  timer below gives it the ordinary grace period rather than ending it
  ::  instantly on an agent reload.
  =/  lift
    |=  [was=(unit lease:g) when=@da]
    ^-  (unit held:g)
    ?~  was  ~
    `[place.u.was note.u.was 1 ~ `when ~]
  =/  parsed=(unit state-5)
    ?^  now-state  now-state
    ::  Meters start empty: they only ever describe the last ten seconds.
    =/  res  (mule |.(!<(state-4 old)))
    ?.  ?=(%| -.res)
      =/  was=state-4  p.res
      `[%5 look.was rev.was hosting.was lease.was sprite-lab.was live.was ~ ~ ~]
    ::  No session is carried over: the next browser to renew takes it.
    =/  res  (mule |.(!<(state-3 old)))
    ?.  ?=(%| -.res)
      =/  was=state-3  p.res
      `[%5 look.was rev.was hosting.was lease.was sprite-lab.was ~ ~ ~ ~]
    =/  res  (mule |.(!<(state-2 old)))
    ?.  ?=(%| -.res)
      =/  was=state-2  p.res
      `[%5 look.was rev.was hosting.was (lift lease.was now.bowl) sprite-lab.was ~ ~ ~ ~]
    =/  res  (mule |.(!<(state-1 old)))
    ?.  ?=(%| -.res)
      =/  was=state-1  p.res
      `[%5 look.was rev.was hosting.was (lift lease.was now.bowl) %.n ~ ~ ~ ~]
    =/  res  (mule |.(!<(state-0 old)))
    ?:  ?=(%| -.res)  ~
    =/  was=state-0  p.res
    `[%5 look.was rev.was hosting.was ~ %.n ~ ~ ~ ~]
  ::  The world room starts unknown: the first ask after the upgrade opens it
  ::  afresh, which is right for a room this agent never kept.
  =/  next=(unit state-6)
    ?^  current  current
    ?~  parsed  ~
    =/  was=state-5  u.parsed
    `[%6 look.was rev.was hosting.was lease.was sprite-lab.was live.was meters.was admits.was door.was ~]
  ::  Settings start empty: the client's defaults.
  =/  settled=(unit state-7)
    ?^  seven  seven
    ?~  next  ~
    =/  was=state-6  u.next
    `[%7 look.was rev.was hosting.was lease.was sprite-lab.was live.was meters.was admits.was door.was world.was '']
  ::  No spots set: each opens whatever the map gives it, if anything.
  =/  spotted=(unit state-8)
    ?^  eight  eight
    ?~  settled  ~
    =/  was=state-7  u.settled
    `[%8 look.was rev.was hosting.was lease.was sprite-lab.was live.was meters.was admits.was door.was world.was prefs.was ~]
  ::  No websites on spots yet.
  =/  last=(unit state-9)
    ?^  nine  nine
    ?~  spotted  ~
    =/  was=state-8  u.spotted
    `[%9 look.was rev.was hosting.was lease.was sprite-lab.was live.was meters.was admits.was door.was world.was prefs.was spots.was ~]
  ::  No calls kept yet: the first ask after the upgrade opens each afresh.
  ::  Who our browser had let into our own calls is dropped -- the Glurff's
  ::  host decides that now.
  =/  newest=(unit state-10)
    ?^  ten  ten
    ?~  last  ~
    =/  was=state-9  u.last
    `[%10 look.was rev.was hosting.was lease.was sprite-lab.was live.was meters.was door.was world.was prefs.was spots.was webs.was ~]
  ::  What each call's server was told to keep quiet: its own mutes, the only
  ::  ones state-10 ever told it about.
  ?~  newest  on-init
  =/  was=state-10  u.newest
  =/  calls=(map place:g host-call:g)
    %-  ~(run by calls.was)
    |=(c=host-call-10:g `host-call:g`[inc rev seen admins muted booted recording roster asked failing touched muted]:c)
  :_  this(state (lift-15 (lift-14 (lift-13 (lift-12 [%11 look.was rev.was hosting.was lease.was sprite-lab.was live.was meters.was door.was world.was prefs.was spots.was webs.was calls])))))
  [(bind:glurff-site) calls-watch:hc]
::
++  on-poke
  |=  [=mark =vase]
  ^-  (quip card _this)
  ?+    mark  (on-poke:def mark vase)
      %handle-http-request
    =/  req  !<([eyre-id=@ta =inbound-request:eyre] vase)
    ::  THE WORLD AS DATA: a host's editing API, and the assets of any host's
    ::  world. Everything else is the static frontend.
    ?.  (world-url:hc url.request.inbound-request.req)
      [(serve:glurff-site bowl req) this]
    =^  cards  state  (world-http:hc req)
    [cards this]
  ::
  ::  ---- from Dojo on this ship, and nowhere else ----
  ::
  ::  Hosting a world, and editing it. See /mar/glurff-operator.
      %glurff-operator
    ?>  =(src.bowl our.bowl)
    =^  cards  state  (operate:hc !<(operator:g vase))
    [cards this]
  ::
  ::  ---- from our own browser ----
  ::
      %glurff-action
    ?>  =(src.bowl our.bowl)
    =+  !<(act=action:g vase)
    =^  cards  state  (do-action:hc act)
    [cards this]
  ::
  ::  Open or close a room's call. The room key is derived here from the place
  ::  id alone, so a caller cannot steer which Galene room is touched.
      %glurff-room
    ?>  =(src.bowl our.bowl)
    =+  !<([op=@tas place=@ud ttl=@ud session=@ud who=(list @p)] vase)
    ::  The world room is opened by asks alone (see +world-knock). Opening it
    ::  from a browser would throw out everybody inside.
    ?:  &(=(%open op) =(place world-place:g))  `this
    ::  Nor is any room's or huddle's call opened, renewed or moderated from a
    ::  browser: the Glurff's host does all of that (see +call-knock).
    ?:  (call-place:hc place)  `this
    =.  hosting
      ?:  ?&(?=(%open op) (gth place movement-base:g) (lth place 1.000.000))
        (~(put by hosting) place %open)
      hosting
    :_  this
    ?:  ?=(%close op)
      ::  Deliberately NOT ending the room. Walking away is not a decision to
      ::  hang up on the people still in it, and %end invalidates every token
      ::  already issued. The lease expires on its own.
      ~
    ?:  ?=(%renew-room op)
      :_  ~
      %-  calls-poke:hc
      [%renew (call-req:hc place session %renew our.bowl) (room-key:hc place) ttl]
    ?~  who  ~
    ::  MODERATION THE CALL SERVER ENFORCES.
    ::
    ::  A mute only the muted person's browser honours is a request. These make
    ::  it true for every client: %noltbook-calls changes what that participant
    ::  may publish and reissues their credentials, or removes them outright.
    ::  Only a host can get here -- the room key is derived from the place, and
    ::  the broker answers to the room's authority alone -- and never for
    ::  ourselves, so a browser cannot mute its own way out of a moderated call.
    ?:  ?=(?(%mute-access %unmute-access) op)
      ?:  =(our.bowl i.who)  ~
      :_  ~
      %-  calls-poke:hc
      ?:  ?=(%mute-access op)
        :*  %mute-access
            (call-req:hc place session %mute-access i.who)
            (room-key:hc place)  i.who  %glurff
            (call-ctx:hc place i.who session)
        ==
      :*  %unmute-access
          (call-req:hc place session %unmute-access i.who)
          (room-key:hc place)  i.who  %glurff
          (call-ctx:hc place i.who session)
      ==
    ?:  ?=(%evict op)
      ?:  =(our.bowl i.who)  ~
      :_  ~
      %-  calls-poke:hc
      [%evict (call-req:hc place session %evict i.who) (room-key:hc place) i.who]
    ?:  ?=(%renew-access op)
      :_  ~
      %-  calls-poke:hc
      :*  %renew-access
          (call-req:hc place session %renew-access i.who)
          (room-key:hc place)  i.who  %glurff
          (call-ctx:hc place i.who session)
      ==
    ::  ADMIT: the room already exists, so only issue access. Re-ensuring it
    ::  would bump its generation and throw out everyone already inside.
    ?:  ?=(%admit op)
      %+  turn  who
      |=  p=@p
      %-  calls-poke:hc
      :*  %access
          (call-req:hc place session %access p)
          (room-key:hc place)  p  %glurff
          (call-ctx:hc place p session)
      ==
    ::  OPEN: ensure the room, for the HOST alone.
    ::
    ::  Nobody else is minted for here. Access to a room that does not exist yet
    ::  is refused, and firing both in one breath raced the room's creation --
    ::  the others were left holding nothing while the room came up fine. The
    ::  host admits them once its own credential proves the room is there.
    :_  ~
    %-  calls-poke:hc
    :*  %ensure-access
        (call-req:hc place session %ensure i.who)
        (room-key:hc place)  ttl  i.who  %glurff
        (call-ctx:hc place i.who session)
    ==
  ::
  ::  Legacy clients used this to install a local gossip Commons. The official
  ::  world now joins ~nolset's existing group through Noltbook's API. Keep the
  ::  mark as a no-op so an old tab cannot overwrite any previous chat history.
      %glurff-commons
    ?>  =(src.bowl our.bowl)
    [~ this]
  ::
  ::  ---- from another ship ----
  ::
  ::  The subject is src.bowl and nothing in the payload can override it.
      %glurff-remote
    =+  !<(rem=remote:g vase)
    ::  Metered and size-checked BEFORE anything else happens: a ship past its
    ::  allowance, or sending an oversized body, is dropped here and costs our
    ::  browser nothing.
    =^  ok  state  (meter:hc src.bowl)
    ?.  ok  `this
    ?.  (fits:hc rem)  `this
    =^  cards  state  (do-remote:hc src.bowl rem)
    [cards this]
  ::
  ::  ---- from our own %noltbook-calls ----
  ::
  ::  A grant minted for us goes to our own browser; one minted for someone else
  ::  goes to that ONE ship. Nothing is stored: the correlation rode out and
  ::  back in `context`.
      %noltbook-calls-access
    ?>  =(src.bowl our.bowl)
    =+  !<(res=call-result:gc vase)
    =.  state  (world-heard:hc res)
    =.  state  (call-heard:hc res)
    [(grant-cards:hc res) this]
  ::
  ::  A grant handed to us by a room's host.
  ::
  ::  COOPERATIVE, NOT ENFORCED: we cannot verify that the sender really holds
  ::  the room, so the browser decides whether to act on it. What IS guaranteed
  ::  is that the credential inside was minted by the broker for us, and expires
  ::  on its own.
      %glurff-grant
    =+  !<(res=call-result:gc vase)
    :_  this
    ~[[%give %fact ~[/call-access] %glurff-access !>(res)]]
  ==
::
++  on-watch
  |=  =path
  ^-  (quip card _this)
  ?+    path  (on-watch:def path)
      [%http-response *]
    ::  Eyre uses a guest identity before login; the HTTP handler checks both
    ::  authentication and the owner identity before serving any bytes.
    `this
  ::
      [%world ~]
    ::  Owner-local. No replay: we store no presence, so a late subscriber sees
    ::  people as soon as they next move, which is within a beat.
    ?>  =(our.bowl src.bowl)
    :_  this
    %+  weld
      :~  [%give %fact ~ %glurff-update !>(`update:g`[%our-look look rev sprite-lab])]
          ::  The lease outlives the tab, so a fresh page is told about it at
          ::  once rather than finding out when somebody walks in.
          [%give %fact ~ %glurff-update !>(`update:g`[%our-lease (shown:hc lease) lease-world])]
          ::  Our settings, so the page draws our clocks from the start.
          [%give %fact ~ %glurff-update !>(`update:g`[%our-prefs prefs])]
      ==
    ::  And which session is live, so a page opened beside it knows at once.
    ?~  live  ~
    ~[[%give %fact ~ %glurff-update !>(`update:g`[%session tab.u.live gen.u.live])]]
  ::
      [%spots ~]
    ::  THE WORLD'S SPOTS: which app each spot opens. Anybody may watch -- a
    ::  visitor's agent reads them from the world's host -- since nothing here
    ::  is private: it is what the map shows everyone who walks up to it.
    [(spots-facts:hc ~ spots webs) this]
  ::
      [%spots @ ~]
    ::  OUR PAGE, reading a world host's spots. A page cannot hear another
    ::  ship's agent itself -- Eyre takes facts from another ship only through
    ::  an agent -- so we watch the host for it and pass on what it says,
    ::  watching afresh each time so the host answers at once. Our own spots,
    ::  if we are the host.
    ?>  =(our.bowl src.bowl)
    =/  host=@p  (slav %p i.t.path)
    :_  this
    ?:  =(host our.bowl)
      (spots-facts:hc ~ spots webs)
    (spots-follow:hc host)
  ::
      [%card ~]
    ::  OUR WORLD'S CARD: its note, its name, and the live release. Anybody
    ::  may watch, as with /spots -- it is what anybody needs to decide to
    ::  visit -- and the release itself is fetched only by members.
    ::  A secret world's card is given only to its members (`card-for`).
    :_  this
    ~[[%give %fact ~ %glurff-update !>(`update:g`[%world-card our.bowl (card-for:hc src.bowl)])]]
  ::
      [%card @ ~]
    ::  OUR PAGE, reading a host's card, the way it reads a host's spots.
    ?>  =(our.bowl src.bowl)
    =/  host=@p  (slav %p i.t.path)
    :_  this
    ?:  =(host our.bowl)
      ~[[%give %fact ~ %glurff-update !>(`update:g`[%world-card our.bowl card-of:hc])]]
    (card-follow:hc host)
  ::
      [%signs ~]
    ::  THE SIGNS PEOPLE CHANGED in our world: for its members' agents only,
    ::  since what a sign says is the world's, as its release is.
    ?>  (visitor-ok:hc src.bowl)
    :_  this
    ~[[%give %fact ~ %glurff-update !>(`update:g`[%signs our.bowl signs])]]
  ::
      [%signs @ ~]
    ::  OUR PAGE, reading a host's signs, the way it reads a host's card.
    ?>  =(our.bowl src.bowl)
    =/  host=@p  (slav %p i.t.path)
    :_  this
    ?:  =(host our.bowl)
      ~[[%give %fact ~ %glurff-update !>(`update:g`[%signs our.bowl signs])]]
    (signs-follow:hc host)
  ::
      [%glurffs ~]
    ::  THE GLURFFS WE ARE IN (2026-11-08): anybody may ask, as anybody may
    ::  read our card -- each is public. Answered once, then let go.
    :_  this
    :~  [%give %fact ~ %glurff-update !>(`update:g`[%glurff-list our.bowl glurff-list:hc])]
        [%give %kick ~ ~]
    ==
  ::
      [%glurffs @ ~]
    ::  OUR PAGE, asking which Glurffs a ship is in, the way it reads a
    ::  host's card. Our own, if it is us.
    ?>  =(our.bowl src.bowl)
    =/  host=@p  (slav %p i.t.path)
    :_  this
    ?:  =(host our.bowl)
      ~[[%give %fact ~ %glurff-update !>(`update:g`[%glurff-list our.bowl glurff-list:hc])]]
    ~[[%pass /glurffs/(scot %p host)/(scot %da now.bowl) %agent [host %glurff] %watch /glurffs]]
  ::
      [%call-access ~]
    ::  Credential delivery. Owner-local only: this path carries a Galene join
    ::  token and TURN credentials. Never watchable by anyone else, never
    ::  replayed.
    ?>  =(our.bowl src.bowl)
    ::  Also retry an optional watch that an older Noltbook rejected. This
    ::  happens only on a browser subscription, never from a polling timer.
    [calls-watch:hc this]
  ==
::
++  on-agent
  |=  [=wire =sign:agent:gall]
  ^-  (quip card _this)
  ?:  =(/glurff-call-diagnostics wire)
    ?+  -.sign  `this
      %fact
        ?.  =(%noltbook-calls-diagnostic p.cage.sign)  `this
        ::  An optional diagnostic must never break credential delivery if a
        ::  future Noltbook changes this separate schema.
        =/  parsed
          (mule |.(!<(call-diagnostic:gc q.cage.sign)))
        ?:  ?=(%| -.parsed)  `this
        :_  this
        ~[[%give %fact ~[/call-access] %glurff-call-diagnostic !>(p.parsed)]]
      %kick
        :_  this
        ~[calls-watch-card:hc]
    ==
  ::  A WORLD HOST'S SPOTS, for our page: passed on as they come. Kicked, we
  ::  watch again while our page still wants them.
  ?:  ?=([%spots @ @ ~] wire)
    =/  host=@p  (slav %p i.t.wire)
    =/  page=path  /spots/(scot %p host)
    ?+    -.sign  `this
        %fact
      ?.  =(%glurff-update p.cage.sign)  `this
      =/  upd  (mule |.(!<(update:g q.cage.sign)))
      ?:  ?=(%| -.upd)  `this
      ?.  ?=(?(%spots %spot-webs) -.p.upd)  `this
      :_  this
      ~[[%give %fact ~[page] %glurff-update !>(p.upd)]]
    ::
        %kick
      ?.  (~(any by sup.bowl) |=([=ship =path] =(path page)))  `this
      [(spots-follow:hc host) this]
    ::
        %watch-ack
      ?~  p.sign  `this
      ((slog leaf+"glurff: {<host>} keeps no spots for us to show" ~) `this)
    ==
  ::  A HOST'S WORLD CARD, for our page, kept as the spots are. A host with
  ::  no world, or none of this kind, has no card.
  ?:  ?=([%card @ @ ~] wire)
    =/  host=@p  (slav %p i.t.wire)
    =/  page=path  /card/(scot %p host)
    =/  none=card  [%give %fact ~[page] %glurff-update !>(`update:g`[%world-card host ~])]
    ?+    -.sign  `this
        %fact
      ?.  =(%glurff-update p.cage.sign)  `this
      =/  upd  (mule |.(!<(update:g q.cage.sign)))
      ?:  ?=(%| -.upd)  `this
      ?.  ?=(%world-card -.p.upd)  `this
      :_  this
      ~[[%give %fact ~[page] %glurff-update !>(`update:g`p.upd(host host))]]
    ::
        %kick
      ?.  (~(any by sup.bowl) |=([=ship =path] =(path page)))  `this
      [(card-follow:hc host) this]
    ::
        %watch-ack
      ?~  p.sign  `this
      [~[none] this]
    ==
  ::  WHICH GLURFFS A SHIP IS IN, for our page (2026-11-08). A ship from
  ::  before this does not say: our page is told so.
  ?:  ?=([%glurffs @ @ ~] wire)
    =/  host=@p  (slav %p i.t.wire)
    =/  page=path  /glurffs/(scot %p host)
    ?+    -.sign  `this
        %fact
      ?.  =(%glurff-update p.cage.sign)  `this
      =/  upd  (mule |.(!<(update:g q.cage.sign)))
      ?:  ?=(%| -.upd)  `this
      ?.  ?=(%glurff-list -.p.upd)  `this
      :_  this
      ~[[%give %fact ~[page] %glurff-update !>(`update:g`p.upd(host host))]]
    ::
        %watch-ack
      ?~  p.sign  `this
      :_  this
      ~[[%give %fact ~[page] %glurff-update !>(`update:g`[%glurff-list-shut host])]]
    ==
  ::  A HOST'S SIGNS, for our page, kept as its card is. A host that will
  ::  not show us any -- we are not in its world, or it is from before signs
  ::  -- is said to keep none.
  ?:  ?=([%signs @ @ ~] wire)
    =/  host=@p  (slav %p i.t.wire)
    =/  page=path  /signs/(scot %p host)
    ?+    -.sign  `this
        %fact
      ?.  =(%glurff-update p.cage.sign)  `this
      =/  upd  (mule |.(!<(update:g q.cage.sign)))
      ?:  ?=(%| -.upd)  `this
      ?.  ?=(%signs -.p.upd)  `this
      :_  this
      ~[[%give %fact ~[page] %glurff-update !>(`update:g`p.upd(host host))]]
    ::
        %kick
      ?.  (~(any by sup.bowl) |=([=ship =path] =(path page)))  `this
      [(signs-follow:hc host) this]
    ::
        %watch-ack
      ?~  p.sign  `this
      :_  this
      ~[[%give %fact ~[page] %glurff-update !>(`update:g`[%signs-shut host])]]
    ==
  ?.  ?=(%poke-ack -.sign)  `this
  ?~  p.sign  `this
  ::  A host that would not take what we wrote on a sign: our page is told.
  ?:  ?=([%sign-set @ @ ~] wire)
    =/  host=@p  (slav %p i.t.wire)
    =/  item=@t  (slav %t i.t.t.wire)
    :_  this
    ~[[%give %fact ~[/signs/(scot %p host)] %glurff-update !>(`update:g`[%sign-refused host item])]]
  ::  A host that would not take our ask for an asset -- an older Glurff, or
  ::  none -- will not send it: the browsers waiting are told now.
  ?:  ?=([%fetch @ @ ~] wire)
    =/  host=@p  (slav %p i.t.wire)
    =/  h=(unit hash:g)  (unhex:gw i.t.t.wire)
    ?~  h  `this
    =^  cards  state  (asset-came:hc host u.h |+%refused)
    [cards this]
  ?+    wire  `this
      [%glurff-out *]
    ::  A peer that is offline or has no %glurff is ordinary, not an error.
    `this
  ::
      [%glurff-calls *]
    ((slog leaf+"glurff: %noltbook-calls refused a request" u.p.sign) `this)
  ::
      [%commons-install *]
    ((slog leaf+"glurff: could not install the commons note" u.p.sign) `this)
  ==
::
++  on-arvo
  |=  [=wire =sign-arvo]
  ^-  (quip card _this)
  ?:  ?=([%eyre %bound *] sign-arvo)
    ~?  !accepted.sign-arvo  [%glurff-eyre-bind-rejected binding.sign-arvo]
    `this
  ::  AN ASSET FROM ANOTHER HOST, by remote scry: the bytes, or -- an empty
  ::  answer -- the host would not let us read them.
  ?:  ?=([%fetch @ @ ~] wire)
    ?.  ?=([%ames %sage *] sign-arvo)  `this
    =/  host=@p  (slav %p i.t.wire)
    =/  h=(unit hash:g)  (unhex:gw i.t.t.wire)
    ?~  h  `this
    =/  =gage:mess:ames  q.sage.sign-arvo
    =/  got=(each [mime=@t =octs] @tas)
      ?~  gage  |+%denied
      =/  a  ((soft ,[mime=@t size=@ud data=@]) q.gage)
      ?~  a  |+%garbled
      &+[mime.u.a [size.u.a data.u.a]]
    =^  cards  state  (asset-came:hc host u.h got)
    [cards this]
  ::  ...or not in the time one browser waits (2026-11-10): that browser is
  ::  told so, and asks again, joining the fetch, which goes on.
  ?:  ?=([%fetch-for @ @ @ ~] wire)
    =/  host=@p  (slav %p i.t.wire)
    =/  h=(unit hash:g)  (unhex:gw i.t.t.wire)
    =/  id=@ta  i.t.t.t.wire
    ?~  h  `this
    =/  f  (~(get by fetches) [host u.h])
    ?.  ?&(?=(^ f) (~(has in ids.u.f) id))  `this
    :_  this(fetches (~(put by fetches) [host u.h] u.f(ids (~(del in ids.u.f) id))))
    (answer:hc id (error-out:hc 504 ~['the host did not answer in time']))
  ::  A wait set before then, for every browser at once: all told so, and
  ::  the fetch goes on as above.
  ?:  ?=([%fetch-wait @ @ @ ~] wire)
    =/  host=@p  (slav %p i.t.wire)
    =/  h=(unit hash:g)  (unhex:gw i.t.t.wire)
    =/  at=@da  (slav %da i.t.t.t.wire)
    ?~  h  `this
    =/  f  (~(get by fetches) [host u.h])
    ?.  ?&(?=(^ f) =(at at.u.f))  `this
    :_  this(fetches (~(put by fetches) [host u.h] u.f(ids ~)))
    %-  zing
    %+  turn  ~(tap in ids.u.f)
    |=(id=@ta (answer:hc id (error-out:hc 504 ~['the host did not answer in time'])))
  ::  THE LEASE CLOCK. This is what makes a lease end when the room empties even
  ::  though the owner's browser is shut: nobody has to be watching for it.
  ::  THE STORE'S CLOCK (2026-11-08): let go what nothing has wanted for a
  ::  day, and look again in a day if anything is still waiting its turn.
  ?:  ?&(?=([%store-tidy ~] wire) ?=([%behn %wake *] sign-arvo))
    ?~  home  `this
    =.  u.home  (tidy:hc u.home let-go:g ~)
    =/  keep  (fall (kept:hc u.home ~) ~)
    =/  waiting=?  (lien ~(tap in ~(key by assets.u.home)) |=(k=hash:g !(~(has in keep) k)))
    [?.(waiting ~ tidy-cards:hc) this]
  ?:  ?&(?=([%lease ~] wire) ?=([%behn %wake *] sign-arvo))
    ?~  lease  ((slog leaf+"glurff: lease wake with no lease" ~) `this)
    =/  h=held:g  u.lease(armed ~)
    =.  h  (sweep:hc h)
    ~>  %slog.[0 leaf+"glurff: lease wake, seats {<~(wyt by seats.h)>}"]
    ?:  ?&  =(0 ~(wyt by seats.h))
            ?=(^ empty.h)
            (gte now.bowl (add u.empty.h seat-grace:g))
        ==
      ::  Empty for the whole grace period. The room goes back to being an
      ::  ordinary room. Our own browser hears the fact; the ships that were in
      ::  the room hear it directly, because their picture of the lease came
      ::  from a roster that may no longer have anybody publishing it.
      :_  this(lease ~, door ~)
      %+  weld
        (spray:hc (told:hc h) [%lease-gone place.h gen.h])
      ~[(fact:hc [%our-lease ~ ~])]
    =^  cards  h  (arm:hc h (due:hc h))
    [cards this(lease `h)]
  (on-arvo:def wire sign-arvo)
::
::  THE LEASE, READABLE. Occupancy is decided here and nowhere else, so there
::  has to be a way to see it without guessing:
::
::    > .^(json %gx /=glurff=/lease/json)
::
::  Seats, their last renewal, when the room fell empty and what the timer is
::  waiting for. Ships and times only; nothing secret rides on this.
++  on-peek
  |=  =path
  ^-  (unit (unit cage))
  ::  WHO MAY READ OUR WORLD'S ASSETS by encrypted remote scry. Gall asks
  ::  this, ship by ship, before handing a visitor the key to /world: the
  ::  world's members, and nobody else.
  ?:  ?=([%c %world @ ~] path)
    =/  who=(unit @p)  (slaw %p i.t.t.path)
    ?~  who  [~ ~]
    ``noun+!>(`?`(visitor-ok:hc u.who))
  ::  THE CALLS, READABLE, on the Glurff's host (see `host-call` in /sur):
  ::
  ::    > .^(json %gx /=glurff=/calls/json)
  ::
  ::  Each call's run, who is in it and when we last heard from them, and its
  ::  moderation. Ships and times only.
  ::  OUR SETTINGS, for a page to read before it has a channel open:
  ::
  ::    GET /~/scry/glurff/prefs.json
  ::
  ::  The client's own JSON, as a string; '' for none.
  ?:  ?=([%x %prefs ~] path)
    ``json+!>(`json`s+prefs)
  ::  THE GLURFFS LISTED WITH US (2026-11-09), as their hosts said -- what
  ::  `/glurffs` answers adds our own memberships to these:
  ::
  ::    > .^(json %gx /=glurff=/listed/json)
  ::
  ::  Ships, notes and times only; anybody may see them listed anyway.
  ?:  ?=([%x %listed ~] path)
    :^  ~  ~  %json
    !>  ^-  json
    %-  pairs:enjs:format
    %+  turn  ~(tap by listed)
    |=  [h=@p l=listing:g]
    [(scot %p h) (pairs:enjs:format ~[['note' s+note.l] ['at' s+(scot %da at.l)]])]
  ?:  ?=([%x %calls ~] path)
    =/  ships
      |=  s=(set @p)
      ^-  json
      a+(turn ~(tap in s) |=(w=@p s+(scot %p w)))
    :^  ~  ~  %json
    !>  ^-  json
    %-  pairs:enjs:format
    %+  turn  ~(tap by calls)
    |=  [p=place:g c=host-call:g]
    ^-  [@t json]
    :-  (scot %ud p)
    %-  pairs:enjs:format
    :~  ['inc' (numb:enjs:format inc.c)]
        ['rev' (numb:enjs:format rev.c)]
        :-  'seen'
        %-  pairs:enjs:format
        (turn ~(tap by seen.c) |=([w=@p t=@da] [(scot %p w) s+(scot %da t)]))
        ['admins' (ships admins.c)]
        ['muted' (ships muted.c)]
        ['booted' (ships booted.c)]
        ['recording' ?~(recording.c ~ s+(scot %p by.u.recording.c))]
        ['roster' ?~(roster.c ~ (ships u.roster.c))]
        ['asked' s+(scot %da asked.c)]
        ['failing' ?~(failing.c ~ s+(scot %da u.failing.c))]
        ['touched' s+(scot %da touched.c)]
        ['quiet' (ships quiet.c)]
    ==
  ?.  ?=([%x %lease ~] path)  (on-peek:def path)
  :^  ~  ~  %json
  !>  ^-  json
  ?~  lease  ~
  =/  h=held:g  u.lease
  %-  pairs:enjs:format
  :~  ['place' (numb:enjs:format place.h)]
      ['note' s+(crip (trip note.h))]
      ['gen' (numb:enjs:format gen.h)]
      ['now' s+(scot %da now.bowl)]
      ['empty' ?~(empty.h ~ s+(scot %da u.empty.h))]
      ['armed' ?~(armed.h ~ s+(scot %da u.armed.h))]
      :-  'seats'
      :-  %a
      %+  turn  ~(tap by seats.h)
      |=  [s=seat:g last=@da]
      %-  pairs:enjs:format
      :~  ['who' s+(scot %p who.s)]
          ['tab' s+tab.s]
          ['last' s+(scot %da last)]
      ==
  ==
++  on-leave  on-leave:def
++  on-fail   on-fail:def
--
::
::  ------------------------------------------------------------ helper core
::
::  Everything except the ten Gall arms lives here. An agent door must have
::  exactly those arms, so the helpers take the bowl and the state as arguments
::  and hand back (quip card state-2), which the door threads with =^.
|%
++  hc
|_  =bowl:gall
::
::  ---- outbound plumbing ----
::
::  Fan one payload out to the peers our client named. We are the only subject:
::  the receiver reads src.bowl, so nothing we send can speak for anyone else.
++  spray
  |=  [peers=(list @p) rem=remote:g]
  ^-  (list card)
  %+  murn  peers
  |=  who=@p
  ?:  =(who our.bowl)  ~
  `(tell who rem)
++  tell
  |=  [who=@p rem=remote:g]
  ^-  card
  :*  %pass  /glurff-out/(scot %p who)
      %agent  [who %glurff]  %poke
      %glurff-remote  !>(rem)
  ==
::  ---- OCCUPANCY: a lease lasts as long as somebody is in the room ----
::
::  This lives in the agent and not in the browser on purpose. The lease has to
::  survive its owner closing Glurff, so the thing that decides when it ends
::  cannot be a timer in their tab.
::
::  Every tab in the room holds a seat and renews it on a slow cadence. A seat
::  nobody renews expires, which is how a crash is noticed without anybody
::  reporting it. When the last seat goes the room is given a grace period
::  before the lease ends, so stepping in and out of a doorway cannot end a
::  lease that people are still using.
::
::  The lease as the world sees it: no seats, no bookkeeping.
::  Everybody whose tab is in the room, once each. Taken before a lease is
::  cleared, because afterwards there is nobody left to tell.
++  sitters
  |=  h=held:g
  ^-  (list @p)
  ~(tap in (~(gas in *(set @p)) (turn ~(tap by seats.h) |=([s=seat:g *] who.s))))
::  Everybody who could know about this lease: the people sitting in the room
::  and the note's members, who were told which note it is.
++  told
  |=  h=held:g
  ^-  (list @p)
  =/  here=(set @p)  (~(gas in *(set @p)) (sitters h))
  ?~  door  ~(tap in here)
  ~(tap in (~(uni in here) members.u.door))
++  shown
  |=  h=(unit held:g)
  ^-  (unit lease:g)
  ?~  h  ~
  `[place.u.h note.u.h gen.u.h]
::  One timer, never a pile of them: the outstanding one is cancelled first.
++  arm
  |=  [h=held:g at=@da]
  ^-  [(list card) held:g]
  =/  off=(list card)
    ?~  armed.h  ~
    ~[[%pass /lease %arvo %b %rest u.armed.h]]
  :-  (snoc off [%pass /lease %arvo %b %wait at])
  h(armed `at)
::  Forget seats nobody renewed, and note when the room fell empty.
++  sweep
  |=  h=held:g
  ^-  held:g
  =/  live=(map seat:g @da)
    %-  ~(gas by *(map seat:g @da))
    %+  skim  ~(tap by seats.h)
    |=  [s=seat:g last=@da]
    ::  A stamp in the future is clock skew between two ships, not an expired
    ::  seat -- and `sub` would underflow and crash the agent rather than say so.
    ?:  (gte last now.bowl)  &
    (lth (sub now.bowl last) seat-ttl:g)
  =.  seats.h  live
  ?.  =(0 ~(wyt by live))  h(empty ~)
  ?~(empty.h h(empty `now.bowl) h)
::  When to look again: the soonest seat expiry, or the end of the grace.
++  due
  |=  h=held:g
  ^-  @da
  ?:  =(0 ~(wyt by seats.h))
    (add ?~(empty.h now.bowl u.empty.h) seat-grace:g)
  =/  soonest=@da
    %+  roll  ~(val by seats.h)
    |=  [l=@da acc=@da]
    ?:(=(*@da acc) l (min acc l))
  (add soonest seat-ttl:g)
::  Somebody's tab took, kept, or gave up a seat. A sender may only ever touch
::  its OWN seat: no guest can release a lease, and no guest can evict another.
++  seat-change
  |=  [who=@p =place:g gen=@ud tab=@t what=?(%enter %renew %leave)]
  ^-  (quip card state-15)
  ?~  lease  `state
  =/  h=held:g  u.lease
  ?.  =(place place.h)  `state
  ::  A message about a lease that has since been replaced is about a lease that
  ::  no longer exists. An enter may say 0 for "whichever is current", because a
  ::  newcomer has no way to know the generation yet.
  ?.  |(=(gen gen.h) &(=(0 gen) ?=(%enter what)))  `state
  =/  key=seat:g  [who tab]
  =.  seats.h
    ?:  ?=(%leave what)  (~(del by seats.h) key)
    (~(put by seats.h) key now.bowl)
  =.  h  (sweep h)
  =^  cards  h  (arm h (due h))
  :_  state(lease `h)
  ?.  &(?=(%enter what) !=(who our.bowl))  cards
  (snoc cards (tell who [%seated-ok place gen.h tab]))
++  fact
  |=  upd=update:g
  ^-  card
  [%give %fact ~[/world] %glurff-update !>(upd)]
::  The world's spots as we host them -- apps, then websites -- to `paths`
::  (`~`: to whoever has just started watching).
++  spots-facts
  |=  [paths=(list path) s=(map @tas spot-app:g) w=(map @tas spot-web:g)]
  ^-  (list card)
  :~  [%give %fact paths %glurff-update !>(`update:g`[%spots s])]
      [%give %fact paths %glurff-update !>(`update:g`[%spot-webs w])]
  ==
::  A website for a spot: an https address, and words of a sensible length.
++  web-ok
  |=  web=(unit spot-web:g)
  ^-  ?
  ?~  web  %.y
  ?&  =('https://' (end [3 8] url.u.web))
      (gth (met 3 url.u.web) 8)
      (lte (met 3 url.u.web) spot-url:g)
      (lte (met 3 title.u.web) spot-title:g)
  ==
::  Watch a world host's spots afresh, dropping any older watch of them: the
::  host answers a new watch with its spots straight away.
++  spots-follow
  |=  host=@p
  ^-  (list card)
  %+  snoc
    %+  murn  ~(tap by wex.bowl)
    |=  [[=wire =ship =term] [acked=? =path]]
    ^-  (unit card)
    ?.  ?=([%spots @ *] wire)  ~
    `[%pass wire %agent [ship term] %leave ~]
  [%pass /spots/(scot %p host)/(scot %da now.bowl) %agent [host %glurff] %watch /spots]
::  A spot's app as a host set it: plain names, and nothing too long for every
::  visitor's page to carry.
++  spot-ok
  |=  [id=@tas app=(unit spot-app:g)]
  ^-  ?
  ?.  ?&((gth (met 3 id) 0) (lte (met 3 id) 32) ((sane %tas) id))  %.n
  ?~  app  %.y
  ?&  (gth (met 3 desk.u.app) 0)
      (lte (met 3 desk.u.app) 64)
      ((sane %tas) desk.u.app)
      (lte (met 3 title.u.app) spot-title:g)
      (lte (lent context.u.app) spot-context:g)
      %+  levy  context.u.app
      |=  [k=@t v=@t]
      ?&((gth (met 3 k) 0) (lte (met 3 k) 32) (lte (met 3 v) 200))
  ==
::
::  ---- call plumbing ----
::
::  The room key is a hash over our own tag and the PLACE ALONE.
::
::  Never a generation and never a membership set: generations are counted per
::  client, so folding one in gives two ships different rooms for the same
::  place, and a membership flicker would mint a fresh room and orphan every
::  token already issued. Our own tag keeps us out of %noltbook's namespace.
++  room-key
  |=  =place:g
  ^-  @tas
  =/  raw=@t  (scot %uv (sham [%glurff-room place]))
  `@tas`(crip (skip (trip raw) |=(c=@tD =('.' c))))
::  A STABLE request id for one logical operation, so a retry is an idempotent
::  duplicate at the Warden rather than a second execution.
::  A request id that is STABLE across retries of one join attempt and DIFFERENT
::  across attempts. The Warden answers a repeated id with the saved result, so
::  an id derived from [place op who] alone hands back a stale, expired
::  credential on every later join -- which surfaces as join-refused.
++  call-req
  |=  [=place:g session=@ud op=@tas who=@p]
  ^-  @ud
  `@ud`(sham [place session op who])
::  Opaque correlation, round-tripped untouched. It carries everything needed to
::  route the answer, which is why there is no pending state to keep -- and it
::  must contain no secret, because it reaches the broker.
::  Readable on purpose. The browser checks a grant against the place it is
::  actually standing in before acting on it, so this has to be parseable
::  there. It carries no secret: a place id and a ship, both already public.
++  call-ctx
  |=  [=place:g who=@p attempt=@ud]
  ^-  @t
  =/  base=@t
    (rap 3 (scot %ud place) '/' (scot %p who) '/' (scot %ud attempt) ~)
  ?.  ?&((gth place movement-base:g) (lth place 1.000.000))  base
  (rap 3 base '/' (scot %p our.bowl) ~)
++  calls-watch-card
  ^-  card
  [%pass /glurff-call-diagnostics %agent [our.bowl %noltbook-calls] %watch /diagnostics]
++  calls-watch
  ^-  (list card)
  ?:  (~(has by wex.bowl) [/glurff-call-diagnostics our.bowl %noltbook-calls])  ~
  ~[calls-watch-card]
++  calls-poke
  |=  act=action:gc
  ^-  card
  :*  %pass  /glurff-calls/(scot %da now.bowl)
      %agent  [our.bowl %noltbook-calls]
      %poke  %noltbook-calls-action  !>(act)
  ==
::  ---- THE WORLD ROOM (see `world-room` in /sur) ----
::
::  Somebody asks to be let into our world's relay room. We open it ourselves
::  -- create the room and admit them, in one ordered request -- when it has
::  never been opened, when its lease must have lapsed because nobody has asked
::  for longer than it lasts, or when asks have failed for longer than a room
::  takes to come up. Anything else is an ordinary admission, and the ask
::  extends the lease. A room that may still be working is never opened
::  afresh: that would throw out everybody inside.
::
::  ONE ID PER WINDOW (2026-10-31). Every browser asks at least every two
::  minutes, and each ask used to send two new request ids; the call service
::  counts every new id for a month, and ~nolset ran out (see world-window in
::  /sur). Now an opening's and an admission's id are per person per window
::  and the lease's per window, so a repeated ask is answered from the
::  service's record of the first. Failures are not recorded there, so a
::  failing ask is still really tried each time, under the same id. A success
::  can be repeated after the room has gone, until the window turns: a gone
::  room is noticed within world-window, not at once.
++  world-knock
  |=  who=@p
  ^-  (quip card state-15)
  =/  =place:g  world-place:g
  ::  ONLY THE GLURFF'S MEMBERS (2026-10-31): somebody blocked -- removed from
  ::  its note -- is not let back into the world room. With Noltbook unable to
  ::  say, the room stays as open as it always was.
  =/  gn  glurff-note
  ?:  ?&  ?=(^ gn)  =(creator.u.gn our.bowl)  !=(who our.bowl)
          !(~(has in members.u.gn) who)
      ==
    :_(state ~[(tell who [%refused place %not-a-member])])
  =/  held=(map place:g lock-mode:g)  (~(put by hosting) place %open)
  =/  fresh=?
    ?~  world  %.y
    ?|  (gth now.bowl (add asked.u.world (mul ~s1 movement-ttl:g)))
        ?~(failing.u.world %.n (gth now.bowl (add u.failing.u.world world-reopen:g)))
    ==
  ?:  fresh
    :_  state(hosting held, world `[now.bowl ~])
    :~  %-  calls-poke
        :*  %ensure-access
            (call-req place `@ud`(div now.bowl world-window:g) %ensure who)
            (room-key place)  movement-ttl:g  who  %glurff
            (call-ctx place who 0)
        ==
    ==
  :_  state(hosting held, world `[now.bowl ?~(world ~ failing.u.world)])
  :~  %-  calls-poke
      :*  %renew-access
          (call-req place `@ud`(div now.bowl world-window:g) %access who)
          (room-key place)  who  %glurff
          (call-ctx place who 0)
      ==
      %-  calls-poke
      :*  %renew
          (call-req place `@ud`(div now.bowl world-window:g) %renew our.bowl)
          (room-key place)
          movement-ttl:g
      ==
  ==
::  What became of a request about the world room. Failing because the room is
::  not there starts the clock towards opening it afresh; anybody let in shows
::  it is working, and stops it.
::
::  A lapsed lease (%expired, 2026-10-30) is a room that is not there too. A
::  ~nolset outage longer than the lease left the room dead, and every visitor
::  knocking since renewed the dead room: each knock moved +asked on, so the
::  nobody-has-asked reopen in +world-knock never came either.
++  world-heard
  |=  res=call-result:gc
  ^-  state-15
  ?~  world  state
  ?-    -.res
      %granted
    ?.  (world-context context.res)  state
    state(world `u.world(failing ~))
  ::
      %failed
    ?.  (world-context context.res)  state
    ?.  ?=(?(%room-unavailable %room-ended %expired) err.res)  state
    ?^  failing.u.world  state
    state(world `u.world(failing `now.bowl))
  ==
::  Is this correlation about the world room? See +call-ctx: it starts with
::  the place.
++  world-context
  |=  c=@t
  ^-  ?
  =/  head=tape  (trip (cat 3 (scot %ud world-place:g) '/'))
  =(head (scag (lent head) (trip c)))
::
::  ---- EVERY CALL ON THE GLURFF'S HOST (see `host-call` in /sur) ----
::
::  A room's place or a huddle's. Movement places and the world room are far
::  above call-top.
++  call-place
  |=  =place:g
  ^-  ?
  ?&((gth place 0) (lth place call-top:g))
::  A huddle's place, from the member it elected: the hash huddlePlace in
::  lib/huddle.js makes, which this MUST match. The host checks with it that a
::  huddle's roster comes from the one ship whose place it is.
++  huddle-place
  |=  who=@p
  ^-  @ud
  =/  key=tape  (scow %p who)
  =/  h=@  0x811c.9dc5
  |-  ^-  @ud
  ?~  key  (add huddle-base:g (mod h 900.000))
  =.  h  (end [0 32] (mul (mix h i.key) 0x100.0193))
  $(key t.key, h (mix h (rsh [0 13] h)))
::  THE GLURFF'S NOTE, read from our own Noltbook: who created it, who is in
::  it, its admins -- the Glurff's moderators -- who it has muted, and who it
::  has removed: blocked from the Glurff. `~` when we have no such note or
::  Noltbook cannot say, and then we host no calls. Read through Noltbook's
::  published API, as a browser would; nothing in Noltbook changes.
+$  gnote  [creator=@p members=(set @p) mods=(set @p) muted=(set @p) removed=(set @p)]
::  It is the note of the world we host, if we host one (`home`); else the
::  official world's, whose host is whoever created it.
::  An area's place: a room of any world's map (1-999), below the huddles.
::  The official map's are 1-15 and Vatican City 900; a world's document
::  numbers its own (world/world-doc.js), keeping 13 for Rumors.
++  area-place  |=(p=@ud ?&((gth p 0) (lth p huddle-base:g)))
++  glurff-note  (note-read ?~(home world-note:g note.u.home))
::  ...and the same of any note: the note a world we host is (see `home`).
++  note-read
  |=  id=@ta
  ^-  (unit gnote)
  =/  base=path
    :~  (scot %p our.bowl)  %noltbook  (scot %da now.bowl)
        %api  %notes  id
    ==
  =/  meta  (mule |.(.^(json %gx (weld base /meta/json))))
  ?:  ?=(%| -.meta)  ~
  =/  creator=(unit @p)
    ?.  ?=([%o *] p.meta)  ~
    =/  c  (~(get by p.p.meta) 'creator')
    ?.  ?=([~ %s *] c)  ~
    (slaw %p p.u.c)
  ?~  creator  ~
  =/  mem  (mule |.(.^(json %gx (weld base /members/json))))
  ?:  ?=(%| -.mem)  ~
  =/  rows=(list json)
    ?.  ?=([%o *] p.mem)  ~
    =/  m  (~(get by p.p.mem) 'members')
    ?.  ?=([~ %a *] m)  ~
    p.u.m
  =|  members=(set @p)
  =|  mods=(set @p)
  =|  muted=(set @p)
  =|  removed=(set @p)
  |-  ^-  (unit gnote)
  ?~  rows  `[u.creator members mods muted removed]
  =/  row=json  i.rows
  ?.  ?=([%o *] row)  $(rows t.rows)
  =/  ship  (~(get by p.row) 'ship')
  =/  who=(unit @p)  ?.(?=([~ %s *] ship) ~ (slaw %p p.u.ship))
  ?~  who  $(rows t.rows)
  ?:  =(`[%b %.y] (~(get by p.row) 'removed'))
    $(rows t.rows, removed (~(put in removed) u.who))
  %=  $
    rows     t.rows
    members  (~(put in members) u.who)
    mods     ?.(=(`[%s 'admin'] (~(get by p.row) 'role')) mods (~(put in mods) u.who))
    muted    ?.(=(`[%b %.y] (~(get by p.row) 'muted')) muted (~(put in muted) u.who))
  ==
::  Participants gone: out of the call, no longer admins, and no longer
::  recording. The revision moves when the record everybody sees does.
++  call-drop
  |=  [c=host-call:g gone=(list @p)]
  ^-  host-call:g
  =/  next=host-call:g
    %+  roll  gone
    |=  [who=@p acc=_c]
    %=  acc
      seen       (~(del by seen.acc) who)
      admins     (~(del in admins.acc) who)
      recording  ?:(?&(?=(^ recording.acc) =(by.u.recording.acc who)) ~ recording.acc)
    ==
  ?:  ?&(=(admins.next admins.c) =(recording.next recording.c))  next
  next(rev +(rev.c))
::  NOBODY LEFT TO RUN IT. When none of a call's own admins is in it any more,
::  the lowest @p still in it becomes one. The Glurff's host and its
::  moderators are not counted either way: they are admins of every call.
++  call-succeed
  |=  [c=host-call:g mods=(set @p)]
  ^-  host-call:g
  ?:  (~(any in admins.c) |=(a=@p (~(has by seen.c) a)))  c
  =/  pool=(list @p)
    %+  sort
      %+  skip  ~(tap in ~(key by seen.c))
      |=(s=@p ?|(=(s our.bowl) (~(has in mods) s) (~(has in booted.c) s)))
    lth
  ?~  pool  c
  c(admins (~(put in admins.c) i.pool), rev +(rev.c))
::  Everybody we have not heard from for call-gone has left the call.
++  call-sweep
  |=  [c=host-call:g mods=(set @p)]
  ^-  host-call:g
  =/  gone=(list @p)
    %+  murn  ~(tap by seen.c)
    |=  [who=@p last=@da]
    ^-  (unit @p)
    ::  A stamp in the future is clock skew, not a lapse -- and `sub` would
    ::  underflow.
    ?:  (gte last now.bowl)  ~
    ?:  (lth (sub now.bowl last) call-gone:g)  ~
    `who
  ?~  gone  c
  (call-succeed (call-drop c gone) mods)
::  The record, as everybody in the call is told it.
++  call-snap-of
  |=  [c=host-call:g gn=gnote]
  ^-  call-snap:g
  :*  inc.c  rev.c  admins.c  mods.gn  muted.c
      (~(int in muted.gn) ~(key by seen.c))
      booted.c  recording.c
  ==
::  ...to each ship named: our own page as a fact, anybody else's agent by
::  poke.
++  call-tell
  |=  [=place:g snap=call-snap:g to=(list @p)]
  ^-  (list card)
  %+  turn  to
  |=  who=@p
  ^-  card
  ?:  =(who our.bowl)  (fact [%call-mod-snap our.bowl place snap])
  (tell who [%call-mod-snap place snap])
::  ...to everybody in the call, and to `also`.
++  call-publish
  |=  [=place:g c=host-call:g gn=gnote also=(list @p)]
  ^-  (list card)
  %^  call-tell  place  (call-snap-of c gn)
  ~(tap in (~(gas in ~(key by seen.c)) also))
::  A knock turned away, said to the knocker, with why.
++  call-refuse
  |=  [who=@p =place:g attempt=@ud why=@tas]
  ^-  card
  ?:  =(who our.bowl)  (fact [%call-refused our.bowl place attempt why])
  (tell who [%call-refused place attempt why])
::  Calls nothing has happened to for a day are forgotten.
++  call-prune
  |=  all=(map place:g host-call:g)
  ^-  (map place:g host-call:g)
  %-  malt
  %+  skip  ~(tap by all)
  |=([p=place:g c=host-call:g] (gth now.bowl (add touched.c ~d1)))
::  WHAT THE CALL SERVER IS TOLD (2026-10-31). Everybody in a call who is
::  muted -- by this call's admins, or in the whole Glurff by its note -- is
::  kept quiet there, and nobody else is; the server is told only of a change,
::  so a mute of one kind never lifts the other. Anybody in the call who is no
::  longer in the Glurff is put out of it. The revision moves when who is quiet
::  does, so every browser hears.
++  call-reconcile
  |=  [=place:g c=host-call:g gn=gnote]
  ^-  [(list card) host-call:g]
  =/  out=(list @p)
    %+  skip  ~(tap in ~(key by seen.c))
    |=(s=@p ?|(=(s our.bowl) (~(has in members.gn) s)))
  =/  evict=(list card)
    %+  turn  out
    |=  s=@p
    %-  calls-poke
    [%evict (call-req place `@ud`(sham [place s %out now.bowl]) %evict s) (room-key place) s]
  =.  c  ?~(out c (call-succeed (call-drop c out) mods.gn))
  =/  here=(set @p)  ~(key by seen.c)
  =/  want=(set @p)  (~(int in (~(uni in muted.c) muted.gn)) here)
  =/  hush=(list @p)  ~(tap in (~(dif in want) quiet.c))
  =/  free=(list @p)  ~(tap in (~(dif in (~(int in quiet.c) here)) want))
  =/  at  |=(s=@p `@ud`(sham [place s now.bowl]))
  =/  cards=(list card)
    ;:  weld
      evict
      %+  turn  hush
      |=  s=@p
      %-  calls-poke
      :*  %mute-access  (call-req place (at s) %mute-access s)
          (room-key place)  s  %glurff  (call-ctx place s (at s))
      ==
      %+  turn  free
      |=  s=@p
      %-  calls-poke
      :*  %unmute-access  (call-req place (at s) %unmute-access s)
          (room-key place)  s  %glurff  (call-ctx place s (at s))
      ==
    ==
  =/  quiet=(set @p)  (~(uni in (~(dif in quiet.c) (silt free))) (silt hush))
  ?:  =(quiet quiet.c)  [cards c]
  [cards c(quiet quiet, rev +(rev.c))]
::  SOMEBODY ASKS FOR A CALL: a room's or a huddle's.
::
::  Decided here and nowhere else, with no browser asked. Anybody in the
::  Glurff may be in a room's call; only those its elected member registered
::  may be in a huddle's; nobody removed from a call gets back in while it
::  lasts. The first one into an empty call starts a new run of it and is its
::  admin -- for a huddle, the member it elected, whoever asks first.
::
::  Request ids are the browser's attempt, which is fresh for every join and
::  every renewal and the same across retries of one -- never a window, as the
::  world room's are: a mute reissues somebody's credentials, and a renewal
::  answered from a record made before it would hand back the ones it revoked.
++  call-knock
  |=  [who=@p =place:g attempt=@ud mode=@tas]
  ^-  (quip card state-15)
  ?.  (call-place place)  `state
  ?.  ?|(=(%access mode) =(%renew-access mode))  `state
  =/  gn  glurff-note
  ?~  gn  :_(state ~[(call-refuse who place attempt %not-hosting)])
  ?.  =(creator.u.gn our.bowl)
    :_(state ~[(call-refuse who place attempt %not-hosting)])
  ?.  |(=(who our.bowl) (~(has in members.u.gn) who))
    :_(state ~[(call-refuse who place attempt %not-a-member)])
  =/  c=host-call:g
    (call-sweep (~(gut by calls) place *host-call:g) mods.u.gn)
  =.  touched.c  now.bowl
  =/  huddle=?  (gte place huddle-base:g)
  =/  why=(unit @tas)
    ?:  ?&(huddle ?=(~ roster.c))  `%not-yet
    ?:  ?&(huddle ?=(^ roster.c) !(~(has in u.roster.c) who))  `%not-in-huddle
    ?:  ?&(!=(~ seen.c) (~(has in booted.c) who))  `%booted
    ~
  ?^  why
    :_  state(calls (~(put by calls) place c))
    ~[(call-refuse who place attempt u.why)]
  ::  An empty call: a new run of it, started by `who` -- or, for a huddle, by
  ::  the member it elected.
  =/  fresh=?  =(~ seen.c)
  =?  c  fresh
    =/  by=@p
      ?.  huddle  who
      ?~  roster.c  who
      =/  own=(list @p)
        (skim ~(tap in u.roster.c) |=(s=@p =(place (huddle-place s))))
      ?~(own who i.own)
    c(inc +(inc.c), rev +(rev.c), admins (silt ~[by]), muted ~, booted ~, recording ~)
  =/  new=?  !(~(has by seen.c) who)
  =.  seen.c  (~(put by seen.c) who now.bowl)
  ::  The call server's room: opened when it may not be there any more, as the
  ::  world room is; otherwise this admission extends its lease.
  =/  open=?
    ?|  =(*@da asked.c)
        (gth now.bowl (add asked.c (mul ~s1 movement-ttl:g)))
        ?~(failing.c %.n (gth now.bowl (add u.failing.c world-reopen:g)))
    ==
  ::  WHO IS KEPT QUIET. A room that may have been made afresh has forgotten
  ::  its mutes, so anybody who should be muted is muted again. Somebody who
  ::  comes in muted, or comes back no longer muted, has that done with their
  ::  own attempt in place of plain access -- the only grant their page takes,
  ::  and the call server's mute or unmute issues one.
  =/  want=(set @p)  (~(uni in muted.c) muted.u.gn)
  =?  quiet.c  open  (~(dif in quiet.c) want)
  =/  hush=?  ?&((~(has in want) who) !(~(has in quiet.c) who))
  =/  free=?  ?&((~(has in quiet.c) who) !(~(has in want) who))
  ::  Each tagged action built on its own: a computed tag inside one tuple
  ::  does not nest in the calls action union.
  =/  self=(list card)
    ?:  hush
      :~  %-  calls-poke
          :*  %mute-access
              (call-req place attempt %mute-access who)
              (room-key place)  who  %glurff
              (call-ctx place who attempt)
          ==
      ==
    ?.  free  ~
    :~  %-  calls-poke
        :*  %unmute-access
            (call-req place attempt %unmute-access who)
            (room-key place)  who  %glurff
            (call-ctx place who attempt)
        ==
    ==
  =/  access=(list card)
    ?:  ?&(?=(^ self) open)
      :_  self
      %-  calls-poke
      [%ensure (call-req place attempt %ensure who) (room-key place) movement-ttl:g]
    ?^  self
      %+  snoc  self
      %-  calls-poke
      :*  %renew
          (call-req place `@ud`(div now.bowl world-window:g) %renew our.bowl)
          (room-key place)
          movement-ttl:g
      ==
    ?:  open
      :~  %-  calls-poke
          :*  %ensure-access
              (call-req place attempt %ensure who)
              (room-key place)  movement-ttl:g  who  %glurff
              (call-ctx place who attempt)
          ==
      ==
    :~  ?:  =(%renew-access mode)
          %-  calls-poke
          :*  %renew-access
              (call-req place attempt %renew-access who)
              (room-key place)  who  %glurff
              (call-ctx place who attempt)
          ==
        %-  calls-poke
        :*  %access
            (call-req place attempt %access who)
            (room-key place)  who  %glurff
            (call-ctx place who attempt)
        ==
        %-  calls-poke
        :*  %renew
            (call-req place `@ud`(div now.bowl world-window:g) %renew our.bowl)
            (room-key place)
            movement-ttl:g
        ==
    ==
  =.  asked.c  now.bowl
  =?  failing.c  open  ~
  =/  was=@ud  rev.c
  =?  c  hush  c(quiet (~(put in quiet.c) who), rev +(rev.c))
  =?  c  free  c(quiet (~(del in quiet.c) who), rev +(rev.c))
  ::  Everybody else as the record and the note now say, and anybody who has
  ::  left the Glurff put out.
  =^  enforce  c  (call-reconcile place c u.gn)
  ::  The record to everybody in a call that has just started or changed, and
  ::  to a newcomer to one already going.
  =/  told=(list card)
    ?:  |(fresh !=(was rev.c))  (call-publish place c u.gn ~)
    ?.  new  ~
    (call-tell place (call-snap-of c u.gn) ~[who])
  :_  state(calls (call-prune (~(put by calls) place c)))
  :(weld access enforce told)
::  Somebody has left a call. Leaving gives up admin, and a call left with no
::  admin of its own gets the next one.
++  call-leave
  |=  [who=@p =place:g]
  ^-  (quip card state-15)
  ?.  (call-place place)  `state
  =/  c0=(unit host-call:g)  (~(get by calls) place)
  ?~  c0  `state
  ?.  (~(has by seen.u.c0) who)  `state
  =/  gn  glurff-note
  =/  note=gnote  ?~(gn *gnote u.gn)
  =/  c=host-call:g  (call-succeed (call-drop u.c0 ~[who]) mods.note)
  =.  touched.c  now.bowl
  :_  state(calls (~(put by calls) place c))
  ?:  =(rev.c rev.u.c0)  ~
  (call-publish place c note ~)
::  A MODERATION REQUEST, judged by the ship that sent it and never by
::  anything in it -- or, with op %sync, somebody in the call asking for the
::  record.
::
::  Everybody has a rank: the Glurff's host, then its moderators, then the
::  call's own admins, then everybody else. An admin of any rank may act only
::  on somebody of a lower one, and never on themselves. That is Noltbook's
::  rule with one difference, on purpose: a Glurff's moderator outranks a
::  call's admins, where Noltbook ranks a note's admins and a call's together.
++  call-mod
  |=  [actor=@p =place:g inc=@ud target=@p op=@tas]
  ^-  (quip card state-15)
  ?.  (call-place place)  `state
  =/  c0=(unit host-call:g)  (~(get by calls) place)
  ?~  c0  `state
  =/  gn  glurff-note
  =/  note=gnote  ?~(gn *gnote u.gn)
  =/  mods=(set @p)  mods.note
  =/  c=host-call:g  (call-sweep u.c0 mods)
  =/  here=?  (~(has by seen.c) actor)
  ?:  =(%sync op)
    :_  state(calls (~(put by calls) place c))
    ?.  here  ~
    (call-tell place (call-snap-of c note) ~[actor])
  ::  Nobody is moderated while the note cannot be read: it is who is in the
  ::  Glurff, and +call-reconcile would take an empty one to mean nobody.
  ?~  gn  `state(calls (~(put by calls) place c))
  ?.  ?&(here =(inc inc.c))  `state(calls (~(put by calls) place c))
  =/  rank
    |=  s=@p
    ^-  @ud
    ?:  =(s our.bowl)  3
    ?:  (~(has in mods) s)  2
    ?:((~(has in admins.c) s) 1 0)
  =/  mine=@ud  (rank actor)
  =/  next=(unit host-call:g)
    ?:  =(%record-start op)
      ?.  ?&((gte mine 1) ?=(~ recording.c))  ~
      `c(recording `[actor now.bowl])
    ?:  =(%record-stop op)
      ?~  recording.c  ~
      ?.  |(=(actor by.u.recording.c) (gth mine (rank by.u.recording.c)))  ~
      `c(recording ~)
    ?.  ?&((gte mine 1) !=(target actor) (gth mine (rank target)))  ~
    ?+  op  ~
        %promote
      ?.  ?&((~(has by seen.c) target) =(0 (rank target)))  ~
      `c(admins (~(put in admins.c) target))
    ::
        %demote
      ?.  (~(has in admins.c) target)  ~
      `c(admins (~(del in admins.c) target))
    ::
        %mute
      ?:  (~(has in muted.c) target)  ~
      `c(muted (~(put in muted.c) target))
    ::
        %unmute
      ?.  (~(has in muted.c) target)  ~
      `c(muted (~(del in muted.c) target))
    ::
        %boot
      ?:  (~(has in booted.c) target)  ~
      `(call-drop c(booted (~(put in booted.c) target)) ~[target])
    ::
        %unboot
      ?.  (~(has in booted.c) target)  ~
      `c(booted (~(del in booted.c) target))
    ==
  ?~  next  `state(calls (~(put by calls) place c))
  =/  done=host-call:g
    =/  n=host-call:g  u.next(rev +(rev.c), touched now.bowl)
    ?.(=(%boot op) n (call-succeed n mods))
  ::  Made true on the call server, not only in everybody's browser: a boot
  ::  puts them out, and a mute or an unmute goes through +call-reconcile, so
  ::  unmuting here never lifts a mute the whole Glurff has put on them.
  =/  at=@ud  `@ud`(sham [place target op now.bowl])
  =/  out=(list card)
    ?.  =(%boot op)  ~
    :~  %-  calls-poke
        [%evict (call-req place at %evict target) (room-key place) target]
    ==
  =^  enforce  done  (call-reconcile place done note)
  ::  Whoever was removed or let back in is told too: they are not in the
  ::  call, so the record would not reach them otherwise, and being let back
  ::  in is what puts them back in it (2026-11-01).
  :_  state(calls (~(put by calls) place done))
  ;:  weld  out  enforce
    (call-publish place done note ?:(|(=(%boot op) =(%unboot op)) ~[target] ~))
  ==
::  A HUDDLE'S ROSTER, from the member it elected -- the one ship whose name
::  its place is made from. Only those on it may be in its call; anybody in
::  the call who is not on it any more has left it. An empty roster ends it.
++  call-roster
  |=  [who=@p =place:g ships=(set @p)]
  ^-  (quip card state-15)
  ?.  ?&((gte place huddle-base:g) (lth place call-top:g))  `state
  ?.  =(place (huddle-place who))  `state
  ?:  (gth ~(wyt in ships) 32)  `state
  =/  gn  glurff-note
  ?~  gn  `state
  ?.  =(creator.u.gn our.bowl)  `state
  =/  members=(set @p)  (~(put in members.u.gn) our.bowl)
  ?.  (~(has in members) who)  `state
  =/  kept=(set @p)  (~(int in ships) members)
  =/  c0=host-call:g  (~(gut by calls) place *host-call:g)
  =/  c=host-call:g
    %+  call-succeed
      %+  call-drop  c0(roster ?~(kept ~ `kept), touched now.bowl)
      ~(tap in (~(dif in ~(key by seen.c0)) kept))
    mods.u.gn
  :_  state(calls (call-prune (~(put by calls) place c)))
  ?:  =(rev.c rev.c0)  ~
  (call-publish place c u.gn ~)
::  PUT SOMEBODY'S STANDING INTO EFFECT NOW (2026-10-31), asked by the
::  Glurff's host or one of its moderators after changing it in the note.
::  Every call is reconciled with the note as it stands -- mutes applied or
::  lifted, anybody no longer in the Glurff put out -- and somebody removed is
::  put out of the world room too. Every call's record goes out again, so an
::  admin made or unmade is heard in calls already going. Nothing is decided
::  here that the note does not already say.
++  call-recheck
  |=  [actor=@p who=@p]
  ^-  (quip card state-15)
  =/  gn  glurff-note
  ?~  gn  `state
  ?.  =(creator.u.gn our.bowl)  `state
  ?.  |(=(actor our.bowl) (~(has in mods.u.gn) actor))  `state
  =/  places=(list place:g)  ~(tap in ~(key by calls))
  =|  cards=(list card)
  |-  ^-  (quip card state-15)
  ?~  places
    :_  state
    ?.  (~(has in removed.u.gn) who)  cards
    :_  cards
    %-  calls-poke
    :*  %evict
        (call-req world-place:g `@ud`(sham [who %world now.bowl]) %evict who)
        (room-key world-place:g)
        who
    ==
  =/  c=host-call:g  (~(got by calls) i.places)
  ?:  =(~ seen.c)  $(places t.places)
  =/  was=@ud  rev.c
  =^  more  c  (call-reconcile i.places c u.gn)
  =?  c  =(rev.c was)  c(rev +(rev.c))
  =/  told=(list card)  (call-publish i.places c u.gn ~)
  %=  $
    places  t.places
    calls   (~(put by calls) i.places c)
    cards   :(weld cards more told)
  ==
::  What became of a request about one of our calls, kept as +world-heard
::  keeps the world room's.
++  call-heard
  |=  res=call-result:gc
  ^-  state-15
  =/  at=(unit place:g)  (ctx-place context.res)
  ?~  at  state
  ?.  (call-place u.at)  state
  =/  c=(unit host-call:g)  (~(get by calls) u.at)
  ?~  c  state
  ?-    -.res
      %granted  state(calls (~(put by calls) u.at u.c(failing ~)))
  ::
      %failed
    ?.  ?=(?(%room-unavailable %room-ended %expired) err.res)  state
    ?^  failing.u.c  state
    state(calls (~(put by calls) u.at u.c(failing `now.bowl)))
  ==
::  The place a correlation is about: +call-ctx starts with it.
++  ctx-place
  |=  ctx=@t
  ^-  (unit place:g)
  =/  txt=tape  (trip ctx)
  =/  cut=(unit @ud)  (find "/" txt)
  ?~  cut  ~
  (slaw %ud (crip (scag u.cut txt)))
::
::  Route one completed grant. A failure carries no secret and goes to our own
::  browser; a credential goes to exactly one ship and never to a fact anyone
::  else can watch.
++  grant-cards
  |=  res=call-result:gc
  ^-  (list card)
  ?-    -.res
      %failed
    =/  local=card  [%give %fact ~[/call-access] %glurff-access !>(res)]
    ?~  who.res  ~[local]
    ?:  =(u.who.res our.bowl)  ~[local]
    :~  local
        :*  %pass  /glurff-out/(scot %p u.who.res)
            %agent  [u.who.res %glurff]  %poke
            %glurff-grant  !>(res)
        ==
    ==
  ::
      %granted
    =/  who=@p  participant.access.res
    ?:  =(who our.bowl)
      ~[[%give %fact ~[/call-access] %glurff-access !>(res)]]
    :~  :*  %pass  /glurff-out/(scot %p who)
            %agent  [who %glurff]  %poke
            %glurff-grant  !>(res)
        ==
    ==
  ==
::
::  ---- THE WORLD AS DATA (see `home` in /sur) ----
::
::  A request for the world API or for a host's assets, not for the page.
++  world-url
  |=  url=@t
  ^-  ?
  ?|  =('/apps/glurff/api/' (end [3 17] url))
      =('/apps/glurff/world/' (end [3 19] url))
  ==
::  An answer to a browser: some JSON with a status, or a list of errors.
++  answer
  |=  [id=@ta p=simple-payload:http]
  ^-  (list card)
  (give-simple-payload:app:server id p)
++  json-out
  |=  [code=@ud j=json]
  ^-  simple-payload:http
  :_  `(json-to-octs:server j)
  [code ~[['content-type' 'application/json'] ['cache-control' 'no-store']]]
++  error-out
  |=  [code=@ud why=(list @t)]
  ^-  simple-payload:http
  (json-out code (pairs:enjs:format ~[['errors' a+(turn why |=(t=@t s+t))]]))
::  An asset's bytes. Its URL is its hash, so it can never change.
++  asset-payload
  |=  [mime=@t =octs]
  ^-  simple-payload:http
  :_  `octs
  :-  200
  :~  ['content-type' mime]
      ['cache-control' 'private, max-age=31536000, immutable']
      ['x-content-type-options' 'nosniff']
  ==
++  get-arg
  |=  [args=(list [key=@t value=@t]) k=@t]
  ^-  (unit @t)
  =/  hit  (skim args |=([key=@t value=@t] =(key k)))
  ?~(hit ~ `value.i.hit)
++  get-num
  |=  [args=(list [key=@t value=@t]) k=@t]
  ^-  (unit @ud)
  (biff (get-arg args k) (curr rush dem))
::  The type of a body, without its parameters.
++  content-type
  |=  heads=header-list:http
  ^-  @t
  =/  hit
    %+  skim  heads
    |=([key=@t value=@t] =('content-type' (crip (cass (trip key)))))
  ?~  hit  ''
  =/  v=tape  (cass (trip value.i.hit))
  =/  semi  (find ";" v)
  (crip (scag ?~(semi (lent v) u.semi) v))
::
::  OUR OWN BROWSER, and nobody else's: the host's API, and assets of any
::  host's world. A visitor's page fetches another host's assets through its
::  own agent, never through the host's.
++  world-http
  |=  [id=@ta req=inbound-request:eyre]
  ^-  (quip card state-15)
  ?.  ?&(authenticated.req =(src.bowl our.bowl))
    [(answer id (login-redirect:gen:server request.req)) state]
  =/  line  (parse-request-line:server url.request.req)
  =/  =method:http  method.request.req
  ?+    site.line  [(answer id not-found:gen:server) state]
      [%apps %glurff %api *]
    (api-http id method t.t.t.site.line args.line request.req)
  ::
      [%apps %glurff %world @ %asset @ ~]
    ?.  ?=(?(%'GET' %'HEAD') method)  [(answer id [[405 ~] ~]) state]
    =/  host=(unit @p)  (slaw %p i.t.t.t.site.line)
    =/  h=(unit hash:g)  (unhex:gw i.t.t.t.t.t.site.line)
    ?.  ?&(?=(^ host) ?=(^ h))  [(answer id not-found:gen:server) state]
    ::  By poke, unless asked otherwise: over classic Ames the host's
    ::  answer in one message measured two to four times faster than
    ::  encrypted remote scry (2026-11-05). Scry stays, for when it isn't.
    =/  =via:g  ?:(=(`'scry' (get-arg args.line 'via')) %scry %poke)
    (asset-get id u.host u.h via)
  ==
::  THE HOST'S API. What it hosts is readable once it hosts a world; the
::  rest only once its operator has turned editing on (see `operate`).
::
::    GET  /apps/glurff/api/home            hosting? its note, draft, live
::    PUT  /apps/glurff/api/asset           keep some bytes; their hash
::    GET  /apps/glurff/api/draft           the draft's revision and document
::    PUT  /apps/glurff/api/draft?base=N    save a document over revision N
::    POST /apps/glurff/api/publish?rev=N   check draft N and make it live
::    POST /apps/glurff/api/live?release=N  give visitors release N again
::                                          (0: none -- see `api-http`)
::    GET  /apps/glurff/api/releases        every release
::    POST /apps/glurff/api/forget?release=N  delete release N, not the live
::                                          one (see `forget`)
++  api-http
  |=  [id=@ta =method:http rest=(list @t) args=(list [key=@t value=@t]) =request:http]
  ^-  (quip card state-15)
  =/  out  |=(p=simple-payload:http [(answer id p) state])
  ?:  =(~['home'] rest)
    ?.  ?=(%'GET' method)  (out [[405 ~] ~])
    (out (json-out 200 home-json))
  ::  EVERYBODY BUILDS (2026-11-10): EDIT GLURFF on our own profile card
  ::  makes us a host and turns editing on, from our own browser, with no
  ::  note yet -- nothing of it anywhere but here until it is first
  ::  published, when the editor makes its note and gives it to us (`note`).
  ::  As `%host` from Dojo does, the first time; Dojo's is still the way to
  ::  host a note that exists already.
  ?:  =(~['start'] rest)
    ?.  ?=(%'POST' method)  (out [[405 ~] ~])
    =/  was=?  ?=(^ home)
    =.  home  ?~(home `[*@ta & ~ ~ ~ ~ ~] `u.home(edit &))
    :_  state
    %+  weld  (answer id (json-out 200 home-json))
    ^-  (list card)
    ?:  was  ~
    ~[[%pass /world-coop %germ world-coop:g]]
  ?~  home  (out (error-out 404 ~['this ship hosts no world']))
  ?.  edit.u.home  (out (error-out 403 ~['editing is not turned on for this world']))
  ?+    rest  (out not-found:gen:server)
      [%listing ~]
    ::  WHERE OUR PUBLISH LISTS OUR GLURFF (2026-11-08): ?ship=~x, or
    ::  ?ship=none for nowhere.
    ?.  ?=(%'POST' method)  (out [[405 ~] ~])
    =/  arg  (get-arg args 'ship')
    ?~  arg  (out (error-out 400 ~['which ship?']))
    =/  to=(unit (unit @p))  ?:(=('none' u.arg) `~ (bind (slaw %p u.arg) some))
    ?~  to  (out (error-out 400 ~['not a ship']))
    =.  listing  u.to
    [(answer id (json-out 200 home-json)) state]
  ::
      [%note ~]
    ::  ITS NOTE, made by the editor at its first publish: a note of ours,
    ::  given once, to a world that has none yet.
    ?.  ?=(%'POST' method)  (out [[405 ~] ~])
    ?.  =('' note.u.home)  (out (error-out 409 ~['this world has its note already']))
    =/  arg  (get-arg args 'id')
    ?~  arg  (out (error-out 400 ~['which note?']))
    ?.  ((sane %ta) u.arg)  (out (error-out 400 ~['that is not a note']))
    =/  nid=@ta  ;;(@ta u.arg)
    =/  gn  (note-read nid)
    ?.  ?&(?=(^ gn) =(creator.u.gn our.bowl))
      (out (error-out 422 ~['that is not a note of ours']))
    =.  note.u.home  nid
    :_  state
    (weld card-facts (answer id (json-out 200 home-json)))
  ::
      [%asset ~]
    ?.  ?=(?(%'PUT' %'POST') method)  (out [[405 ~] ~])
    (asset-put id request)
  ::
      [%draft ~]
    ?:  ?=(%'GET' method)  (out (json-out 200 (draft-json draft.u.home)))
    ?.  ?=(%'PUT' method)  (out [[405 ~] ~])
    (draft-put id (get-num args 'base') request)
  ::
      [%publish ~]
    ?.  ?=(%'POST' method)  (out [[405 ~] ~])
    (publish id (get-num args 'rev'))
  ::
      [%live ~]
    ?.  ?=(%'POST' method)  (out [[405 ~] ~])
    =/  n=(unit @ud)  (get-num args 'release')
    ::  Release 0 is none: visitors are given no release of ours -- the
    ::  official world's fall back to the copy their app carries. The way
    ::  back, should a published world misbehave (2026-11-05).
    ?:  =(`0 n)
      =.  live.u.home  ~
      :_  state
      ;:  weld
        (list-cards |)
        card-facts
        (answer id (json-out 200 (pairs:enjs:format ~[['release' ~]])))
      ==
    ?.  ?&(?=(^ n) (~(has by releases.u.home) u.n))
      (out (error-out 404 ~['no such release']))
    =.  live.u.home  n
    :_  state
    ;:  weld
      (list-cards &)
      card-facts
      (answer id (json-out 200 (pairs:enjs:format ~[['release' (numb:enjs:format u.n)]])))
    ==
  ::
      [%releases ~]
    (out (json-out 200 releases-json))
  ::
      [%forget ~]
    ?.  ?=(%'POST' method)  (out [[405 ~] ~])
    (forget id (get-num args 'release'))
  ==
::  KEEP SOME BYTES: an image a browser can draw but not run, or a JSON
::  document, within the store's limits -- checked here, whatever the editor
::  checked. The same bytes twice are kept once.
++  asset-put
  |=  [id=@ta =request:http]
  ^-  (quip card state-15)
  ?>  ?=(^ home)
  =/  out  |=(p=simple-payload:http [(answer id p) state])
  ?~  body.request  (out (error-out 400 ~['no bytes']))
  =/  =octs  u.body.request
  ?:  =(0 p.octs)  (out (error-out 400 ~['no bytes']))
  ?:  (gth p.octs asset-max:g)  (out (error-out 413 ~['too big for a world']))
  =/  mime=@t  (content-type header-list.request)
  ?.  (~(has in mimes:gw) mime)
    (out (error-out 415 ~[(rap 3 'not a kind of file a world keeps: ' mime ~)]))
  =/  pic=?  (image:gw mime)
  ::  a sound (2026-11-08): small, and what it says it is
  =/  snd=?  (audio:gw mime)
  ?:  ?&(snd (gth p.octs sound-max:gw))  (out (error-out 413 ~['a sound is at most 2 MB']))
  ?:  ?&(snd !(sound-ok:gw mime octs))  (out (error-out 415 ~['not a readable sound']))
  =/  dims=(unit [w=@ud h=@ud])  ?.(pic ~ (image-size:gw mime octs))
  ?:  ?&(pic ?=(~ dims))  (out (error-out 415 ~['not a readable image']))
  ?:  ?&  ?=(^ dims)
          ?|  =(0 w.u.dims)  =(0 h.u.dims)
              (gth w.u.dims side-max:gw)  (gth h.u.dims side-max:gw)
              (gth (mul w.u.dims h.u.dims) pixels-max:gw)
          ==
      ==
    (out (error-out 413 ~['the image is too large']))
  ?:  ?&(!pic !snd ?=(~ (de:json:html q.octs)))  (out (error-out 400 ~['not JSON']))
  =/  h=hash:g  (hash-of:gw octs)
  =/  had=?  (~(has by assets.u.home) h)
  ::  Room for it (2026-11-08): what nothing has wanted lately goes first.
  =?  u.home  ?&(!had (crowded u.home p.octs))  (tidy u.home in-flight:g ~)
  ?:  ?&(!had (gte ~(wyt by assets.u.home) assets-max:g))
    (out (error-out 507 ~['the store is full']))
  ?:  ?&(!had (gth (add (stored u.home) p.octs) store-max:g))
    (out (error-out 507 ~['this world is full: it keeps at most 200 MB of pictures and sounds']))
  ::  The same bytes again are wanted again: their day starts over.
  =.  assets.u.home
    ?:  had  (~(jab by assets.u.home) h |=(a=asset:g a(at now.bowl)))
    (~(put by assets.u.home) h [mime p.octs q.octs now.bowl])
  :_  state
  %+  weld  ?:(had ~ tidy-cards)
  %+  answer  id
  %+  json-out  200
  %-  pairs:enjs:format
  :~  ['hash' s+(hex:gw h)]
      ['mime' s+mime]
      ['size' (numb:enjs:format p.octs)]
      ['w' ?~(dims ~ (numb:enjs:format w.u.dims))]
      ['h' ?~(dims ~ (numb:enjs:format h.u.dims))]
  ==
::  SAVE THE DRAFT. A save from an older revision than ours would throw away
::  what was saved since, so it is refused with the revision it missed. The
::  document it replaces is let go unless a release still uses it.
++  draft-put
  |=  [id=@ta base=(unit @ud) =request:http]
  ^-  (quip card state-15)
  ?>  ?=(^ home)
  =/  out  |=(p=simple-payload:http [(answer id p) state])
  =/  rev=@ud  ?~(draft.u.home 0 rev.u.draft.u.home)
  ?.  =(base `rev)  (out (stale rev))
  ?~  body.request  (out (error-out 400 ~['no document']))
  =/  =octs  u.body.request
  ?:  (gth p.octs asset-max:g)  (out (error-out 413 ~['the document is too big']))
  =/  doc=(unit json)  (de:json:html q.octs)
  ?~  doc  (out (error-out 400 ~['not JSON']))
  ?~  (schema-of:gw u.doc)  (out (error-out 422 ~['the document says no schema']))
  =/  h=hash:g  (hash-of:gw octs)
  =?  assets.u.home
      ?&  ?=(^ draft.u.home)
          !=(h doc.u.draft.u.home)
          !(~(has in shown.u.home) doc.u.draft.u.home)
      ==
    (~(del by assets.u.home) doc:(need draft.u.home))
  =.  assets.u.home  (~(put by assets.u.home) h ['application/json' p.octs q.octs now.bowl])
  =.  draft.u.home  `[+(rev) h now.bowl]
  ::  What the draft no longer names starts its day (see `let-go`).
  =.  u.home  (tidy u.home let-go:g doc)
  :_  state
  %+  weld  tidy-cards
  %+  answer  id
  %+  json-out  200
  %^  room-json  u.home  doc
  (draft-json draft.u.home)
::  THE GLURFFS WE ARE IN (2026-11-08), for anybody to see: those listed
::  with us, then those our own page has learnt of (`glurffs` in our
::  settings), as our Noltbook has their notes -- each a public group of its
::  host's that we may read -- but our own; one a host, at most
::  `listing-max`.
++  glurff-list
  ^-  (list glurff-entry:g)
  =/  known=(list [@p @ta])
    (weld (turn ~(tap by listed) |=([h=@p l=listing:g] [h note.l])) pref-glurffs)
  =|  seen=(set @p)
  =|  out=(list glurff-entry:g)
  =|  n=@ud
  |-  ^-  (list glurff-entry:g)
  ?~  known  (flop out)
  ?:  (gte n listing-max:g)  (flop out)
  =/  h=@p  -.i.known
  ?:  ?|(=(h our.bowl) (~(has in seen) h))  $(known t.known)
  =/  e=(unit glurff-entry:g)  (note-entry h +.i.known)
  ?~  e  $(known t.known)
  $(known t.known, seen (~(put in seen) h), out [u.e out], n +(n))
::  The Glurffs our page has learnt we are in, as our settings keep them.
++  pref-glurffs
  ^-  (list [@p @ta])
  =/  j=(unit json)  (de:json:html prefs)
  ?.  ?=([~ %o *] j)  ~
  =/  g  (~(get by p.u.j) 'glurffs')
  ?.  ?=([~ %a *] g)  ~
  %+  murn  p.u.g
  |=  e=json
  ^-  (unit [@p @ta])
  ?.  ?=([%o *] e)  ~
  =/  h  (~(get by p.e) 'host')
  =/  t  (~(get by p.e) 'note')
  ?.  ?&(?=([~ %s *] h) ?=([~ %s *] t))  ~
  =/  who=(unit @p)  (slaw %p p.u.h)
  ?~  who  ~
  ?.  ((sane %ta) p.u.t)  ~
  `[u.who p.u.t]
::  A note of ours, as a Glurff anybody may be told of: a public group of
::  `host`'s, still there, that we may read.
++  note-entry
  |=  [host=@p id=@ta]
  ^-  (unit glurff-entry:g)
  =/  base=path
    :~  (scot %p our.bowl)  %noltbook  (scot %da now.bowl)
        %api  %notes  id  %meta  %json
    ==
  =/  meta  (mule |.(.^(json %gx base)))
  ?:  ?=(%| -.meta)  ~
  ?.  ?=([%o *] p.meta)  ~
  =/  m  p.p.meta
  =/  text  |=(k=@t ^-(@t =/(v (~(get by m) k) ?.(?=([~ %s *] v) '' p.u.v))))
  ?.  ?&  =('group' (text 'type'))  =('public' (text 'visibility'))
          =(`host (slaw %p (text 'creator')))
      ==
    ~
  =/  caps  (~(get by m) 'capabilities')
  =/  cap  |=(k=@t ^-(? ?.(?=([~ %o *] caps) | =(`[%b &] (~(get by p.u.caps) k)))))
  ?.  ?&((cap 'canRead') !(cap 'isRemoved') !(cap 'isHostDeleted'))  ~
  =/  count  (~(get by m) 'userCount')
  `[host id (text 'name') ?.(?=([~ %n *] count) 0 (fall (rush p.u.count dem) 0))]
::  THE STORE'S ROOM (2026-11-08). It keeps the draft, everything the draft
::  names and everything a release still kept names -- visitors may be given
::  any of them again -- until that version is deleted (`forget`), though what
::  it named cannot be taken back from the namespace it was published under
::  (this kernel's %snip does nothing). The rest is let go once nothing has
::  wanted it for `grace`; what is kept is wanted now. `doc` is the draft's
::  document when the caller has it already read. A draft that cannot be
::  read says nothing (~), and then nothing is let go.
++  kept
  |=  [h=home:g doc=(unit json)]
  ^-  (unit (set hash:g))
  ?~  draft.h  `shown.h
  =/  j=(unit json)
    ?^  doc  doc
    =/  a  (~(get by assets.h) doc.u.draft.h)
    ?~(a ~ (de:json:html data.u.a))
  ?~  j  ~
  `(~(uni in (~(put in shown.h) doc.u.draft.h)) (hashes-in:gw u.j))
++  tidy
  |=  [h=home:g grace=@dr doc=(unit json)]
  ^-  home:g
  =/  keep=(unit (set hash:g))  (kept h doc)
  ?~  keep  h
  =-  h(assets -)
  %-  ~(gas by *(map hash:g asset:g))
  %+  murn  ~(tap by assets.h)
  |=  [k=hash:g a=asset:g]
  ^-  (unit [hash:g asset:g])
  ?:  (~(has in u.keep) k)  `[k a(at now.bowl)]
  ?:  (gth (add at.a grace) now.bowl)  `[k a]
  ~
::  All the store holds, and whether one more of `n` bytes would need room.
++  stored
  |=  h=home:g
  ^-  @ud
  (roll (turn ~(val by assets.h) |=(a=asset:g size.a)) add)
++  crowded
  |=  [h=home:g n=@ud]
  ^-  ?
  ?|  (gte ~(wyt by assets.h) assets-max:g)
      (gth (add (stored h) n) store-max:g)
  ==
::  What is kept, in bytes, and the most there may be: the editor's
::  measure of how full the world is.
++  room-json
  |=  [h=home:g doc=(unit json) j=json]
  ^-  json
  ?.  ?=([%o *] j)  j
  =/  used=@ud
    %+  roll  ~(tap in (fall (kept h doc) ~))
    |=  [k=hash:g n=@ud]
    (add n ?~(a=(~(get by assets.h) k) 0 size.u.a))
  :-  %o
  %-  ~(gas by p.j)
  :~  ['used' (numb:enjs:format used)]
      ['max' (numb:enjs:format store-max:g)]
  ==
::  The clock that lets go what nothing wants, set again whenever there may
::  be something: one clock for every ten minutes, however many saves.
++  tidy-cards
  ^-  (list card)
  =/  at=@da  (add now.bowl let-go:g)
  =.  at  (add (sub at (mod at ~m10)) ~m10)
  :~  [%pass /store-tidy %arvo %b %rest at]
      [%pass /store-tidy %arvo %b %wait at]
  ==
++  stale
  |=  rev=@ud
  ^-  simple-payload:http
  %+  json-out  409
  %-  pairs:enjs:format
  :~  ['rev' (numb:enjs:format rev)]
      ['errors' a+~[s+'the draft has been saved since']]
  ==
::  PUBLISH: the draft revision the editor last saw -- what was tried is
::  what goes out -- checked whole, then made live in one step. Visitors on
::  the release before keep it until they come back.
++  publish
  |=  [id=@ta rev=(unit @ud)]
  ^-  (quip card state-15)
  ?>  ?=(^ home)
  =/  out  |=(p=simple-payload:http [(answer id p) state])
  ?~  draft.u.home  (out (error-out 409 ~['there is no draft to publish']))
  ?:  =('' note.u.home)  (out (error-out 409 ~['it needs its note first']))
  =/  d=draft:g  u.draft.u.home
  ?.  =(rev `rev.d)  (out (stale rev.d))
  =/  a=(unit asset:g)  (~(get by assets.u.home) doc.d)
  ?~  a  (out (error-out 500 ~['the draft document is missing']))
  =/  doc=(unit json)  (de:json:html data.u.a)
  ?~  doc  (out (error-out 500 ~['the draft document is not JSON']))
  =/  ok  (check:gw u.doc assets.u.home)
  ?:  ?=(%| -.ok)  (out (error-out 422 p.ok))
  =/  n=@ud  +((roll ~(tap in ~(key by releases.u.home)) max))
  =/  named=(set hash:g)  (~(put in p.ok) doc.d)
  =/  fresh=(set hash:g)  (~(dif in named) shown.u.home)
  =.  releases.u.home
    (~(put by releases.u.home) n [doc.d rev.d (need (schema-of:gw u.doc)) now.bowl])
  =.  live.u.home  `n
  =.  shown.u.home  (~(uni in shown.u.home) named)
  :_  state
  ;:  weld
    (tend-cards fresh)
    ::  Listed where Glurffs are (2026-11-08); the editor makes that ship a
    ::  member of our note.
    (list-cards &)
    card-facts
    %+  answer  id
    %+  json-out  200
    (pairs:enjs:format ~[['release' (numb:enjs:format n)] ['doc' s+(hex:gw doc.d)]])
  ==
::  DELETE A VERSION (2026-11-09): any but the one visitors are given. What
::  only it named is kept no longer: it goes like anything nothing wants, a
::  day on (or at once when an upload needs the room), and a visitor can no
::  longer ask us for it. What it published under our world's namespace
::  stays there: this kernel cannot take that back (see `kept`).
++  forget
  |=  [id=@ta n=(unit @ud)]
  ^-  (quip card state-15)
  ?>  ?=(^ home)
  =/  out  |=(p=simple-payload:http [(answer id p) state])
  ?~  n  (out (error-out 400 ~['which version?']))
  ?.  (~(has by releases.u.home) u.n)  (out (error-out 404 ~['no such release']))
  ?:  =(live.u.home n)
    (out (error-out 409 ~['visitors are given this version: publish or choose another first']))
  =/  rest=(map @ud release:g)  (~(del by releases.u.home) u.n)
  =/  named=(unit (set hash:g))  (named-by rest assets.u.home)
  ?~  named  (out (error-out 500 ~['a version that stays could not be read']))
  ::  Only ever smaller: never more than was shown before.
  =/  still=(set hash:g)  (~(int in shown.u.home) u.named)
  =/  dropped=(set hash:g)  (~(dif in shown.u.home) still)
  =.  releases.u.home  rest
  =.  shown.u.home  still
  ::  Their day starts now.
  =.  assets.u.home
    %-  ~(urn by assets.u.home)
    |=  [k=hash:g a=asset:g]
    ?.((~(has in dropped) k) a a(at now.bowl))
  :_  state
  %+  weld  tidy-cards
  (answer id (json-out 200 releases-json))
::  Everything some release names: each one's document and every hash in it.
::  ~ if a release's document cannot be read.
++  named-by
  |=  [rs=(map @ud release:g) have=(map hash:g asset:g)]
  ^-  (unit (set hash:g))
  =/  l=(list release:g)  ~(val by rs)
  =|  out=(set hash:g)
  |-  ^-  (unit (set hash:g))
  ?~  l  `out
  =/  a  (~(get by have) doc.i.l)
  ?~  a  ~
  =/  j  (de:json:html data.u.a)
  ?~  j  ~
  $(l t.l, out (~(uni in (~(put in out) doc.i.l)) (hashes-in:gw u.j)))
::  Telling the ship our Glurff is listed with that it is live (&), or taken
::  down (|). Never ourselves: a host does not list with itself.
++  list-cards
  |=  on=?
  ^-  (list card)
  ?~  home  ~
  ?:  =('' note.u.home)  ~
  ?~  listing  ~
  ?:  =(u.listing our.bowl)  ~
  ~[(tell u.listing ?:(on [%listed note.u.home] [%unlisted note.u.home]))]
::  Published assets, under our world's encrypted namespace: each one once,
::  since its path is its hash.
++  tend-cards
  |=  hs=(set hash:g)
  ^-  (list card)
  ?~  home  ~
  %+  murn  ~(tap in hs)
  |=  h=hash:g
  ^-  (unit card)
  =/  a  (~(get by assets.u.home) h)
  ?~  a  ~
  `[%pass /world-tend %tend world-coop:g /asset/(hex:gw h) [%noun [mime size data]:u.a]]
++  home-json
  ^-  json
  =,  enjs:format
  ?~  home  (pairs ~[['hosting' b+|]])
  %-  pairs
  :~  ['hosting' b+&]
      ['note' s+note.u.home]
      ['edit' b+edit.u.home]
      ['live' ?~(live.u.home ~ (numb u.live.u.home))]
      ['draft' (draft-json draft.u.home)]
      ['assets' (numb ~(wyt by assets.u.home))]
      ['bytes' (numb (stored u.home))]
      ['listing' ?~(listing ~ s+(scot %p u.listing))]
      ['room' (room-json u.home ~ o+~)]
  ==
++  draft-json
  |=  d=(unit draft:g)
  ^-  json
  ?~  d  ~
  %-  pairs:enjs:format
  :~  ['rev' (numb:enjs:format rev.u.d)]
      ['doc' s+(hex:gw doc.u.d)]
      ['at' (sect:enjs:format at.u.d)]
  ==
++  releases-json
  ^-  json
  ?~  home  ~
  %-  pairs:enjs:format
  :~  ['live' ?~(live.u.home ~ (numb:enjs:format u.live.u.home))]
      :-  'releases'
      :-  %a
      %+  turn
        (sort ~(tap by releases.u.home) |=([a=[n=@ud *] b=[n=@ud *]] (gth n.a n.b)))
      |=  [n=@ud r=release:g]
      %-  pairs:enjs:format
      :~  ['release' (numb:enjs:format n)]
          ['doc' s+(hex:gw doc.r)]
          ['rev' (numb:enjs:format rev.r)]
          ['schema' (numb:enjs:format schema.r)]
          ['at' (sect:enjs:format at.r)]
      ==
  ==
::
::  AN ASSET OF A HOST'S WORLD, for our page. Our own world's from our own
::  store, drafts included; any other host's fetched from it -- once, however
::  many of our browsers are waiting, and however many times they give up
::  waiting and ask again while it is on its way (2026-11-10) -- and never
::  kept here: the browser keeps it.
++  asset-spur
  |=  h=hash:g
  ^-  path
  ~[%g %x '1' %glurff %$ '1' %world %asset (hex:gw h)]
++  asset-get
  |=  [id=@ta host=@p h=hash:g =via:g]
  ^-  (quip card state-15)
  ?:  =(host our.bowl)
    =/  a=(unit asset:g)  ?~(home ~ (~(get by assets.u.home) h))
    ?~  a  [(answer id not-found:gen:server) state]
    [(answer id (asset-payload mime.u.a [size.u.a data.u.a])) state]
  =/  key=[@p hash:g]  [host h]
  =/  f=(unit fetch:g)  (~(get by fetches) key)
  ::  On its way already: waited for, not asked again.
  ?:  ?&(?=(^ f) (lth (sub now.bowl at.u.f) fetch-stale:g))
    :_  state(fetches (~(put by fetches) key u.f(ids (~(put in ids.u.f) id))))
    ~[(fetch-timer host h id)]
  ::  Asked, then -- or asked again, after so long that the first ask is not
  ::  worth waiting on -- with anybody still waiting kept waiting.
  =/  =wire  /fetch/(scot %p host)/(hex:gw h)
  =/  ids=(set @ta)  (~(put in ?~(f *(set @ta) ids.u.f)) id)
  :_  state(fetches (~(put by fetches) key [via ids now.bowl]))
  :~  ?-  via
        %scry  [%pass wire %keen & host (asset-spur h)]
        %poke  [%pass wire %agent [host %glurff] %poke %glurff-remote !>(`remote:g`[%asset-ask h])]
      ==
      (fetch-timer host h id)
  ==
::  How long one browser waits before it is told "not in time" and asks
::  again: its own clock, so a browser that joins a fetch late still waits
::  its whole minute. The fetch itself goes on.
++  fetch-timer
  |=  [host=@p h=hash:g id=@ta]
  ^-  card
  [%pass [%fetch-for (scot %p host) (hex:gw h) id ~] %arvo %b %wait (add now.bowl fetch-wait:g)]
::  An asset came from a host, or will not: every browser waiting on it is
::  answered. The bytes must be the ones the hash names, so neither a host
::  nor a fault can put anything else on a page under its name.
++  asset-came
  |=  [host=@p h=hash:g got=(each [mime=@t =octs] @tas)]
  ^-  (quip card state-15)
  =/  f=(unit fetch:g)  (~(get by fetches) [host h])
  ?~  f  `state
  =/  pay=simple-payload:http
    ?:  ?=(%| -.got)
      ?+  p.got  (error-out 502 ~[p.got])
        %denied   (error-out 403 ~['the host did not let us read it'])
        %timeout  (error-out 504 ~['the host did not answer in time'])
      ==
    ?.  =(h (hash-of:gw octs.p.got))  (error-out 502 ~['the bytes are not what was asked for'])
    ?.  (~(has in mimes:gw) mime.p.got)  (error-out 502 ~['not a kind of file a world keeps'])
    (asset-payload mime.p.got octs.p.got)
  ::  Given to whoever is waiting -- a browser asking again joins the fetch
  ::  -- and to nobody else: nothing is kept.
  :_  state(fetches (~(del by fetches) [host h]))
  (zing (turn ~(tap in ids.u.f) |=(id=@ta (answer id pay))))
::  Whether `who` may visit the world we host: a member of its note, or
::  ourselves. Nobody else, nor anybody while Noltbook cannot say.
++  visitor-ok
  |=  who=@p
  ^-  ?
  ?~  home  %.n
  ?:  =(who our.bowl)  %.y
  =/  gn  (note-read note.u.home)
  ?~  gn  %.n
  (~(has in members.u.gn) who)
::  OUR WORLD'S CARD (see `world-card` in /sur), and everybody watching it
::  told that it changed.
++  card-of
  ^-  (unit world-card:g)
  ?~  home  ~
  ::  Not published yet, and no note: nothing for anybody to see.
  ?:  =('' note.u.home)  ~
  =/  on=(unit [n=@ud doc=hash:g size=@ud])
    ?~  live.u.home  ~
    =/  r=(unit release:g)  (~(get by releases.u.home) u.live.u.home)
    ?~  r  ~
    =/  a=(unit asset:g)  (~(get by assets.u.home) doc.u.r)
    `[u.live.u.home doc.u.r ?~(a 0 size.u.a)]
  `[note.u.home (note-name note.u.home) on]
::  OUR CARD AS `who` MAY SEE IT. A secret world is nothing at all to anybody
::  outside its note -- no name, no release -- as Noltbook never lists a
::  secret note to anybody outside it.
++  card-for
  |=  who=@p
  ^-  (unit world-card:g)
  ?~  home  ~
  ?:  ?&(=(%secret (note-vis note.u.home)) !(visitor-ok who))  ~
  card-of
::  ...and everybody watching it told: our own page as it is, and other
::  ships' agents what each of them may see. A secret world's watchers are
::  sent away to watch again, which answers each of them alone (/card in
::  +on-watch); any other world's are all told the same.
++  card-facts
  ^-  (list card)
  =/  ours=card
    [%give %fact ~[/card/(scot %p our.bowl)] %glurff-update !>(`update:g`[%world-card our.bowl card-of])]
  ?:  ?&(?=(^ home) =(%secret (note-vis note.u.home)))
    ~[ours [%give %kick ~[/card] ~]]
  :~  :*  %give  %fact  ~[/card /card/(scot %p our.bowl)]
          %glurff-update  !>(`update:g`[%world-card our.bowl card-of])
  ==  ==
::  How open a note is, as Noltbook has it. Only a note Noltbook says is
::  secret is: one it cannot describe is shown as it always was.
++  note-vis
  |=  id=@ta
  ^-  ?(%public %private %secret)
  =/  =path
    :~  (scot %p our.bowl)  %noltbook  (scot %da now.bowl)
        %api  %notes  id  %meta  %json
    ==
  =/  meta  (mule |.(.^(json %gx path)))
  ?:  ?=(%| -.meta)  %public
  =/  v=(unit @t)  (str:gw (get:gw p.meta 'visibility'))
  ?:  =(`'secret' v)  %secret
  ?:  =(`'private' v)  %private
  %public
::  A note's name, as Noltbook has it.
++  note-name
  |=  id=@ta
  ^-  @t
  =/  =path
    :~  (scot %p our.bowl)  %noltbook  (scot %da now.bowl)
        %api  %notes  id  %meta  %json
    ==
  =/  meta  (mule |.(.^(json %gx path)))
  ?:  ?=(%| -.meta)  'Glurff'
  (fall (str:gw (get:gw p.meta 'name')) 'Glurff')
::  Watch a host's card afresh, dropping our older watch of that host's.
++  card-follow
  |=  host=@p
  ^-  (list card)
  %+  snoc
    %+  murn  ~(tap by wex.bowl)
    |=  [[=wire =ship =term] [acked=? =path]]
    ^-  (unit card)
    ?.  ?&(?=([%card @ *] wire) =(ship host))  ~
    `[%pass wire %agent [ship term] %leave ~]
  [%pass /card/(scot %p host)/(scot %da now.bowl) %agent [host %glurff] %watch /card]
::
::  SIGNS (2026-11-07). A sign changed by `who`, if they may: somebody in
::  our world, writing within a sign's length, on a sign the live release
::  lets people change. Otherwise the poke crashes, and its sender hears no.
++  sign-put
  |=  [who=@p item=@t text=@t]
  ^-  (quip card state-15)
  ?>  (visitor-ok who)
  ?>  (lte (met 3 text) sign-max:g)
  ?>  ?|((~(has by signs) item) (lth ~(wyt by signs) signs-max:g))
  ?>  (sign-ok item)
  =.  signs  (~(put by signs) item [text who now.bowl])
  [sign-facts state]
::  Whether the live release has a sign `item` that people may change: an
::  item that shows text, marked `editable`.
++  sign-ok
  |=  item=@t
  ^-  ?
  ?~  home  %.n
  ?~  live.u.home  %.n
  =/  r=(unit release:g)  (~(get by releases.u.home) u.live.u.home)
  ?~  r  %.n
  =/  a=(unit asset:g)  (~(get by assets.u.home) doc.u.r)
  ?~  a  %.n
  =/  doc=(unit json)  (de:json:html `@t`data.u.a)
  ?~  doc  %.n
  %+  lien  (fall (many:gw (get:gw u.doc 'maps')) ~)
  |=  m=json
  %+  lien  (fall (many:gw (get:gw m 'items')) ~)
  |=  it=json
  =/  d=json  (fall (get:gw it 'do') ~)
  ?&  =(`item (str:gw (get:gw it 'id')))
      =(`'text' (str:gw (get:gw d 'kind')))
      =(`%.y (flag:gw (get:gw d 'editable')))
  ==
::  Everybody reading our signs told what they say now: our page, and every
::  member's agent watching for its page.
++  sign-facts
  ^-  (list card)
  :~  :*  %give  %fact  ~[/signs /signs/(scot %p our.bowl)]
          %glurff-update  !>(`update:g`[%signs our.bowl signs])
  ==  ==
::  Watch a host's signs afresh, dropping our older watch of that host's.
++  signs-follow
  |=  host=@p
  ^-  (list card)
  %+  snoc
    %+  murn  ~(tap by wex.bowl)
    |=  [[=wire =ship =term] [acked=? =path]]
    ^-  (unit card)
    ?.  ?&(?=([%signs @ *] wire) =(ship host))  ~
    `[%pass wire %agent [ship term] %leave ~]
  [%pass /signs/(scot %p host)/(scot %da now.bowl) %agent [host %glurff] %watch /signs]
::
::  FROM DOJO: hosting a world, and editing it. See /mar/glurff-operator.
++  operate
  |=  op=operator:g
  ^-  (quip card state-15)
  ?-    -.op
      %host
    ::  Only a note of our own can be a world we host: its creator is the
    ::  ship that admits its members.
    =/  gn  (note-read note.op)
    ?.  ?&(?=(^ gn) =(creator.u.gn our.bowl))
      ((slog leaf+"glurff: {<note.op>} is not a note of ours" ~) `state)
    =/  was=?  ?=(^ home)
    =.  home  ?~(home `[note.op | ~ ~ ~ ~ ~] `u.home(note note.op))
    :_  state
    %+  weld  card-facts
    ^-  (list card)
    ?:  was  ~
    ~[[%pass /world-coop %germ world-coop:g]]
  ::
      %listing
    `state(listing ship.op)
  ::
      %unlist
    `state(listed (~(del by listed) who.op))
  ::
      %unhost
    ?~  home  `state
    ::  A world somebody may be visiting is not thrown away from here.
    ?.  =(~ releases.u.home)
      ((slog leaf+"glurff: this world has releases, and is still hosted" ~) `state)
    :_  state(home ~)
    :~  :*  %give  %fact  ~[/card /card/(scot %p our.bowl)]
            %glurff-update  !>(`update:g`[%world-card our.bowl ~])
    ==  ==
  ::
      %edit
    ?~  home  ((slog leaf+"glurff: host a world before editing it" ~) `state)
    `state(edit.u.home on.op)
  ==
::
::  ---- from our own client ----
::
++  do-action
  |=  act=action:g
  ^-  (quip card state-15)
  ?-    -.act
      %move
    :_  state
    (spray peers.act [%here spot.act rev.act host.act])
  ::
      %leave
    :_  state
    (spray peers.act [%gone ~])
  ::
      %dress
    ::  Bump the revision so peers know to refetch. The look itself does not
    ::  ride on every beat -- it is far bigger than a position.
    =/  next=look-rev:g  +(rev)
    :_  state(look look.act, rev next)
    [(fact [%our-look look.act next sprite-lab]) (spray peers.act [%here [0 0 0 %down] next ~])]
  ::
      %fetch-look
    :_  state
    ~[(tell who.act [%ask-look ~])]
  ::
      %claim
    :_  state(hosting (~(put by hosting) place.act %open))
    (spray peers.act [%hosting place.act %open])
  ::
      %release
    :_  state(hosting (~(del by hosting) place.act))
    (spray peers.act [%unhosting place.act])
  ::
    ::  TAKE A ROOM for one of our own notes. One lease at a time, by rule:
    ::  taking a second replaces the first, and the client asks before it does.
    ::  The note id is Noltbook's own and is stored as given -- we cannot check
    ::  it from here, and the client only ever offers notes this ship created.
      %lease
    ?.  (area-place place.act)  `state
    ?:  =(0 (met 3 note.act))  `state
    ::  A NEW GENERATION, always. Taking a lease -- even re-pointing this room
    ::  at a different note -- makes every seat and every message still in
    ::  flight about the old one meaningless, which is exactly what the
    ::  generation is for.
    =/  gen=@ud  .+((fall (bind lease |=(h=held:g gen.h)) 0))
    =/  prev=(unit @da)  ?~(lease ~ armed.u.lease)
    =/  h=held:g  [place.act note.act gen ~ `now.bowl prev]
    =^  cards  h  (arm h (due h))
    ::  A different note is a different door: our browser sends the new one.
    ::  Whoever could see the old lease is told it is over.
    =/  over=(list card)
      ?~  lease  ~
      (spray (told u.lease) [%lease-gone place.u.lease gen.u.lease])
    :_  state(lease `h, door ~, lease-world world.act)
    (weld over (snoc cards (fact [%our-lease (shown `h) world.act])))
  ::
      %unlease
    ?~  lease  `state
    :_  state(lease ~, door ~, lease-world ~)
    ;:  weld
      ?~  armed.u.lease  ~
      ~[[%pass /lease %arvo %b %rest u.armed.u.lease]]
      ::  The people standing in the room are told by name. Releasing by hand
      ::  used to rely on our own browser republishing the roster, which is no
      ::  use to anybody once that browser is closed.
      (spray (told u.lease) [%lease-gone place.u.lease gen.u.lease])
      ~[(fact [%our-lease ~ ~])]
    ==
  ::
    ::  Our own tab, or a guest's, sitting in a leased room. Ours is handled
    ::  here; a guest's is carried to the owner's agent, which is the authority.
      %seat
    ?.  (area-place place.act)  `state
    ?:  =(0 (met 3 tab.act))  `state
    ?:  =(host.act our.bowl)
      (seat-change our.bowl place.act gen.act tab.act what.act)
    :_  state
    ~[(tell host.act [%seated place.act gen.act tab.act what.act])]
  ::
      %sprite-lab
    :_  state(sprite-lab enabled.act)
    ~[(fact [%our-look look rev enabled.act])]
  ::
    ::  OUR SETTINGS, from our own browser: kept as given and handed back to
    ::  every page of ours. Never read here, never sent to another ship.
      %prefs
    ?.  (lte (met 3 text.act) prefs-max:g)  `state
    :_  state(prefs text.act)
    ~[(fact [%our-prefs text.act])]
  ::
    ::  THE WORLD'S SPOTS, set by us as a world's host -- from Dojo for now:
    ::
    ::    :glurff &glurff-action [%spot ~ %boardroom-table `[%fhloston-poker ~forbes-marmet 'Fhloston Poker' ~]]
    ::
    ::  and `~` in place of the app to give the spot back to the map. Every
    ::  page watching /spots, ours and every visitor's, is told at once.
      %spot
    ?.  (spot-ok id.act app.act)  `state
    =/  next=(map @tas spot-app:g)
      ?~  app.act  (~(del by spots) id.act)
      (~(put by spots) id.act u.app.act)
    ?:  (gth (add ~(wyt by next) ~(wyt by webs)) spots-max:g)  `state
    ::  An app on a spot takes the place of any website there. Every visitor's
    ::  agent on /spots is told, and our own page, on its own path.
    =/  sans=(map @tas spot-web:g)  (~(del by webs) id.act)
    :_  state(spots next, webs sans)
    (spots-facts ~[/spots /spots/(scot %p our.bowl)] next sans)
  ::
    ::  A WEBSITE on a spot, from Dojo for now:
    ::
    ::    :glurff &glurff-action [%spot-web ~ %boardroom-table `['https://example.com' 'Example']]
    ::
    ::  https only. It takes the place of any app there; `~` gives the spot
    ::  back to the map.
      %spot-web
    ?.  (spot-ok id.act ~)  `state
    ?.  (web-ok web.act)  `state
    =/  next=(map @tas spot-web:g)
      ?~  web.act  (~(del by webs) id.act)
      (~(put by webs) id.act u.web.act)
    =/  apps=(map @tas spot-app:g)  ?~(web.act spots (~(del by spots) id.act))
    ?:  (gth (add ~(wyt by next) ~(wyt by apps)) spots-max:g)  `state
    :_  state(webs next, spots apps)
    (spots-facts ~[/spots /spots/(scot %p our.bowl)] apps next)
  ::
    ::  OUR CARD, TOLD AGAIN: our page says our note's visibility changed.
      %card-again
    [card-facts state]
  ::
    ::  SIGNS: what a sign says -- in our own world, here; in another's, asked
    ::  of its host, whose refusal comes back as a nack (see +on-agent).
      %sign-set
    ?:  =(host.act our.bowl)  (sign-put our.bowl item.act text.act)
    ?.  (lte (met 3 text.act) sign-max:g)  `state
    :_  state
    :~  :*  %pass  /sign-set/(scot %p host.act)/(scot %t item.act)
            %agent  [host.act %glurff]  %poke
            %glurff-remote  !>(`remote:g`[%sign-set item.act text.act])
    ==  ==
  ::
    ::  ...and, as the host, one put back to what the world was published with.
      %sign-reset
    ?.  (~(has by signs) item.act)  `state
    =.  signs  (~(del by signs) item.act)
    [sign-facts state]
  ::
    ::  THE SESSION LEASE. See `live` in /sur. The same session renewing keeps
    ::  its generation; a new one taking over gets a new, larger one; a session
    ::  that is not live and does not `take` is told who is, and stands down.
      %session
    ?:  =(0 (met 3 tab.act))  `state
    =/  mint
      |=  prev=@ud
      ^-  (quip card state-15)
      =/  ms=@ud  (div (sub now.bowl ~1970.1.1) (div ~s1 1.000))
      =/  gen=@ud  (max +(prev) ms)
      :_  state(live `[tab.act gen now.bowl])
      ~[(fact [%session tab.act gen])]
    ?~  live  (mint 0)
    ?.  (lth now.bowl (add at.u.live session-ttl:g))
      (mint gen.u.live)
    ?:  =(tab.act tab.u.live)
      `state(live `[tab.act gen.u.live now.bowl])
    ?.  take.act
      [~[(fact [%session tab.u.live gen.u.live])] state]
    (mint gen.u.live)
  ::
    ::  EVERY CALL ON THE GLURFF'S HOST: ours to decide when we are that host,
    ::  carried to its ship when we are not.
      %call-knock
    ?:  =(host.act our.bowl)  (call-knock our.bowl place.act attempt.act mode.act)
    :_  state
    ~[(tell host.act [%call-knock place.act attempt.act mode.act])]
  ::
      %call-leave
    ?:  =(host.act our.bowl)  (call-leave our.bowl place.act)
    :_  state
    ~[(tell host.act [%call-leave place.act])]
  ::
      %call-mod
    ?:  =(host.act our.bowl)
      (call-mod our.bowl place.act inc.act target.act op.act)
    :_  state
    ~[(tell host.act [%call-mod place.act inc.act target.act op.act])]
  ::
      %call-roster
    ?:  (gth (lent ships.act) 32)  `state
    ?:  =(host.act our.bowl)  (call-roster our.bowl place.act (silt ships.act))
    :_  state
    ~[(tell host.act [%call-roster place.act (silt ships.act)])]
  ::
      %call-recheck
    ?:  =(host.act our.bowl)  (call-recheck our.bowl who.act)
    :_  state
    ~[(tell host.act [%call-recheck who.act])]
  ::
    ::  THE DOOR of the room we lease. Members new to it are told which note it
    ::  is; members dropped from it are told the lease is over for them.
      %lease-door
    ?~  lease  `state(door ~)
    ?:  (gth (lent members.act) 256)  `state
    =/  mem=(set @p)  (~(del in (silt members.act)) our.bowl)
    =/  was=(set @p)  ?~(door ~ members.u.door)
    =/  fresh=?
      ?~  door  %.y
      !=(vis.act vis.u.door)
    =/  tell-them=(list @p)
      ?:  fresh  ~(tap in mem)
      ~(tap in (~(dif in mem) was))
    =/  gone=(list @p)  ~(tap in (~(dif in was) mem))
    :_  state(door `[mem vis.act])
    %+  weld
      (spray tell-them [%lease-info place.u.lease note.u.lease vis.act gen.u.lease])
    (spray gone [%lease-gone place.u.lease gen.u.lease])
  ::
      %lease-ask
    ?:  =(host.act our.bowl)  `state
    :_  state
    ~[(tell host.act [%lease-ask place.act])]
  ::
      %knock
    ::  Ames does not care about pals: knowing a host's @p is enough to ask.
    :_  state
    ~[(tell host.act [%knock place.act])]
  ::
      %ensure-commons
    `state
  ::
      %splash
    :_  state
    ~[(tell target.act [%splashed ~])]
  ::
      %presence-event
    ?.  (lte (met 3 body.act) 8.192)  `state
    :_  state
    (spray peers.act [%presence-event body.act])
  ::
      %room-event
    ?.  ?&((area-place place.act) !=(rumors-room:g place.act) (lte (met 3 body.act) 8.192))
      `state
    :_  state
    (spray peers.act [%room-event place.act body.act])
  ::
      %roll
    :_  state
    (spray peers.act [%rolled place.act stage.act])
  ==
::
::  ---- from another ship ----
::
::  One more poke from `who`: is it within their allowance? The meter map is
::  pruned of finished windows once it grows, so a crowd of ships that each
::  poked once cannot make it grow without bound.
++  meter
  |=  who=@p
  ^-  [? state-15]
  =/  cur=meter:g  (~(gut by meters) who [now.bowl 0])
  =?  cur  (gte now.bowl (add at.cur remote-window:g))  [now.bowl 0]
  =.  n.cur  +(n.cur)
  =/  kept=(map @p meter:g)
    ?.  (gth ~(wyt by meters) 512)  meters
    %-  malt
    %+  skim  ~(tap by meters)
    |=  [p=@p m=meter:g]
    (lth now.bowl (add at.m remote-window:g))
  =/  ok=?  (lte n.cur remote-burst:g)
  ::  Said once per window, not once per dropped poke.
  ~?  =(n.cur +(remote-burst:g))  [%glurff-over-allowance who]
  [ok state(meters (~(put by kept) who cur))]
::  No text from another ship bigger than our own browser would send.
++  fits
  |=  rem=remote:g
  ^-  ?
  ?+  -.rem  %.y
    %presence-event  (lte (met 3 body.rem) remote-body:g)
    %room-event      (lte (met 3 body.rem) remote-body:g)
    %wearing         (lte (met 3 (jam look.rem)) remote-body:g)
    %lease-info      (lte (met 3 note.rem) 256)
    %call-roster     (lte ~(wyt in ships.rem) 32)
    %call-mod-snap   (lte (met 3 (jam snap.rem)) remote-body:g)
    %asset-give      ?&((lte p.data.rem asset-max:g) (lte (met 3 q.data.rem) p.data.rem))
    %sign-set        ?&((lte (met 3 text.rem) sign-max:g) (lte (met 3 item.rem) 64))
    %listed          (lte (met 3 note.rem) 256)
    %unlisted        (lte (met 3 note.rem) 256)
  ==
++  do-remote
  |=  [who=@p rem=remote:g]
  ^-  (quip card state-15)
  ?-    -.rem
      %here     :_(state ~[(fact [%peer-here who spot.rem rev.rem host.rem])])
      %gone     :_(state ~[(fact [%peer-gone who])])
      %wearing  :_(state ~[(fact [%peer-look who look.rem rev.rem])])
  ::
      %ask-look
    ::  Someone we can see wants our character. Answer only them.
    :_  state
    ~[(tell who [%wearing look rev])]
  ::
      %hosting    :_(state ~[(fact [%peer-hosting who place.rem mode.rem])])
      %unhosting  :_(state ~[(fact [%peer-unhosting who place.rem])])
      %splashed   :_(state ~[(fact [%splashed who])])
      %rolled     :_(state ~[(fact [%rolled who place.rem stage.rem])])
      %presence-event
    ?.  (lte (met 3 body.rem) 8.192)  `state
    :_(state ~[(fact [%presence-event who body.rem])])
  ::
    ::  A guest reporting where it is sitting. Only its own seat can move.
      %seated
    ?:  =(0 (met 3 tab.rem))  `state
    (seat-change who place.rem gen.rem tab.rem what.rem)
  ::
    ::  The owner telling us which generation our seat was admitted to.
      %seated-ok
    :_(state ~[(fact [%seat-ok place.rem gen.rem])])
  ::
    ::  A lease we were sitting in has ended. Only its owner may say so.
      %lease-gone
    :_(state ~[(fact [%lease-gone who place.rem gen.rem])])
  ::
    ::  EVERY CALL ON THE GLURFF'S HOST: somebody asking for a call, leaving
    ::  one, moderating one or registering a huddle -- decided here with no
    ::  browser involved -- and the host's answers to us.
      %call-knock   (call-knock who place.rem attempt.rem mode.rem)
      %call-leave   (call-leave who place.rem)
      %call-mod     (call-mod who place.rem inc.rem target.rem op.rem)
      %call-roster  (call-roster who place.rem ships.rem)
      %call-recheck  (call-recheck who who.rem)
  ::
      %call-mod-snap
    :_(state ~[(fact [%call-mod-snap who place.rem snap.rem])])
  ::
      %call-refused
    :_(state ~[(fact [%call-refused who place.rem attempt.rem why.rem])])
  ::
    ::  THE DOOR. A member is told which note; anybody else, only that the room
    ::  is private. Nothing is said about a room we do not lease.
      %lease-ask
    ?~  lease  `state
    ?.  =(place.rem place.u.lease)  `state
    =/  private=card  (tell who [%lease-private place.u.lease gen.u.lease])
    ?~  door  :_(state ~[private])
    ?.  (~(has in members.u.door) who)  :_(state ~[private])
    :_  state
    ~[(tell who [%lease-info place.u.lease note.u.lease vis.u.door gen.u.lease])]
  ::
      %lease-info
    :_(state ~[(fact [%lease-info who place.rem note.rem vis.rem gen.rem])])
  ::
      %lease-private
    :_(state ~[(fact [%lease-private who place.rem gen.rem])])
  ::
    ::  THE WORLD AS DATA, by poke. A visitor asking us, a world's host, for
    ::  one of its assets: a member, for one some release names.
      %asset-ask
    =/  no
      |=  why=@tas
      ^-  (quip card state-15)
      [~[(tell who [%asset-deny hash.rem why])] state]
    ?~  home  (no %no-world)
    ?.  (visitor-ok who)  (no %not-a-member)
    ?.  (~(has in shown.u.home) hash.rem)  (no %not-published)
    =/  a=(unit asset:g)  (~(get by assets.u.home) hash.rem)
    ?~  a  (no %missing)
    ::  On a flow of their own, one per visitor, never the presence flow: a
    ::  megabyte queued ahead of somebody's next step would hold it for
    ::  seconds. One flow, not one per asset: separate flows were measured
    ::  no faster (2026-11-04) -- the ships' packet handling is the limit --
    ::  and each would be kept by Ames for good.
    :_  state
    :~  :*  %pass  /asset-out/(scot %p who)
            %agent  [who %glurff]  %poke
            %glurff-remote  !>(`remote:g`[%asset-give hash.rem mime.u.a [size.u.a data.u.a]])
    ==  ==
  ::
    ::  ...and a host's answer to us. Only an asset we asked that host for.
      %asset-give
    =/  f=(unit fetch:g)  (~(get by fetches) [who hash.rem])
    ?.  ?&(?=(^ f) ?=(%poke via.u.f))  `state
    (asset-came who hash.rem [%& mime.rem data.rem])
  ::
      %asset-deny
    =/  f=(unit fetch:g)  (~(get by fetches) [who hash.rem])
    ?.  ?&(?=(^ f) ?=(%poke via.u.f))  `state
    (asset-came who hash.rem [%| ?:(=(%not-a-member why.rem) %denied why.rem)])
  ::
    ::  Somebody in our world changing what a sign says. See `sign-put`.
      %sign-set
    (sign-put who item.rem text.rem)
  ::
    ::  A host that published, saying its note is its Glurff (2026-11-08).
    ::  Kept, up to so many; shown only while we are in that note and it is
    ::  public (`glurff-list`).
      %listed
    ?.  ?|((~(has by listed) who) (lth ~(wyt by listed) listing-max:g))  `state
    `state(listed (~(put by listed) who [note.rem now.bowl]))
  ::
    ::  ...and taken down again (2026-11-09): off the list, if that is the
    ::  note it listed.
      %unlisted
    =/  l  (~(get by listed) who)
    ?.  ?&(?=(^ l) =(note.u.l note.rem))  `state
    `state(listed (~(del by listed) who))
  ::
      %room-event
    ?.  ?&((area-place place.rem) !=(rumors-room:g place.rem) (lte (met 3 body.rem) 8.192))
      `state
    :_(state ~[(fact [%room-event who place.rem body.rem])])
  ::
      %refused
    :_(state ~[(fact [%refused who place.rem why.rem])])
  ::
      %knock
    ?:  =(place.rem world-place:g)  (world-knock who)
    ::  Someone is asking to be let into a room we hold: a movement session's.
    ::  Every one is open -- there are no locks (2026-10-31) -- and a refusal
    ::  is a value, never silence.
    ?.  (~(has by hosting) place.rem)
      :_(state ~[(tell who [%refused place.rem %not-hosting])])
    ::  Admit the knocker to the existing room. Construct each tagged action
    ::  separately: a computed tag inside one tuple does not nest in the calls
    ::  action union.
    :_  state
    %+  weld
      :~  ?:  ?&((gth place.rem movement-base:g) (lth place.rem 1.000.000))
            %-  calls-poke
            :*  %renew-access
                (call-req place.rem `@ud`(shas %glurff-admit now.bowl) %access who)
                (room-key place.rem)  who  %glurff
                (call-ctx place.rem who 0)
            ==
          %-  calls-poke
          :*  %access
              (call-req place.rem `@ud`(shas %glurff-admit now.bowl) %access who)
              (room-key place.rem)  who  %glurff
              (call-ctx place.rem who 0)
          ==
      ==
    ::  A MOVEMENT room is kept alive by the people still using it, not by
    ::  whoever opened it. Every knock asks our broker to extend the lease,
    ::  which is how the room outlives the host's browser without that browser
    ::  -- or a timer here -- keeping anything alive.
    ::
    ::  The request id is bucketed by the minute, so however many participants
    ::  knock, the Warden performs at most one renewal per minute per room and
    ::  answers the rest as duplicates. When the last participant leaves, the
    ::  knocks stop and the lease lapses on its own.
    ::
    ::  The renewal's answer goes to %noltbook-calls, never back here.
    ?.  ?&((gth place.rem movement-base:g) (lth place.rem 1.000.000))  ~
    :~  %-  calls-poke
        :*  %renew
            (call-req place.rem `@ud`(div now.bowl ~m1) %renew our.bowl)
            (room-key place.rem)
            movement-ttl:g
        ==
    ==
  ==
--
--
