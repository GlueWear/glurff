::  %glurff: a shared pixel world, with Noltbook underneath it.
::
::  WHAT THIS IS
::  The world and the bodies. Where people stand, what they look like, and which
::  ship is holding which room's call. It is a fan-out with almost no memory.
::
::  WHAT IT IS NOT
::  It stores no message, no contact list, no call roster and no chat history.
::  Those are Noltbook's, reached from the browser over the same Eyre channel
::  that serves this page. This agent never modifies the %noltbook desk.
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
+$  card  card:agent:gall
--
::
=|  state-3
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
  :_  this(look *look:g, rev 0, hosting ~, lease ~, sprite-lab %.n)
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
  =/  now-state=(unit state-3)
    =/  res  (mule |.(!<(state-3 old)))
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
  =/  parsed=(unit state-3)
    ?^  now-state  now-state
    =/  res  (mule |.(!<(state-2 old)))
    ?.  ?=(%| -.res)
      =/  was=state-2  p.res
      `[%3 look.was rev.was hosting.was (lift lease.was now.bowl) sprite-lab.was]
    =/  res  (mule |.(!<(state-1 old)))
    ?.  ?=(%| -.res)
      =/  was=state-1  p.res
      `[%3 look.was rev.was hosting.was (lift lease.was now.bowl) %.n]
    =/  res  (mule |.(!<(state-0 old)))
    ?:  ?=(%| -.res)  ~
    =/  was=state-0  p.res
    `[%3 look.was rev.was hosting.was ~ %.n]
  ?~  parsed  on-init
  :_  this(state u.parsed)
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
    :~  [%give %fact ~ %glurff-update !>(`update:g`[%our-look look rev sprite-lab])]
        ::  The lease outlives the tab, so a fresh page is told about it at
        ::  once rather than finding out when somebody walks in.
        [%give %fact ~ %glurff-update !>(`update:g`[%our-lease (shown:hc lease)])]
    ==
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
      :_  this(lease ~)
      %+  weld
        (spray:hc (sitters:hc u.lease) [%lease-gone place.h gen.h])
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
  ^-  (quip card state-3)
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
  ^-  (quip card state-3)
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
    :_  state(lease `h)
    (snoc cards (fact [%our-lease (shown `h)]))
  ::
      %unlease
    ?~  lease  `state
    :_  state(lease ~)
    ;:  weld
      ?~  armed.u.lease  ~
      ~[[%pass /lease %arvo %b %rest u.armed.u.lease]]
      ::  The people standing in the room are told by name. Releasing by hand
      ::  used to rely on our own browser republishing the roster, which is no
      ::  use to anybody once that browser is closed.
      (spray (sitters u.lease) [%lease-gone place.u.lease gen.u.lease])
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
      %lock
    ?.  (~(has by hosting) place.act)  `state
    :_  state(hosting (~(put by hosting) place.act mode.act))
    (spray peers.act [%hosting place.act mode.act])
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
++  do-remote
  |=  [who=@p rem=remote:g]
  ^-  (quip card state-3)
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
      %room-event
    ?.  ?&((gth place.rem 0) ?|((lte place.rem last-room:g) =(place.rem vatican-room:g)) !=(rumors-room:g place.rem) (lte (met 3 body.rem) 8.192))
      `state
    :_(state ~[(fact [%room-event who place.rem body.rem])])
  ::
      %refused
    :_(state ~[(fact [%refused who place.rem why.rem])])
  ::
      %knock
    ::  Someone is asking to be let into a room we hold. `%ask` is the browser's
    ::  decision, so it is surfaced rather than answered here; every other mode
    ::  is answered immediately, and a refusal is a value, never silence.
    =/  mode  (~(get by hosting) place.rem)
    ?~  mode
      :_(state ~[(tell who [%refused place.rem %not-hosting])])
    ?-    u.mode
        %locked  :_(state ~[(tell who [%refused place.rem %locked])])
        %ask     :_(state ~[(fact [%knocked who place.rem])])
    ::
        ?(%open %pals)
      ::  %pals is decided by the browser too -- the pal graph is Noltbook's and
      ::  this agent cannot see it. Surfacing the knock lets the client apply
      ::  the rule and mint, which keeps the graph where it belongs.
      ?:  ?=(%pals u.mode)
        :_(state ~[(fact [%knocked who place.rem])])
      ::  Admit the knocker to the existing room. Construct each tagged action
      ::  separately: a computed tag inside one tuple does not nest in the
      ::  calls action union.
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
  ==
--
--
