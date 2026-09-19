::  glurff-calls: local copies of the %noltbook-calls wire molds.
::
::  %glurff asks the %noltbook-calls agent -- which ships ON the %noltbook desk
::  -- for a Galene room and short-lived participant credentials. That agent
::  accepts a %noltbook-calls-action from ANY agent on our own ship and hands the
::  typed result back to whichever local agent the request named in `return`.
::  So the square's proximity huddles get a real SFU with NO change to %noltbook.
::
::  These molds are COPIES, kept here because a desk cannot reach into another
::  desk's /sur. They must stay structurally identical to
::  ships/zod/noltbook/sur/noltbook-calls.hoon: an agent-to-agent poke carries
::  the vase as-is, and the receiver nests it on ITS mold. If Noltbook's shape
::  changes, this file has to follow -- that is the price of not editing their
::  desk, and it is the right trade.
::
::  Nothing here is persisted. Correlation rides in `ctx`, which round-trips
::  untouched, so there is no pending-request state to migrate or to leak.
|%
::  ctx: an OPAQUE correlation token we choose and get back unchanged. It must
::  contain NO secret: it travels to the broker and back.
+$  ctx  @t
::
+$  service-mode  ?(%managed %custom)
::
::  A room reference always carries the generation and lease deadline.
+$  room-ref
  $:  room=@tas
      gen=@ud
      deadline=@da
  ==
::
::  One RTCIceServer entry. `username` and `credential` appear only on TURN
::  entries and are SHORT-LIVED SECRETS.
+$  ice-server
  $:  urls=(list @t)
      username=(unit @t)
      credential=(unit @t)
  ==
::
::  Everything the browser needs and nothing more. SECRET-BEARING: never log
::  it, never scry it, never put it in a shared fact.
+$  access
  $:  =room-ref
      group=@t
      sfu=@t
      location=@t
      token=@t
      participant=@p
      ice=(list ice-server)
      expires=@da
      renew-after=@da
  ==
::
::  Safe error categories. These are the ONLY failure values that cross a
::  boundary: never a bearer, a token, an upstream body, or a stack trace.
+$  call-error
  $?  %service-unavailable
      %unauthorized
      %room-unavailable
      %room-ended
      %quota
      %rate-limited
      %participant-limit
      %conflict
      %expired
      %malformed
  ==
::
::  The COMPLETE typed hand-off. `context` is the FIRST field of both variants,
::  at the same axis, so a receiver can read it without branching.
+$  call-result
  $%  [%granted context=ctx =access]
      [%failed context=ctx who=(unit @p) err=call-error]
  ==
::
::  Additive local diagnostics. The call-result and call-error molds above stay
::  unchanged so older Noltbook versions and peers remain compatible.
+$  quota-detail
  $?  %room
      %room-host
      %room-global
      %ticket
      %ticket-room
      %ticket-host
      %command
  ==
+$  call-diagnostic
  $%  [%quota context=ctx who=(unit @p) op=@tas detail=quota-detail]
  ==
::
+$  room-result
  $:  =room-ref
      group=@t
      state=@tas
      clients=@ud
  ==
::
::  LOCAL actions. The mark is noun-only, so Eyre cannot deliver one: a browser
::  can never ask for credentials directly. It must come through us.
+$  action
  $%  [%set-broker who=@p mode=service-mode]
      [%configure req=@ud broker=@p endpoint=@t key=(unit @t)]
      [%set-gateway-key key=@t]
      [%status req=@ud]
      [%ensure req=@ud room=@tas ttl=@ud]
      [%ensure-access req=@ud room=@tas ttl=@ud who=@p return=@tas context=ctx]
      [%renew req=@ud room=@tas ttl=@ud]
      [%room-status req=@ud room=@tas]
      [%evict req=@ud room=@tas who=@p]
      ::  Mute or unmute ONE participant on the call server (Galene "present":
      ::  the right to publish), then issue that participant fresh access,
      ::  strictly after the change -- the change itself revokes the
      ::  credentials they held. Added to Noltbook's published interface after
      ::  this copy was first made; the two are identical again.
      [%mute-access req=@ud room=@tas who=@p return=@tas context=ctx]
      [%unmute-access req=@ud room=@tas who=@p return=@tas context=ctx]
      [%end req=@ud room=@tas]
      [%access req=@ud room=@tas who=@p return=@tas context=ctx]
      [%renew-access req=@ud room=@tas who=@p return=@tas context=ctx]
      [%set-sfu-gate on=?]
  ==
::
::  ------------------------------------------------------- glurff's own
::
::  What our browser asks us for. The mark for this is JSON, so it IS reachable
::  from Eyre -- but only from our own session, and it can never reach
::  %noltbook-calls directly, because that mark is noun-only.
::
::  The browser names the huddle by its MEMBERS and a generation, never by a
::  room key: we derive the key ourselves so it cannot be steered into another
::  agent's namespace.
+$  huddle-action
  $%  ::  we are the elected authority for this huddle: make the room and mint
      ::  a credential for every member, ourselves included.
      [%ensure members=(list @p) gen=@ud ttl=@ud]
      ::  authority is leaving or the huddle dissolved.
      [%end members=(list @p) gen=@ud]
  ==
::
::  Authority -> member, over Ames. Credential-bearing: sent to exactly ONE
::  ship, the participant it was minted for. Never a fact, never a broadcast.
+$  grant
  $%  [%glurff-grant room=@tas gen=@ud =access]
  ==
--
