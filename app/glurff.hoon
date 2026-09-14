::  %glurff: a shared pixel world, with Noltbook underneath it.
::
::  WHAT THIS IS
::  The world and the bodies. Where people stand, what they look like, and which
::  ship is holding which room's call. It is a fan-out with almost no memory.
::
::  WHAT IT IS NOT
::  It stores no message, no contact list, no call roster and no chat history.
::  Those are Noltbook's, reached from the browser over the same Eyre channel
::  that serves this page. This agent NEVER modifies the %noltbook desk, and the
::  only thing it ever pokes there is a packet Noltbook already accepts from any
::  agent (see %glurff-commons below).
::
::  PRESENCE IS STATELESS
::  An incoming claim goes straight out as a fact to our own client and is
::  forgotten. A position that survived an agent restart would be a lie, and the
::  client ages entries out on a TTL anyway. That also means no presence map to
::  migrate, sweep or leak.
::
::  ON `peers`: COOPERATIVE, NOT ENFORCED
::  The peer set is asserted by our own client from Noltbook's pal list. We
::  cannot verify the pal graph without reaching into %noltbook, and a ship that
::  IS visible can claim any position it likes. Hygiene, not access control.
/-  g=glurff, gc=glurff-calls
/+  default-agent, dbug, verb, server, glurff-site, glurff-icon
/$  c1  %json  %glurff-action
/$  c2  %json  %glurff-room
/$  c3  %json  %glurff-commons
|%
+$  versioned-state  $%(state-0)
+$  state-0
  $:  %0
      ::  our own character, as a spec. Peers refetch when `rev` moves.
      =look:g
      rev=look-rev:g
      ::  rooms WE are holding, and how each answers a knock.
      hosting=(map place:g lock-mode:g)
  ==
+$  card  card:agent:gall
::
::  The packet Noltbook accepts to install a gossip note with a GIVEN id. Shaped
::  to nest under `remote:noltbook`; their mark is noun-only, so this can never
::  be reached from a browser.
+$  gossip-invite
  $:  %remote-gossip-invite
      note-id=@ta
      name=@t
      creator=@p
      users=(set @p)
      headline=(unit @t)
      icon-url=(unit @t)
  ==
--
::
=|  state-0
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
  :_  this(look *look:g, rev 0, hosting ~)
  [(bind:glurff-site) calls-watch:hc]
::
++  on-save  !>(state)
++  on-load
  |=  old=vase
  ^-  (quip card _this)
  ::  Anything we do not recognise -- including every shape the previous,
  ::  Turf-derived Glurff saved -- is discarded for a clean start rather than
  ::  crashing the agent. Nothing here is worth a migration.
  =/  parsed=(unit state-0)
    =/  res  (mule |.(!<(state-0 old)))
    ?:(?=(%| -.res) ~ `p.res)
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
  ::  Materialise one of the world's fixed chat notes. See sur/glurff for why
  ::  these are installed rather than created.
  ::
  ::  The CLIENT decides the note is absent: Noltbook's receiver REPLACES the
  ::  note and clears its messages, so asking for one that already exists would
  ::  throw away the commons' history.
      %glurff-commons
    ?>  =(src.bowl our.bowl)
    =/  place=@ud  !<(@ud vase)
    ::  The id comes from the table in /sur, never from the caller. A place we
    ::  have no note for -- Rumors, or anywhere that is not a room -- installs
    ::  nothing rather than inventing an id.
    ?:  !=(place 0)  [~ this]
    =/  spec  (note-for:g place)
    ?~  spec  [~ this]
    :_  this
    :~  :*  %pass  /commons-install
            %agent  [our.bowl %noltbook]  %poke
            %noltbook-remote
            !>  ^-  gossip-invite
            :*  %remote-gossip-invite
                id.u.spec
                name.u.spec
                our.bowl
                (sy ~[our.bowl])
                `headline.u.spec
                `glurff-icon
            ==
        ==
    ==
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
    ~[[%give %fact ~ %glurff-update !>(`update:g`[%our-look look rev])]]
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
  (on-arvo:def wire sign-arvo)
::
++  on-peek   on-peek:def
++  on-leave  on-leave:def
++  on-fail   on-fail:def
--
::
::  ------------------------------------------------------------ helper core
::
::  Everything except the ten Gall arms lives here. An agent door must have
::  exactly those arms, so the helpers take the bowl and the state as arguments
::  and hand back (quip card state-0), which the door threads with =^.
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
  ^-  (quip card state-0)
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
    [(fact [%our-look look.act next]) (spray peers.act [%here [0 0 0 %down] next ~])]
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
    ?.  ?&((gth place.act 0) (lth place.act 8) !=(5 place.act) (lte (met 3 body.act) 8.192))
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
  ^-  (quip card state-0)
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
      %room-event
    ?.  ?&((gth place.rem 0) (lth place.rem 8) !=(5 place.rem) (lte (met 3 body.rem) 8.192))
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
