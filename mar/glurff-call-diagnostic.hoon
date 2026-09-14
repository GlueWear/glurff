::  Safe quota details from our own Noltbook calls agent to our own browser.
::  Separate from glurff-access: never widen the existing call-result mold.
/-  gc=glurff-calls
|_  d=call-diagnostic:gc
++  grow
  |%
  ++  noun  d
  ++  json
    ^-  ^json
    =,  enjs:format
    %+  frond  'call-quota'
    %-  pairs
    :~  ['context' s+context.d]
        ['who' ?~(who.d ~ s+(scot %p u.who.d))]
        ['op' s+(scot %tas op.d)]
        ['detail' s+(scot %tas detail.d)]
    ==
  --
++  grab
  |%
  ++  noun  call-diagnostic:gc
  --
++  grad  %noun
--
