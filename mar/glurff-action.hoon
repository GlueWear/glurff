::  glurff-action: our own browser -> our own agent.
::
::  JSON-reachable, so every arm that matters is guarded on src.bowl in the
::  agent. The peer set rides on every action because the agent keeps no
::  membership of its own -- see the note in /sur about it being cooperative.
/-  g=glurff
|_  act=action:g
++  grab
  |%
  ++  noun  action:g
  ++  json
    |=  jon=^json
    ^-  action:g
    ?>  ?=([%o *] jon)
    =/  obj  p.jon
    =/  op-nd  (need (~(get by obj) 'op'))
    ?>  ?=([%s *] op-nd)
    =/  op=@t  p.op-nd
    ::  peers: asserted by our own client from Noltbook's pal list.
    =/  peers=(list @p)
      =/  m  (~(get by obj) 'peers')
      ?~  m  ~
      ?.  ?=([%a *] u.m)  ~
      %+  murn  p.u.m
      |=  j=^json
      ?.  ?=([%s *] j)  ~
      (slaw %p p.j)
    =/  num
      |=  [key=@t dflt=@ud]
      ^-  @ud
      =/  v  (~(get by obj) key)
      ?~  v  dflt
      ?.  ?=([%n *] u.v)  dflt
      (rash p.u.v dem)
    =/  str
      |=  key=@t
      ^-  (unit @t)
      =/  v  (~(get by obj) key)
      ?~  v  ~
      ?.  ?=([%s *] u.v)  ~
      ?:(=('' p.u.v) ~ `p.u.v)
    =/  ship
      |=  key=@t
      ^-  (unit @p)
      =/  v  (str key)
      ?~(v ~ (slaw %p u.v))
    ?:  =('leave' op)  [%leave peers ~]
    ?:  =('ensure-commons' op)  [%ensure-commons peers ~]
    ?:  =('move' op)
      =/  d=dir:g
        =/  v  (str 'dir')
        ?~  v  %down
        ?:  =('up' u.v)     %up
        ?:  =('left' u.v)   %left
        ?:  =('right' u.v)  %right
        %down
      :*  %move  peers
          [(num 'place' 0) (num 'x' 0) (num 'y' 0) d]
          (num 'rev' 0)
          (ship 'host')
      ==
    ?:  =('dress' op)
      =/  lk=look:g
        =/  v  (~(get by obj) 'look')
        ?~  v  ~
        ?.  ?=([%o *] u.v)  ~
        %-  ~(gas by *look:g)
        %+  murn  ~(tap by p.u.v)
        |=  [k=@t j=^json]
        ^-  (unit [slot:g piece:g])
        =/  s=(unit slot:g)
          ?:  =('body' k)       `%body
          ?:  =('bottom' k)     `%bottom
          ?:  =('shoes' k)      `%shoes
          ?:  =('top' k)        `%top
          ?:  =('gloves' k)     `%gloves
          ?:  =('shoulders' k)  `%shoulders
          ?:  =('beard' k)      `%beard
          ?:  =('hair' k)       `%hair
          ?:  =('hat' k)        `%hat
          ~
        ?~  s  ~
        ?.  ?=([%o *] j)  ~
        =/  pt  (~(get by p.j) 'part')
        ?~  pt  ~
        ?.  ?=([%s *] u.pt)  ~
        =/  tn=(unit @ux)
          =/  t  (~(get by p.j) 'tint')
          ?~  t  ~
          ?.  ?=([%n *] u.t)  ~
          `(rash p.u.t dem)
        `[u.s [`@ta`p.u.pt tn]]
      [%dress peers lk]
    ::  A missing or malformed ship fails the poke rather than quietly
    ::  addressing some other ship.
    ?:  =('fetch-look' op)  [%fetch-look peers (need (ship 'who'))]
    ?:  =('claim' op)    [%claim peers (num 'place' 0)]
    ?:  =('release' op)  [%release peers (num 'place' 0)]
    ?:  =('lock' op)
      =/  m=lock-mode:g
        =/  v  (str 'mode')
        ?~  v  %open
        ?:  =('pals' u.v)    %pals
        ?:  =('ask' u.v)     %ask
        ?:  =('locked' u.v)  %locked
        %open
      [%lock peers (num 'place' 0) m]
    ?:  =('knock' op)
      [%knock peers (need (ship 'host')) (num 'place' 0)]
    ?:  =('splash' op)
      [%splash peers (need (ship 'target'))]
    ?:  =('presence-event' op)
      [%presence-event peers (need (str 'body'))]
    ?:  =('room-event' op)
      [%room-event peers (num 'place' 0) (need (str 'body'))]
    ?:  =('roll' op)
      =/  st=roll-stage:g
        =/  h  (str 'hash')
        ?~  h
          =/  s  (str 'secret')
          [%reveal ?~(s 0v0 (slav %uv u.s))]
        [%commit (slav %uv u.h)]
      [%roll peers (num 'place' 0) st]
    ~|(unknown-glurff-action+op !!)
  --
++  grow
  |%
  ++  noun  act
  --
++  grad  %noun
--
