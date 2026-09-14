::  glurff-room: our own browser asking us to open a room, or to admit somebody
::  to a room we already hold.
::
::  The distinction matters. %ensure-access CREATES the room, and creating one
::  that already exists bumps its generation, which invalidates every token
::  already issued -- everybody inside is thrown out with "join refused". So the
::  room is ensured exactly once, and everyone after that is issued access to
::  the existing room with %access.
|%
::  `session` makes a request id fresh per join attempt while staying stable
::  across retries of that attempt. Without it the id is a pure function of
::  [place, op, who], the Warden treats a later join as a repeat of the first
::  and hands back the ORIGINAL credentials -- which by then have expired, and
::  Galene answers join-refused.
+$  ask  [op=@tas place=@ud ttl=@ud session=@ud who=(list @p)]
--
|_  req=ask
++  grab
  |%
  ++  noun  ask
  ++  json
    |=  jon=^json
    ^-  ask
    ?>  ?=([%o *] jon)
    =/  obj  p.jon
    =/  num
      |=  [key=@t dflt=@ud]
      ^-  @ud
      =/  v  (~(get by obj) key)
      ?~  v  dflt
      ?.  ?=([%n *] u.v)  dflt
      (rash p.u.v dem)
    =/  op-nd  (need (~(get by obj) 'op'))
    ?>  ?=([%s *] op-nd)
    =/  who=(list @p)
      =/  m  (~(get by obj) 'who')
      ?~  m  ~
      ?.  ?=([%a *] u.m)  ~
      %+  murn  p.u.m
      |=  j=^json
      ?.  ?=([%s *] j)  ~
      (slaw %p p.j)
    =/  op=@tas
      ?:  =('open' p.op-nd)   %open
      ?:  ?|(=('admit' p.op-nd) =('access' p.op-nd))  %admit
      ?:  =('renew-access' p.op-nd)  %renew-access
      ?:  =('renew-room' p.op-nd)  %renew-room
      %close
    [op (num 'place' 0) (num 'ttl' 3.600) (num 'session' 0) who]
  --
++  grow
  |%
  ++  noun  req
  --
++  grad  %noun
--
