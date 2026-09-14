::  glurff-grant: a room's host handing a credential to one participant.
::
::  NOUN ONLY. This carries a Galene join token and TURN credentials, both
::  short-lived secrets; an Eyre-reachable mark would put them one poke away
::  from any page.
::
::  A cross-ship poke needs its mark on the RECEIVING desk -- Gall builds the
::  dais there to validate the vase. Local agent-to-agent pokes do not, which is
::  why a mark missing here fails silently until two ships actually talk: the
::  host mints happily, the participant never hears about it, and the call looks
::  like it simply refused to connect.
/-  gc=glurff-calls
|_  res=call-result:gc
++  grab
  |%
  ++  noun  call-result:gc
  --
++  grow
  |%
  ++  noun  res
  --
++  grad  %noun
--
