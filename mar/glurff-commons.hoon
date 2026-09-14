::  glurff-commons: our own browser asking us to materialise one of the world's
::  fixed chat notes -- the commons, or a room.
::
::  The payload is a PLACE, never a note id. Every id is a constant in /sur and
::  the place is only a key into that table, so a caller still cannot steer
::  which note gets installed.
::
::  The mark keeps its original name because renaming one in Clay is a delete
::  and an add, and this mark never leaves the desk that defines it.
|_  place=@ud
++  grab
  |%
  ++  noun  @ud
  ++  json  |=(j=^json `@ud`(ni:dejs:format j))
  --
++  grow
  |%
  ++  noun  place
  --
++  grad  %noun
--
