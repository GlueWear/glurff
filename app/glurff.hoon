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
/+  default-agent, dbug, verb, server, glurff-site
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
+$  card  card:agent:gall
--
::
=|  state-11
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
  :_  this(look *look:g, rev 0, hosting ~, lease ~, sprite-lab %.n, live ~, meters ~, door ~, world ~, prefs '', spots ~, webs ~, calls ~)
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
  =/  eleven=(unit state-11)
    =/  res  (mule |.(!<(state-11 old)))
    ?:(?=(%| -.res) ~ `p.res)
  ?^  eleven
    :_  this(state u.eleven)
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
  :_  this(state [%11 look.was rev.was hosting.was lease.was sprite-lab.was live.was meters.was door.was world.was prefs.was spots.was webs.was calls])
  [(bind:glurff-site) calls-watch:hc]
::
++  on-poke
  |=  [=mark =vase]
  ^-  (quip card _this)
  ?+    mark  (on-poke:def mark vase)
      %handle-http-request
    =/  req  !<([eyre-id=@ta =inbound-request:eyre] vase)
    [(serve:glurff-site bowl req) this]
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
          [%give %fact ~ %glurff-update !>(`update:g`[%our-lease (shown:hc lease)])]
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
  ?.  ?=(%poke-ack -.sign)  `this
  ?~  p.sign  `this
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
  ::  THE LEASE CLOCK. This is what makes a lease end when the room empties even
  ::  though the owner's browser is shut: nobody has to be watching for it.
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
      ~[(fact:hc [%our-lease ~])]
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
  ::  THE CALLS, READABLE, on the Glurff's host (see `host-call` in /sur):
  ::
  ::    > .^(json %gx /=glurff=/calls/json)
  ::
  ::  Each call's run, who is in it and when we last heard from them, and its
  ::  moderation. Ships and times only.
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
  ^-  (quip card state-11)
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
  ^-  (quip card state-11)
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
  ^-  state-11
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
++  glurff-note
  ^-  (unit gnote)
  =/  base=path
    :~  (scot %p our.bowl)  %noltbook  (scot %da now.bowl)
        %api  %notes  world-note:g
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
  ^-  (quip card state-11)
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
  ^-  (quip card state-11)
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
  ^-  (quip card state-11)
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
  :_  state(calls (~(put by calls) place done))
  ;:  weld  out  enforce
    (call-publish place done note ?:(=(%boot op) ~[target] ~))
  ==
::  A HUDDLE'S ROSTER, from the member it elected -- the one ship whose name
::  its place is made from. Only those on it may be in its call; anybody in
::  the call who is not on it any more has left it. An empty roster ends it.
++  call-roster
  |=  [who=@p =place:g ships=(set @p)]
  ^-  (quip card state-11)
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
  ^-  (quip card state-11)
  =/  gn  glurff-note
  ?~  gn  `state
  ?.  =(creator.u.gn our.bowl)  `state
  ?.  |(=(actor our.bowl) (~(has in mods.u.gn) actor))  `state
  =/  places=(list place:g)  ~(tap in ~(key by calls))
  =|  cards=(list card)
  |-  ^-  (quip card state-11)
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
  ^-  state-11
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
::  ---- from our own client ----
::
++  do-action
  |=  act=action:g
  ^-  (quip card state-11)
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
    ?.  ?&((gth place.act 0) (lte place.act last-room:g))  `state
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
    :_  state(lease `h, door ~)
    (weld over (snoc cards (fact [%our-lease (shown `h)])))
  ::
      %unlease
    ?~  lease  `state
    :_  state(lease ~, door ~)
    ;:  weld
      ?~  armed.u.lease  ~
      ~[[%pass /lease %arvo %b %rest u.armed.u.lease]]
      ::  The people standing in the room are told by name. Releasing by hand
      ::  used to rely on our own browser republishing the roster, which is no
      ::  use to anybody once that browser is closed.
      (spray (told u.lease) [%lease-gone place.u.lease gen.u.lease])
      ~[(fact [%our-lease ~])]
    ==
  ::
    ::  Our own tab, or a guest's, sitting in a leased room. Ours is handled
    ::  here; a guest's is carried to the owner's agent, which is the authority.
      %seat
    ?.  ?&((gth place.act 0) (lte place.act last-room:g))  `state
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
    ::  THE SESSION LEASE. See `live` in /sur. The same session renewing keeps
    ::  its generation; a new one taking over gets a new, larger one; a session
    ::  that is not live and does not `take` is told who is, and stands down.
      %session
    ?:  =(0 (met 3 tab.act))  `state
    =/  mint
      |=  prev=@ud
      ^-  (quip card state-11)
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
    ?.  ?&((gth place.act 0) ?|((lte place.act last-room:g) =(place.act vatican-room:g)) !=(rumors-room:g place.act) (lte (met 3 body.act) 8.192))
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
  ^-  [? state-11]
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
  ==
++  do-remote
  |=  [who=@p rem=remote:g]
  ^-  (quip card state-11)
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
      %room-event
    ?.  ?&((gth place.rem 0) ?|((lte place.rem last-room:g) =(place.rem vatican-room:g)) !=(rumors-room:g place.rem) (lte (met 3 body.rem) 8.192))
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
