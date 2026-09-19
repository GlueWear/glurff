::  jpg: a photograph, carried as bytes.
::
::  The painted map is a JPEG, and Clay refuses any file it has no mark for:
::  "no-cast-between %mime %jpg", and the whole commit is rejected. The same
::  shape as mar/png.hoon, which is why that one works.
|_  dat=@
++  grow
  |%
  ++  mime  [/image/jpeg (as-octs:mimes:html dat)]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q.q)
  ++  noun  @
  --
++  grad  %mime
--
