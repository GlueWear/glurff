::  glurff-access: a call grant, delivered to the OWNER'S OWN browser only.
::
::  SECRET-BEARING. This carries a Galene join token and TURN credentials, both
::  short-lived. It exists only to hand them to the local session that asked;
::  it must never be given on a shared path, logged, or scried.
/-  gc=glurff-calls
|_  res=call-result:gc
++  grow
  |%
  ++  noun  res
  ++  json
    ^-  ^json
    =,  enjs:format
    ?-    -.res
        %failed
      %+  frond  'call-failed'
      %-  pairs
      :~  ['context' s+context.res]
          ['who' ?~(who.res ~ s+(scot %p u.who.res))]
          ['err' s+(crip (trip (scot %tas err.res)))]
      ==
    ::
        %granted
      =/  a  access.res
      %+  frond  'call-granted'
      %-  pairs
      :~  ['context' s+context.res]
          ['room' s+(crip (trip (scot %tas room.room-ref.a)))]
          ['gen' (numb gen.room-ref.a)]
          ['group' s+group.a]
          ['sfu' s+sfu.a]
          ['token' s+token.a]
          ['participant' s+(scot %p participant.a)]
          ['expires' (time expires.a)]
          ['renewAfter' (time renew-after.a)]
          :-  'ice'
          :-  %a
          %+  turn  ice.a
          |=  i=ice-server:gc
          %-  pairs
          :~  ['urls' a+(turn urls.i |=(u=@t s+u))]
              ['username' ?~(username.i ~ s+u.username.i)]
              ['credential' ?~(credential.i ~ s+u.credential.i)]
          ==
      ==
    ==
  --
++  grab
  |%
  ++  noun  call-result:gc
  --
++  grad  %noun
--
