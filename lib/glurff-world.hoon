::  glurff-world: THE WORLD AS DATA (2026-11-04).
::
::  What a world's host keeps -- a JSON document and the images it names --
::  and what has to be true of it before visitors are given it. Pure: no
::  state, no cards. See `home` in /sur/glurff.
/-  g=glurff
|%
::  ------------------------------------------------------------- the bytes
::
::  An asset's id: the SHA-256 of its bytes as one big-endian number, so the
::  hex is what the browser's crypto.subtle gives for the same file.
++  hash-of
  |=  =octs
  ^-  hash:g
  (rev 3 32 (shay p.octs q.octs))
++  hex
  |=  h=hash:g
  ^-  @t
  (en:base16:mimes:html [32 h])
::  Sixty-four lowercase hex digits, and nothing else, is a hash.
++  unhex
  |=  t=@t
  ^-  (unit hash:g)
  ?.  =(64 (met 3 t))  ~
  =/  ok
    %+  levy  (trip t)
    |=(c=@tD ?|(&((gte c '0') (lte c '9')) &((gte c 'a') (lte c 'f'))))
  ?.  ok  ~
  (bind (de:base16:mimes:html t) tail)
::  Every hash a document names, wherever it names one (2026-11-08): what
::  the host's store has to keep for it. Any string, key or value, that is a
::  hash counts, so a field added later is never let go by mistake.
++  hashes-in
  |=  doc=json
  ^-  (set hash:g)
  =|  out=(set hash:g)
  =/  todo=(list json)  ~[doc]
  =/  put-hash
    |=  [t=@t s=(set hash:g)]
    ?~  h=(unhex t)  s
    (~(put in s) u.h)
  |-  ^+  out
  ?~  todo  out
  ?+  i.todo  $(todo t.todo)
    [%s *]  $(todo t.todo, out (put-hash p.i.todo out))
    [%a *]  $(todo (weld p.i.todo t.todo))
      [%o *]
    =/  kv=(list [k=@t v=json])  ~(tap by p.i.todo)
    %=  $
      todo  (weld (turn kv tail) t.todo)
      out   (~(uni in out) (roll (turn kv head) put-hash))
    ==
  ==
::  Byte `i` of some bytes, and numbers made of a few of them.
++  byte  |=([i=@ud d=@] (cut 3 [i 1] d))
++  be16  |=([i=@ud d=@] (rev 3 2 (cut 3 [i 2] d)))
++  be32  |=([i=@ud d=@] (rev 3 4 (cut 3 [i 4] d)))
++  le16  |=([i=@ud d=@] (cut 3 [i 2] d))
++  le24  |=([i=@ud d=@] (cut 3 [i 3] d))
::
::  ------------------------------------------------------------ the images
::
::  What a host may keep: images a browser draws and cannot run -- no SVG --
::  sounds it plays (2026-11-08), and JSON for its documents.
++  mimes
  ^-  (set @t)
  %-  silt
  :~  'image/jpeg'  'image/png'  'image/webp'
      'audio/mpeg'  'audio/ogg'  'audio/mp4'  'audio/webm'
      'application/json'
  ==
++  image  |=(m=@t =('image/' (end [3 6] m)))
++  audio  |=(m=@t =('audio/' (end [3 6] m)))
::  An area's sound is a loop visitors fetch from the host's ship: small.
++  sound-max  2.097.152
::  Whether some bytes start the way a sound of their type does.
++  sound-ok
  |=  [mime=@t =octs]
  ^-  ?
  =*  d  q.octs
  ?:  (lth p.octs 12)  |
  ?:  =('audio/mpeg' mime)
    ?|  =('ID3' (cut 3 [0 3] d))
        ?&(=(0xff (byte 0 d)) =(0xe0 (dis 0xe0 (byte 1 d))))
    ==
  ?:  =('audio/ogg' mime)  =('OggS' (cut 3 [0 4] d))
  ?:  =('audio/mp4' mime)  =('ftyp' (cut 3 [4 4] d))
  ?:  =('audio/webm' mime)  =(0xa3df.451a (cut 3 [0 4] d))
  |
::  How big an image is, read from its header; `~` if it is not what it says.
::  The size a browser will decode it at, which is what the world's
::  geometry is drawn against.
++  image-size
  |=  [mime=@t =octs]
  ^-  (unit [w=@ud h=@ud])
  =*  d  q.octs
  =*  n  p.octs
  ?:  =('image/png' mime)
    ::  The signature, then IHDR: width and height, four bytes each.
    ?.  (gte n 24)  ~
    ?.  =(0xa1a.0a0d.474e.5089 (cut 3 [0 8] d))  ~
    `[(be32 16 d) (be32 20 d)]
  ?:  =('image/jpeg' mime)
    ::  Segment by segment to the first frame header: FF Cn, its length,
    ::  its precision, then height and width.
    ?.  ?&((gte n 4) =(0xd8ff (cut 3 [0 2] d)))  ~
    =/  i=@ud  2
    |-  ^-  (unit [w=@ud h=@ud])
    ?.  (lth (add i 9) n)  ~
    ?.  =(0xff (byte i d))  ~
    =/  m=@ud  (byte +(i) d)
    ?:  =(0xff m)  $(i +(i))
    ?:  ?|(=(0xd8 m) =(0x1 m) &((gte m 0xd0) (lte m 0xd7)))
      $(i (add i 2))
    ?:  ?&((gte m 0xc0) (lte m 0xcf) !=(m 0xc4) !=(m 0xc8) !=(m 0xcc))
      `[(be16 (add i 7) d) (be16 (add i 5) d)]
    $(i (add i (add 2 (be16 (add i 2) d))))
  ?:  =('image/webp' mime)
    ?.  (gte n 30)  ~
    ?.  ?&(=('RIFF' (cut 3 [0 4] d)) =('WEBP' (cut 3 [8 4] d)))  ~
    =/  kind=@t  (cut 3 [12 4] d)
    ?:  =('VP8X' kind)  `[+((le24 24 d)) +((le24 27 d))]
    ?:  =('VP8L' kind)
      ?.  =(0x2f (byte 20 d))  ~
      =/  b=@  (cut 3 [21 4] d)
      `[+((end [0 14] b)) +((cut 0 [14 14] b))]
    ?:  =('VP8 ' kind)
      `[(end [0 14] (le16 26 d)) (end [0 14] (le16 28 d))]
    ~
  ~
::  The largest image a host keeps, on either side and in all. The editor
::  makes smaller copies for visitors; these bound the original.
++  side-max    16.384
++  pixels-max  67.108.864
::
::  ---------------------------------------------------------- the document
::
::  A world's document, schema 1, as world/world-doc.js describes it, and
::  checked here by the same rules: the browser that saved it is not the
::  last word. Geometry is computed in doubles, as the browser computes it,
::  so a point this agent finds inside a wall is the one the editor showed
::  inside a wall.
::
::  Which versions of the document this agent can check and serve.
++  schemas  `(set @ud)`(silt ~[1])
::  How much one world may hold (LIMITS in world/world-doc.js).
++  maps-max      10
++  areas-max     64
++  items-max     256
++  arrivals-max  64
++  ops-max       4.000
++  points-max    20.000
++  cells-max     4.194.304
++  kinds
  ^-  (set @t)
  (silt ~['web' 'app' 'artifact' 'video' 'portal' 'travel' 'text' 'links' 'none' 'npc' 'collect'])
::  What a character's choices do: what a tapped item does (2026-11-08).
++  npc-does  `(set @t)`(silt ~['web' 'app' 'portal' 'travel' 'text' 'links'])
++  triggers  `(set @t)`(silt ~['click' 'walk' 'phrase'])
++  traits    `(set @t)`(silt ~['rumors' 'unlock' 'dice'])
++  facings   `(set @t)`(silt ~['up' 'down' 'left' 'right'])
::
::  json helpers: a field of an object, a string, a whole number, a real
::  number, a list, a flag; and whether a field is absent or null.
++  get
  |=  [j=json k=@t]
  ^-  (unit json)
  ?.  ?=([%o *] j)  ~
  (~(get by p.j) k)
++  str
  |=  j=(unit json)
  ^-  (unit @t)
  ?.  ?=([~ %s *] j)  ~
  `p.u.j
++  num
  |=  j=(unit json)
  ^-  (unit @ud)
  ?.  ?=([~ %n *] j)  ~
  (rush p.u.j dem)
++  real
  |=  j=(unit json)
  ^-  (unit @rd)
  ?.  ?=([~ %n *] j)  ~
  (ne:dejs-soft:format u.j)
++  many
  |=  j=(unit json)
  ^-  (unit (list json))
  ?.  ?=([~ %a *] j)  ~
  `p.u.j
++  flag
  |=  j=(unit json)
  ^-  (unit ?)
  ?.  ?=([~ %b *] j)  ~
  `p.u.j
++  none  |=(j=(unit json) ?|(?=(~ j) ?=([~ ~] j)))
::  The document's version, if it says one.
++  schema-of
  |=  doc=json
  ^-  (unit @ud)
  (num (get doc 'schema'))
::
::  ------------------------------------------------------- names and ids
::
++  lower  |=(c=@tD &((gte c 'a') (lte c 'z')))
++  upper  |=(c=@tD &((gte c 'A') (lte c 'Z')))
++  digit  |=(c=@tD &((gte c '0') (lte c '9')))
::  An id: lowercase letters, digits and dashes, starting with a letter or
::  a digit, at most 48 of them.
++  id-ok
  |=  t=(unit @t)
  ^-  ?
  ?~  t  |
  =/  c=tape  (trip u.t)
  ?~  c  |
  ?&  (lte (lent c) 48)
      |((lower i.c) (digit i.c))
      (levy t.c |=(d=@tD ?|((lower d) (digit d) =('-' d))))
  ==
::  A note's id, as Noltbook makes them.
++  note-ok
  |=  t=(unit @t)
  ^-  ?
  ?~  t  |
  =/  c=tape  (trip u.t)
  ?~  c  |
  ?&  (lte (lent c) 96)
      |((lower i.c) (digit i.c))
      (levy t.c |=(d=@tD ?|((lower d) (digit d) =('-' d) =('~' d) =('.' d))))
  ==
::  Something to call a thing: not blank, and not long.
++  name-ok
  |=  [t=(unit @t) max=@ud]
  ^-  ?
  ?~  t  |
  ?&  (lte (lent (tuba (trip u.t))) max)
      (lien (trip u.t) |=(c=@tD (gth c ' ')))
  ==
::  An https address with no spaces in it.
++  https-ok
  |=  t=(unit @t)
  ^-  ?
  ?~  t  |
  =/  c=tape  (trip u.t)
  ?&  =("https://" (scag 8 c))
      (gth (lent c) 8)
      (lte (lent c) 2.000)
      (levy c |=(d=@tD (gth d ' ')))
  ==
++  ship-ok  |=(t=(unit @t) ?~(t | ?=(^ (slaw %p u.t))))
++  desk-ok
  |=  t=(unit @t)
  ^-  ?
  ?~  t  |
  ?&(!=('' u.t) (lte (met 3 u.t) 64) ((sane %tas) u.t))
::  An app context's key: a letter, then letters, digits and dashes.
++  key-ok
  |=  k=@t
  ^-  ?
  =/  c=tape  (trip k)
  ?~  c  |
  ?&  (lte (lent c) 32)
      |((lower i.c) (upper i.c))
      (levy t.c |=(d=@tD ?|((lower d) (upper d) (digit d) =('-' d))))
  ==
::
::  -------------------------------------------------------------- shapes
::
::  One drawn operation (world/world-doc.js), its numbers as doubles.
+$  part
  $%  [%rect x=@rd y=@rd w=@rd h=@rd]
      [%ellipse x=@rd y=@rd rx=@rd ry=@rd]
      [%poly p=(list [x=@rd y=@rd])]
      [%line p=(list [x=@rd y=@rd]) r=@rd]
      [%bits x=@rd y=@rd cell=@ud cols=@ud rows=@ud data=@]
      [%runs x=@rd y=@rd cell=@ud cols=@ud r=(list [at=@ud n=@ud])]
  ==
::  ...or several as one: an item or a door drawn in parts, never a group of
::  groups (so the mold is not recursive).
+$  shape
  $%  [%rect x=@rd y=@rd w=@rd h=@rd]
      [%ellipse x=@rd y=@rd rx=@rd ry=@rd]
      [%poly p=(list [x=@rd y=@rd])]
      [%line p=(list [x=@rd y=@rd]) r=@rd]
      [%bits x=@rd y=@rd cell=@ud cols=@ud rows=@ud data=@]
      [%runs x=@rd y=@rd cell=@ud cols=@ud r=(list [at=@ud n=@ud])]
      [%group p=(list part)]
  ==
++  zero  (sun:rd 0)
++  one   (sun:rd 1)
++  two   (sun:rd 2)
::  Rounded down, for a number that is not negative.
++  floor
  |=  a=@rd
  ^-  @ud
  (abs:si (need (~(toi rd %d) a)))
::  A whole number, perhaps negative, given as a real.
++  whole
  |=  r=(unit @rd)
  ^-  (unit @s)
  ?~  r  ~
  =/  i  (~(toi rd %z) u.r)
  ?~  i  ~
  ?.  (equ:rd (san:rd u.i) u.r)  ~
  i
::  Several fields, all real numbers, or nothing.
++  reals
  |=  [j=json ks=(list @t)]
  ^-  (unit (list @rd))
  ?~  ks  `~
  =/  a  (real (get j i.ks))
  ?~  a  ~
  =/  b  $(ks t.ks)
  ?~  b  ~
  `[u.a u.b]
::  A list of real numbers, or nothing.
++  numbers
  |=  j=(unit json)
  ^-  (unit (list @rd))
  =/  l  (many j)
  ?~  l  ~
  =/  l=(list json)  u.l
  =|  out=(list @rd)
  |-  ^-  (unit (list @rd))
  ?~  l  `(flop out)
  =/  a  (real `i.l)
  ?~  a  ~
  $(l t.l, out [u.a out])
::  A list of points, given as x0, y0, x1, y1 ...
++  points
  |=  j=(unit json)
  ^-  (unit (list [x=@rd y=@rd]))
  =/  l  (numbers j)
  ?~  l  ~
  ?.  ?&(=(0 (mod (lent u.l) 2)) (lte (lent u.l) points-max))  ~
  =/  l=(list @rd)  u.l
  =|  out=(list [x=@rd y=@rd])
  |-  ^-  (unit (list [x=@rd y=@rd]))
  ?~  l  `(flop out)
  ?~  t.l  ~
  $(l t.t.l, out [[i.l i.t.l] out])
::  A list of whole numbers, none negative, or nothing.
++  wholes
  |=  j=(unit json)
  ^-  (unit (list @ud))
  =/  l  (many j)
  ?~  l  ~
  =/  l=(list json)  u.l
  =|  out=(list @ud)
  |-  ^-  (unit (list @ud))
  ?~  l  `(flop out)
  =/  n  (num `i.l)
  ?~  n  ~
  $(l t.l, out [u.n out])
++  pairs
  |=  l=(list @ud)
  ^-  (list [at=@ud n=@ud])
  ?~  l  ~
  ?~  t.l  ~
  [[i.l i.t.l] $(l t.t.l)]
::  An operation's shape, or what is wrong with it.
++  shape-of
  |=  j=json
  ^-  (each shape @t)
  ?.  ?=([%o *] j)  |+'is not a shape'
  =/  t=(unit @t)  (str (get j 't'))
  ?:  =(`'rect' t)
    =/  v  (reals j ~['x' 'y' 'w' 'h'])
    ?~  v  |+'a rectangle needs x, y, w, h'
    ?.  ?&((gth:rd (snag 2 u.v) zero) (gth:rd (snag 3 u.v) zero))
      |+'a rectangle needs x, y, w, h'
    &+[%rect (snag 0 u.v) (snag 1 u.v) (snag 2 u.v) (snag 3 u.v)]
  ?:  =(`'ellipse' t)
    =/  v  (reals j ~['x' 'y' 'rx' 'ry'])
    ?~  v  |+'an ellipse needs x, y, rx, ry'
    ?.  ?&((gth:rd (snag 2 u.v) zero) (gth:rd (snag 3 u.v) zero))
      |+'an ellipse needs x, y, rx, ry'
    &+[%ellipse (snag 0 u.v) (snag 1 u.v) (snag 2 u.v) (snag 3 u.v)]
  ?:  =(`'poly' t)
    =/  p  (points (get j 'p'))
    ?.  ?&(?=(^ p) (gte (lent u.p) 3))  |+'a polygon needs three corners'
    &+[%poly u.p]
  ?:  =(`'line' t)
    =/  p  (points (get j 'p'))
    =/  r  (real (get j 'r'))
    ?.  ?&(?=(^ p) ?=(^ u.p) ?=(^ r) (gth:rd u.r zero))
      |+'a stroke needs points and a radius'
    &+[%line u.p u.r]
  ?:  =(`'bits' t)
    =/  x  (whole (real (get j 'x')))
    =/  y  (whole (real (get j 'y')))
    =/  cell  (num (get j 'cell'))
    =/  cols  (num (get j 'cols'))
    =/  rows  (num (get j 'rows'))
    ?.  ?&  ?=(^ x)  ?=(^ y)  ?=(^ cell)  ?=(^ cols)  ?=(^ rows)
            (gte u.cell 1)  (gte u.cols 1)  (gte u.rows 1)
        ==
      |+'a bitmap needs x, y, cell, cols, rows'
    =/  data  (str (get j 'data'))
    ?~  data  |+'a bitmap needs its data'
    =/  b  (de:base64:mimes:html u.data)
    ?~  b  |+'a bitmap needs base64 data'
    ?.  (gte p.u.b (div (add (mul u.cols u.rows) 7) 8))
      |+'a bitmap is shorter than its size'
    &+[%bits (san:rd u.x) (san:rd u.y) u.cell u.cols u.rows q.u.b]
  ?:  =(`'runs' t)
    =/  x  (whole (real (get j 'x')))
    =/  y  (whole (real (get j 'y')))
    =/  cell  (num (get j 'cell'))
    =/  cols  (num (get j 'cols'))
    =/  r  (wholes (get j 'r'))
    ?.  ?&  ?=(^ x)  ?=(^ y)  ?=(^ cell)  ?=(^ cols)  ?=(^ r)
            (gte u.cell 1)  (gte u.cols 1)
            =(0 (mod (lent u.r) 2))  (lte (lent u.r) points-max)
        ==
      |+'runs need x, y, cell, cols and pairs'
    &+[%runs (san:rd u.x) (san:rd u.y) u.cell u.cols (pairs u.r)]
  ?:  =(`'group' t)
    ::  several shapes as one: an item or a door drawn in parts
    =/  l  (many (get j 'p'))
    ?.  ?&(?=(^ l) !=(~ u.l) (lte (lent u.l) 64))  |+'a group needs 1-64 shapes'
    =|  out=(list part)
    =/  l=(list json)  u.l
    |-  ^-  (each shape @t)
    ?~  l  &+[%group (flop out)]
    ?:  =(`'group' (str (get i.l 't')))  |+'a group cannot hold a group'
    =/  r  ^$(j i.l)
    ?:  ?=(%| -.r)  |+(cat 3 'a group shape: ' p.r)
    ?:  ?=(%group -.p.r)  |+'a group cannot hold a group'
    $(l t.l, out [p.r out])
  |+(rap 3 'unknown shape ' ?~(t '?' u.t) ~)
::
++  sq  |=(a=@rd (mul:rd a a))
::  How far a point is from a segment, squared.
++  seg2
  |=  [x=@rd y=@rd a=[x=@rd y=@rd] b=[x=@rd y=@rd]]
  ^-  @rd
  =/  dx  (sub:rd x.b x.a)
  =/  dy  (sub:rd y.b y.a)
  =/  len  (add:rd (sq dx) (sq dy))
  =/  t=@rd
    ?:  (equ:rd len zero)  zero
    (div:rd (add:rd (mul:rd (sub:rd x x.a) dx) (mul:rd (sub:rd y y.a) dy)) len)
  =.  t  ?:((lth:rd t zero) zero ?:((gth:rd t one) one t))
  =/  qx  (sub:rd (add:rd x.a (mul:rd t dx)) x)
  =/  qy  (sub:rd (add:rd y.a (mul:rd t dy)) y)
  (add:rd (sq qx) (sq qy))
::  Does an operation cover the point?
++  covers
  |=  [s=shape x=@rd y=@rd]
  ^-  ?
  ?-    -.s
      %rect
    ?&  (gte:rd x x.s)  (gte:rd y y.s)
        (lth:rd x (add:rd x.s w.s))  (lth:rd y (add:rd y.s h.s))
    ==
  ::
      %ellipse
    =/  dx  (div:rd (sub:rd x x.s) rx.s)
    =/  dy  (div:rd (sub:rd y y.s) ry.s)
    (lte:rd (add:rd (sq dx) (sq dy)) one)
  ::
      %poly
    ?~  p.s  |
    =/  q=(list [x=@rd y=@rd])  p.s
    =/  j=[x=@rd y=@rd]  (rear p.s)
    =/  in=?  |
    |-  ^-  ?
    ?~  q  in
    =/  i=[x=@rd y=@rd]  i.q
    =/  hit=?
      ?&  !=((gth:rd y.i y) (gth:rd y.j y))
          %+  lth:rd  x
          %+  add:rd  x.i
          (div:rd (mul:rd (sub:rd x.j x.i) (sub:rd y y.i)) (sub:rd y.j y.i))
      ==
    $(q t.q, j i, in ?:(hit !in in))
  ::
      %line
    =/  r2  (sq r.s)
    ?~  p.s  |
    ?~  t.p.s
      (lte:rd (add:rd (sq (sub:rd x x.i.p.s)) (sq (sub:rd y y.i.p.s))) r2)
    =/  q=(list [x=@rd y=@rd])  p.s
    |-  ^-  ?
    ?~  q  |
    ?~  t.q  |
    ?:  (lte:rd (seg2 x y i.q i.t.q) r2)  &
    $(q t.q)
  ::
      %bits
    ?:  ?|((lth:rd x x.s) (lth:rd y y.s))  |
    =/  cx  (floor (div:rd (sub:rd x x.s) (sun:rd cell.s)))
    =/  cy  (floor (div:rd (sub:rd y y.s) (sun:rd cell.s)))
    ?:  ?|((gte cx cols.s) (gte cy rows.s))  |
    =(1 (cut 0 [(add (mul cy cols.s) cx) 1] data.s))
  ::
      %runs
    ?:  ?|((lth:rd x x.s) (lth:rd y y.s))  |
    =/  cx  (floor (div:rd (sub:rd x x.s) (sun:rd cell.s)))
    =/  cy  (floor (div:rd (sub:rd y y.s) (sun:rd cell.s)))
    ?:  (gte cx cols.s)  |
    =/  i  (add (mul cy cols.s) cx)
    (lien r.s |=([at=@ud n=@ud] &((gte i at) (lth i (add at n)))))
  ::
      %group
    (lien p.s |=(o=part ^$(s o)))
  ==
::  The value of the cell under a point: the last operation that covers the
::  cell's centre, else 0 (`sample` in world/world-doc.js). The point is not
::  negative.
++  sample
  |=  [ops=(list [s=shape v=@ud]) grid=@ud x=@rd y=@rd]
  ^-  @ud
  =/  g  (sun:rd grid)
  =/  px  (add:rd (mul:rd (sun:rd (floor (div:rd x g))) g) (div:rd g two))
  =/  py  (add:rd (mul:rd (sun:rd (floor (div:rd y g))) g) (div:rd g two))
  =|  out=@ud
  |-  ^-  @ud
  ?~  ops  out
  $(ops t.ops, out ?:((covers s.i.ops px py) v.i.ops out))
::
::  ---------------------------------------------------------- the checks
::
::  What the checks have found so far, going through a document.
+$  acc
  $:  bad=(list @t)
      used=(set hash:g)
      maps=(set @t)
      map-nums=(set @ud)
      areas=(set @t)
      area-nums=(set @ud)
      items=(set @t)
      arrivals=(set @t)
      portals=(list [at=@t to=@t])
      mains=@ud
  ==
::  The assets table as the host holds it: type, bytes, and an image's size.
+$  table  (map hash:g [mime=@t size=@ud dims=(unit [w=@ud h=@ud])])
::
::  CAN THIS BE PUBLISHED. Every error, in order, or what visitors may
::  fetch: the assets the document lists and uses.
++  check
  |=  [doc=json have=(map hash:g asset:g)]
  ^-  (each (set hash:g) (list @t))
  ?.  ?=([%o *] doc)  |+~['the document is not an object']
  =/  v=(unit @ud)  (schema-of doc)
  ?~  v  |+~['the document says no schema']
  ?.  (~(has in schemas) u.v)
    |+~[(rap 3 'unsupported schema ' (scot %ud u.v) ~)]
  =|  a=acc
  =^  tab  a  (a-table doc have a)
  =.  a  (a-world doc tab a)
  =/  rows=(list [h=hash:g *])  ~(tap by tab)
  =.  a
    |-  ^-  acc
    ?~  rows  a
    ?:  (~(has in used.a) h.i.rows)  $(rows t.rows)
    =/  at  (rap 3 'assets.' (end [3 8] (hex h.i.rows)) ~)
    $(rows t.rows, bad.a [(cat 3 at ': is listed but nothing uses it') bad.a])
  ?~  bad.a  &+used.a
  |+(flop bad.a)
::
::  The assets table: each asset once, with the type and size the host
::  holds it as.
++  a-table
  |=  [doc=json have=(map hash:g asset:g) a=acc]
  ^-  [table acc]
  =/  tab  (get doc 'assets')
  ?.  ?=([~ %o *] tab)  [~ a(bad ['the document has no assets table' bad.a])]
  =/  rows=(list [k=@t v=json])  ~(tap by p.u.tab)
  =|  out=table
  |-  ^-  [table acc]
  ?~  rows  [out a]
  =/  k=@t  k.i.rows
  =/  at  (rap 3 'assets.' (end [3 8] k) ~)
  =/  h=(unit hash:g)  (unhex k)
  ?~  h  $(rows t.rows, bad.a [(rap 3 'assets: not an asset id: ' k ~) bad.a])
  =/  m=(unit @t)  (str (get v.i.rows 'mime'))
  =/  z=(unit @ud)  (num (get v.i.rows 'size'))
  ?.  ?&(?=(^ m) ?=(^ z) (gte u.z 1))
    $(rows t.rows, bad.a [(cat 3 at ': needs a mime and a size') bad.a])
  =/  held=(unit asset:g)  (~(get by have) u.h)
  ?~  held
    $(rows t.rows, bad.a [(cat 3 at ': is not held by the host') bad.a])
  =?  bad.a  ?|(!=(mime.u.held u.m) !=(size.u.held u.z))
    [(cat 3 at ': does not match what the host holds') bad.a]
  =/  dims  ?.((image u.m) ~ (image-size u.m [size.u.held data.u.held]))
  $(rows t.rows, out (~(put by out) u.h [u.m u.z dims]))
::
::  The world: its name, its maps, the arrival visitors enter at, and
::  every portal's destination.
++  a-world
  |=  [doc=json tab=table a=acc]
  ^-  acc
  =/  wj=json  (fall (get doc 'world') ~)
  =?  bad.a  !(name-ok (str (get wj 'name')) 64)  ['world: needs a name' bad.a]
  =/  ms=(list json)  (fall (many (get doc 'maps')) ~)
  =?  bad.a  ?=(~ ms)  ['a world needs a map' bad.a]
  =?  bad.a  (gth (lent ms) maps-max)  ['a world has at most 10 maps' bad.a]
  =.  a
    =/  i=@ud  0
    |-  ^-  acc
    ?~  ms  a
    $(ms t.ms, i +(i), a (a-map i.ms i tab a))
  =/  entry  (str (get wj 'entry'))
  =?  bad.a  ?|(!(id-ok entry) !(~(has in arrivals.a) (need entry)))
    ['world: its entry is not an arrival point' bad.a]
  ::  somewhere, an area that is the world's chat
  =?  bad.a  =(0 mains.a)  ['world: needs an area that is the world chat' bad.a]
  =/  ps  (flop portals.a)
  |-  ^-  acc
  ?~  ps  a
  ?:  (~(has in arrivals.a) to.i.ps)  $(ps t.ps)
  $(ps t.ps, bad.a [(rap 3 at.i.ps ': leads to no arrival point: ' to.i.ps ~) bad.a])
::
++  a-map
  |=  [m=json i=@ud tab=table a=acc]
  ^-  acc
  =/  mid=(unit @t)  (str (get m 'id'))
  =/  at=@t  (cat 3 'map ' ?~(mid (scot %ud i) u.mid))
  =/  say  |=(t=@t ^-(@t (rap 3 at ': ' t ~)))
  ?.  ?=([%o *] m)  a(bad [(say 'is not an object') bad.a])
  =?  bad.a  !(id-ok mid)
    [(say 'needs an id of lowercase letters, digits and dashes') bad.a]
  =?  bad.a  ?&((id-ok mid) (~(has in maps.a) (need mid)))
    [(say 'repeats an id') bad.a]
  =?  maps.a  (id-ok mid)  (~(put in maps.a) (need mid))
  =/  n=(unit @ud)  (num (get m 'num'))
  =?  bad.a  ?|(?=(~ n) (gth u.n 63))  [(say 'needs a number 0-63') bad.a]
  =?  bad.a  ?&(?=(^ n) (~(has in map-nums.a) u.n))  [(say 'repeats a number') bad.a]
  =?  map-nums.a  ?=(^ n)  (~(put in map-nums.a) u.n)
  =?  bad.a  !(name-ok (str (get m 'name')) 64)  [(say 'needs a name') bad.a]
  =/  sz=(list json)  (fall (many (get m 'size')) ~)
  =/  sw=(unit @ud)  ?.(?=([* * ~] sz) ~ (num `i.sz))
  =/  sh=(unit @ud)  ?.(?=([* * ~] sz) ~ (num `i.t.sz))
  ?.  ?&  ?=(^ sw)  ?=(^ sh)
          (gte u.sw 1)  (gte u.sh 1)  (lte u.sw side-max)  (lte u.sh side-max)
      ==
    a(bad [(say 'needs a size of whole pixels, at most 16.384 a side') bad.a])
  ::  no background picture: a map in space (2026-11-08)
  =?  a  !(none (get m 'image'))
    (an-image (cat 3 at ' background') (get m 'image') tab a)
  =?  a  !(none (get m 'over'))
    (an-image (cat 3 at ' foreground image') (get m 'over') tab a)
  ::  what is painted over it (2026-11-08)
  =?  a  !(none (get m 'paint'))
    (a-paint (cat 3 at ' painting') (get m 'paint') tab a)
  =/  px=@ud  (fall (num (get m 'unit')) 0)
  =?  bad.a  ?|(=(0 px) (gth px 1.024))  [(say 'needs a unit: pixels per step') bad.a]
  =/  g=@ud  (fall (num (get m 'grid')) 0)
  =/  grid-ok=?  ?&((gte g 1) (lte g 64))
  =?  bad.a  !grid-ok  [(say 'needs a grid of 1-64 pixels') bad.a]
  =?  bad.a
      ?&  grid-ok
          %+  gth
            (mul (div (add u.sw (dec g)) g) (div (add u.sh (dec g)) g))
          cells-max
      ==
    [(say 'grid is too fine for the map: make its cells bigger') bad.a]
  ::  how a character stands and walks here
  =/  ch=json  (fall (get m 'character') ~)
  =/  scale  (real (get ch 'scale'))
  =?  bad.a  ?|(?=(~ scale) !(gth:rd u.scale zero) (gth:rd u.scale (sun:rd 16)))
    [(say 'character needs a scale') bad.a]
  =/  speed  (real (get ch 'speed'))
  =?  bad.a  ?|(?=(~ speed) !(gth:rd u.speed zero) (gth:rd u.speed (sun:rd 40)))
    [(say 'character needs a speed') bad.a]
  =/  label  (real (get ch 'label'))
  =?  bad.a  ?|(?=(~ label) (lth:rd u.label two) (gth:rd u.label (sun:rd 48)))
    [(say 'character needs a name size') bad.a]
  =/  probe  (whole (real (get ch 'probe')))
  =?  bad.a  ?|(?=(~ probe) (gth (abs:si u.probe) 1.024))
    [(say 'character needs a probe height') bad.a]
  =/  shift  (get m 'shiftY')
  =/  sy  (whole (real shift))
  =?  bad.a  ?&(!(none shift) ?|(?=(~ sy) (gth (abs:si u.sy) 1.024)))
    [(say 'shiftY must be whole pixels') bad.a]
  ::  its layers and areas
  =^  walls  a  (a-layer (cat 3 at ' walls') (get m 'walk') ~ a)
  =^  front  a  (a-layer (cat 3 at ' foreground') (get m 'front') ~ a)
  =/  as=(list json)  (fall (many (get m 'areas')) ~)
  =?  bad.a  (gth (lent as) areas-max)  [(say 'has more than 64 areas') bad.a]
  =^  found  a  (a-areas as tab a)
  =/  here=(set @t)  -.found
  =.  mains.a  (add mains.a +.found)
  =^  zones  a  (a-layer (cat 3 at ' areas') (get m 'zones') `here a)
  ::  the walls: those drawn, then each placed image that blocks (`wallsOf`
  ::  in world/world-doc.js)
  =/  is=(list json)  (fall (many (get m 'items')) ~)
  =.  walls  (weld walls (blocking is))
  ::  its arrivals, each somewhere a character can stand
  =/  ar=(list json)  (fall (many (get m 'arrivals')) ~)
  =?  bad.a  (gth (lent ar) arrivals-max)  [(say 'has more than 64 arrival points') bad.a]
  =/  pr=@rd  ?~(probe zero (san:rd u.probe))
  =/  sf=@rd  ?~(sy zero (san:rd u.sy))
  =/  stand
    |=  [x=@rd y=@rd]
    ^-  ?
    =/  py  (sub:rd (sub:rd y pr) sf)
    ?:  ?|  (lth:rd x zero)  (lth:rd py zero)
            (gte:rd x (sun:rd u.sw))  (gte:rd py (sun:rd u.sh))
        ==
      |
    ?.  grid-ok  &
    =(0 (sample walls g x py))
  =.  a
    =/  l=(list json)  ar
    |-  ^-  acc
    ?~  l  a
    =/  p=json  i.l
    =/  pid  (str (get p 'id'))
    =/  where  (cat 3 'arrival ' ?~(pid '?' u.pid))
    =/  say  |=(t=@t ^-(@t (rap 3 where ': ' t ~)))
    ?.  (id-ok pid)  $(l t.l, bad.a [(say 'needs an id') bad.a])
    =?  bad.a  (~(has in arrivals.a) (need pid))  [(say 'repeats an id') bad.a]
    =.  arrivals.a  (~(put in arrivals.a) (need pid))
    =/  x  (real (get p 'x'))
    =/  y  (real (get p 'y'))
    ?:  |(?=(~ x) ?=(~ y))  $(l t.l, bad.a [(say 'needs a position') bad.a])
    =/  dir  (get p 'dir')
    =?  bad.a
        ?&  !(none dir)
            ?|  ?=(~ (str dir))
                !(~(has in facings) (need (str dir)))
        ==  ==
      [(say 'faces up, down, left, right') bad.a]
    =?  bad.a  !(stand (need x) (need y))
      [(say 'is outside the map or inside a wall') bad.a]
    $(l t.l)
  =/  spawn  (str (get m 'spawn'))
  =?  bad.a
      ?&  !=(~ ar)
          ?|  ?=(~ spawn)
              !(lien ar |=(p=json =(spawn (str (get p 'id')))))
      ==  ==
    [(say 'its spawn is not one of its arrival points') bad.a]
  ::  its items
  =?  bad.a  (gth (lent is) items-max)  [(say 'has more than 256 items') bad.a]
  |-  ^-  acc
  ?~  is  a
  $(is t.is, a (an-item i.is here tab a))
::
::  The box of each placed image that blocks movement, as a wall. One
::  that is turned (2026-11-10) blocks its turned outline, which this has
::  no trigonometry to draw: it is left to the editor's own check, rather
::  than refusing a door the editor rightly let stand beside it.
++  blocking
  |=  is=(list json)
  ^-  (list [s=shape v=@ud])
  %+  murn  is
  |=  it=json
  ^-  (unit [s=shape v=@ud])
  =/  ij=json  (fall (get it 'image') ~)
  ?.  =(`& (flag (get ij 'blocks')))  ~
  =/  turn  (real (get ij 'turn'))
  ?:  ?&(?=(^ turn) !=(zero u.turn))  ~
  =/  place  (numbers (get ij 'at'))
  ?.  ?&(?=(^ place) =(4 (lent u.place)))  ~
  `[[%rect (snag 0 u.place) (snag 1 u.place) (snag 2 u.place) (snag 3 u.place)] 1]
::
::  An image: a held image asset, at the size it really is.
++  an-image
  |=  [at=@t j=(unit json) tab=table a=acc]
  ^-  acc
  =/  say  |=(t=@t ^-(@t (rap 3 at ': ' t ~)))
  ?.  ?=([~ %o *] j)  a(bad [(say 'is not an image') bad.a])
  =/  src  (str (get u.j 'src'))
  =/  h=(unit hash:g)  ?~(src ~ (unhex u.src))
  ?~  h  a(bad [(say 'names no asset') bad.a])
  =/  row  (~(get by tab) u.h)
  ?~  row  a(bad [(say 'uses an image missing from the assets table') bad.a])
  =.  used.a  (~(put in used.a) u.h)
  =?  bad.a  ?|(!(image mime.u.row) !(~(has in mimes) mime.u.row))
    [(rap 3 at ': is ' mime.u.row ', not an image' ~) bad.a]
  =/  w  (num (get u.j 'w'))
  =/  hh  (num (get u.j 'h'))
  ?.  ?&  ?=(^ w)  ?=(^ hh)  (gte u.w 1)  (gte u.hh 1)
          (lte u.w side-max)  (lte u.hh side-max)
      ==
    a(bad [(say 'needs its pixel size') bad.a])
  ?:  ?|(?=(~ dims.u.row) =(u.dims.u.row [u.w u.hh]))  a
  a(bad [(say 'size differs from the asset') bad.a])
::
::  A MAP'S PAINTING (2026-11-08), as world-doc.js has it: a picture `w` x
::  `h`, at most `paint-max` a side, laid over the map's [0 0 size], kept as
::  PNG tiles `paint-tile` pixels square at [c r] counted in tiles.
++  paint-max   4.096
++  paint-tile  512
++  a-paint
  |=  [at=@t j=(unit json) tab=table a=acc]
  ^-  acc
  =/  say  |=(t=@t ^-(@t (rap 3 at ': ' t ~)))
  ?.  ?=([~ %o *] j)  a(bad [(say 'is not a painting') bad.a])
  =/  w  (num (get u.j 'w'))
  =/  h  (num (get u.j 'h'))
  ?.  ?&  ?=(^ w)  ?=(^ h)  (gte u.w 1)  (gte u.h 1)
          (lte u.w paint-max)  (lte u.h paint-max)
      ==
    a(bad [(say 'needs its pixel size, at most 4096 a side') bad.a])
  =/  sz=(list json)  (fall (many (get u.j 'size')) ~)
  =/  sw=(unit @ud)  ?.(?=([* * ~] sz) ~ (num `i.sz))
  =/  sh=(unit @ud)  ?.(?=([* * ~] sz) ~ (num `i.t.sz))
  =/  size-ok=?
    ?&(?=(^ sw) ?=(^ sh) (gte u.sw 1) (gte u.sh 1) (lte u.sw side-max) (lte u.sh side-max))
  =?  bad.a  !size-ok  [(say 'needs the size it covers') bad.a]
  =/  cols=@ud  (div (add u.w (dec paint-tile)) paint-tile)
  =/  rows=@ud  (div (add u.h (dec paint-tile)) paint-tile)
  =/  ts  (many (get u.j 'tiles'))
  ?~  ts  a(bad [(say 'needs its tiles') bad.a])
  =|  seen=(set [@ud @ud])
  =/  l=(list json)  u.ts
  |-  ^-  acc
  ?~  l  a
  =/  c  (num (get i.l 'c'))
  =/  r  (num (get i.l 'r'))
  ?.  ?&(?=(^ c) ?=(^ r) (lth u.c cols) (lth u.r rows))
    $(l t.l, bad.a [(say 'has a tile outside it') bad.a])
  ?:  (~(has in seen) [u.c u.r])
    $(l t.l, bad.a [(say 'repeats a tile') bad.a])
  =.  seen  (~(put in seen) [u.c u.r])
  =/  src  (str (get i.l 'src'))
  =/  hh=(unit hash:g)  ?~(src ~ (unhex u.src))
  ?~  hh  $(l t.l, bad.a [(say 'has a tile missing from the assets table') bad.a])
  =/  row  (~(get by tab) u.hh)
  ?~  row  $(l t.l, bad.a [(say 'has a tile missing from the assets table') bad.a])
  =.  used.a  (~(put in used.a) u.hh)
  ?.  =('image/png' mime.u.row)
    $(l t.l, bad.a [(say 'has a tile that is not a PNG') bad.a])
  ?:  ?&(?=(^ dims.u.row) !=(u.dims.u.row [paint-tile paint-tile]))
    $(l t.l, bad.a [(say 'has a tile that is not 512 pixels square') bad.a])
  $(l t.l)
::
::  A layer of operations: each one's shape and what it sets. On the areas
::  layer (`zone`, the areas of this map), what each sets must be one of
::  them, or null to clear.
++  a-layer
  |=  [at=@t j=(unit json) zone=(unit (set @t)) a=acc]
  ^-  [(list [s=shape v=@ud]) acc]
  ?:  (none j)  [~ a]
  =/  l  (many j)
  ?~  l  [~ a(bad [(cat 3 at ': is not a list') bad.a])]
  =?  bad.a  (gth (lent u.l) ops-max)
    [(cat 3 at ': has more than 4.000 shapes') bad.a]
  =/  l=(list json)  u.l
  =|  out=(list [s=shape v=@ud])
  =/  i=@ud  1
  |-  ^-  [(list [s=shape v=@ud]) acc]
  ?~  l  [(flop out) a]
  =/  w  (rap 3 at ' #' (scot %ud i) ': ' ~)
  =/  r  (shape-of i.l)
  ?:  ?=(%| -.r)  $(l t.l, i +(i), bad.a [(cat 3 w p.r) bad.a])
  =/  vj  (get i.l 'v')
  =/  v=(unit @ud)  ?:((none vj) `1 (num vj))
  ?.  ?&(?=(^ v) (lte u.v 1))
    $(l t.l, i +(i), bad.a [(cat 3 w 'v must be 0 or 1') bad.a])
  =/  aj  (get i.l 'a')
  =?  bad.a
      ?&  ?=(^ zone)
          !(none aj)
          ?|(?=(~ (str aj)) !(~(has in u.zone) (need (str aj))))
      ==
    [(rap 3 w 'names no area of this map: ' (fall (str aj) '?') ~) bad.a]
  $(l t.l, i +(i), out [[p.r u.v] out])
::
::  A map's areas: each one's id, wire number, name, and how people talk
::  there. The ids of this map's areas, for its areas layer.
++  a-areas
  |=  [as=(list json) tab=table a=acc]
  ^-  [[(set @t) @ud] acc]
  =|  here=(set @t)
  =|  mains=@ud
  |-  ^-  [[(set @t) @ud] acc]
  ?~  as  [[here mains] a]
  =/  ar=json  i.as
  =/  aid  (str (get ar 'id'))
  =/  at  (cat 3 'area ' ?~(aid '?' u.aid))
  =/  say  |=(t=@t ^-(@t (rap 3 at ': ' t ~)))
  ?.  (id-ok aid)  $(as t.as, bad.a [(say 'needs an id') bad.a])
  =/  id=@t  (need aid)
  =?  bad.a  (~(has in areas.a) id)  [(say 'repeats an id') bad.a]
  =?  here  !(~(has in areas.a) id)  (~(put in here) id)
  =.  areas.a  (~(put in areas.a) id)
  =/  n  (num (get ar 'num'))
  =/  mode  (str (get ar 'mode'))
  ::  a map's MAIN AREA is the world's own note, place 0, one a map; every
  ::  other area is 1-998, 999 being the quiet floor outside them all
  =/  main=?  =(`'world' mode)
  =?  bad.a  ?&(main !=(`0 n))  [(say 'is the world chat, number 0') bad.a]
  =?  mains  main  +(mains)
  =?  bad.a  ?&(!main ?|(?=(~ n) =(0 u.n) (gth u.n 998)))  [(say 'needs a number 1-998') bad.a]
  =?  bad.a  ?&(!main ?=(^ n) (~(has in area-nums.a) u.n))  [(say 'repeats a number') bad.a]
  =?  area-nums.a  ?&(!main ?=(^ n))  (~(put in area-nums.a) u.n)
  =?  bad.a  !(name-ok (str (get ar 'name')) 64)  [(say 'needs a name') bad.a]
  =/  lease  (get ar 'lease')
  =?  bad.a  ?&(!(none lease) ?=(~ (flag lease)))  [(say 'lease must be true or false') bad.a]
  =.  bad.a
    ?:  main
      =?  bad.a  ?|(!(none (get ar 'note')) =(`& (flag lease)))
        [(say 'is the world own note: not another note, and never leased') bad.a]
      =/  call  (str (get ar 'call'))
      ?:  ?|(=(`'huddle' call) =(`'none' call))  bad.a
      [(say 'the world chat has proximity calls or none') bad.a]
    ?:  =(`'note' mode)
      =?  bad.a  !(note-ok (str (get ar 'note')))
        [(say 'is bound to a note but names none') bad.a]
      =/  nh  (get ar 'noteHost')
      =?  bad.a  ?&(!(none nh) !(ship-ok (str nh)))
        [(say 'its note host must be a ship') bad.a]
      ?.  =(`& (flag lease))  bad.a
      [(say 'is already a note, so it cannot also be leased') bad.a]
    ?.  ?|(=(`'room' mode) =(`'quiet' mode))
      [(say 'mode must be room, note, quiet') bad.a]
    =?  bad.a  !(none (get ar 'note'))
      [(say 'names a note but is not bound to it') bad.a]
    =?  bad.a  !(none (get ar 'noteHost'))
      [(say 'names a note host but is not bound to a note') bad.a]
    =/  call  (str (get ar 'call'))
    =?  bad.a  ?!(?|(=(`'room' call) =(`'huddle' call) =(`'none' call)))
      [(say 'call must be room, huddle, none') bad.a]
    ?.  ?&(=(`'quiet' mode) !=(`'none' call))  bad.a
    [(say 'is quiet, so it has no call') bad.a]
  =/  tr  (get ar 'traits')
  =?  bad.a
      ?&  !(none tr)
          ?|  ?=(~ (many tr))
              %+  lien  (need (many tr))
              |=  t=json
              ?.  ?=([%s *] t)  &
              !(~(has in traits) p.t)
      ==  ==
    [(say 'traits are rumors, unlock, dice') bad.a]
  =?  a  !(none (get ar 'sound'))  (a-sound (cat 3 at ' sound') (get ar 'sound') tab a)
  $(as t.as)
::
::  An area's sound (2026-11-08): a held audio asset a browser plays and
::  cannot run, small, at a volume of 0 to 1.
++  a-sound
  |=  [at=@t j=(unit json) tab=table a=acc]
  ^-  acc
  =/  say  |=(t=@t ^-(@t (rap 3 at ': ' t ~)))
  ?.  ?=([~ %o *] j)  a(bad [(say 'is not a sound') bad.a])
  =/  src  (str (get u.j 'src'))
  =/  h=(unit hash:g)  ?~(src ~ (unhex u.src))
  ?~  h  a(bad [(say 'names no asset') bad.a])
  =/  row  (~(get by tab) u.h)
  ?~  row  a(bad [(say 'uses a sound missing from the assets table') bad.a])
  =.  used.a  (~(put in used.a) u.h)
  =?  bad.a  ?|(!(audio mime.u.row) !(~(has in mimes) mime.u.row))
    [(rap 3 at ': is ' mime.u.row ', not a sound' ~) bad.a]
  =?  bad.a  (gth size.u.row sound-max)  [(say 'is bigger than 2 MB') bad.a]
  =/  vj  (get u.j 'volume')
  ?:  (none vj)  a
  =/  v  (real vj)
  ?:  ?&(?=(^ v) (gte:rd u.v zero) (lte:rd u.v one))  a
  a(bad [(say 'its volume is 0 to 1') bad.a])
::
::  A placed item: what it is called, what is clicked or walked into, the
::  image it shows, and what it does.
++  an-item
  |=  [it=json here=(set @t) tab=table a=acc]
  ^-  acc
  =/  iid  (str (get it 'id'))
  =/  at  (cat 3 'item ' ?~(iid '?' u.iid))
  =/  say  |=(t=@t ^-(@t (rap 3 at ': ' t ~)))
  ?.  (id-ok iid)  a(bad [(say 'needs an id') bad.a])
  =?  bad.a  (~(has in items.a) (need iid))  [(say 'repeats an id') bad.a]
  =.  items.a  (~(put in items.a) (need iid))
  =?  bad.a  !(name-ok (str (get it 'name')) 64)  [(say 'needs a name') bad.a]
  =/  img  (get it 'image')
  =?  a  !(none img)
    =.  a  (an-image (cat 3 at ' image') img tab a)
    =/  ij=json  (need img)
    =/  place  (numbers (get ij 'at'))
    =?  bad.a
        ?|  ?=(~ place)
            !=(4 (lent u.place))
            !(gth:rd (snag 2 u.place) zero)
            !(gth:rd (snag 3 u.place) zero)
        ==
      [(say 'image needs a place [x, y, w, h]') bad.a]
    =/  layer  (get ij 'layer')
    =?  bad.a  ?&(!(none layer) ?!(?|(=(`'back' (str layer)) =(`'front' (str layer)))))
      [(say 'image layer is back or front') bad.a]
    =/  blocks  (get ij 'blocks')
    =?  bad.a  ?&(!(none blocks) ?=(~ (flag blocks)))
      [(say 'image blocks is true or false') bad.a]
    ::  turned about its middle, in degrees (world/turned, 2026-11-10)
    =/  turn  (real (get ij 'turn'))
    =?  bad.a
        ?&  !(none (get ij 'turn'))
            ?|  ?=(~ turn)
                (gth:rd u.turn (sun:rd 360))
                (lth:rd u.turn (san:rd -360))
        ==  ==
      [(say 'image turn is degrees, -360 to 360') bad.a]
    a
  =/  d=json  (fall (get it 'do') ~)
  =/  phrase=?  =(`'phrase' (str (get d 'trigger')))
  =/  sh  (get it 'shape')
  =.  a
    ?:  (none sh)
      ?:  ?|(phrase !(none img))  a
      a(bad [(say 'needs a shape or an image to click') bad.a])
    =/  r  (shape-of (need sh))
    ?:  ?=(%& -.r)  a
    a(bad [(say (cat 3 'shape: ' p.r)) bad.a])
  (an-action at d here tab a)
::
::  An item's text made into a sign on the map (2026-11-08): how its words
::  show -- their size, their colour, a plaque behind them or not.
++  a-sign
  |=  [at=@t s=(unit json) a=acc]
  ^-  acc
  ?:  (none s)  a
  =/  say  |=(t=@t ^-(@t (rap 3 at ': ' t ~)))
  ?.  ?=([~ %o *] s)  a(bad [(say 'its sign is how its words show on the map') bad.a])
  =/  j=json  u.s
  =/  size  (str (get j 'size'))
  =?  bad.a
      ?&  !(none (get j 'size'))
          ?!(?|(=(`'small' size) =(`'medium' size) =(`'large' size)))
      ==
    [(say 'its sign words are small, medium, large') bad.a]
  =?  bad.a  ?&(!(none (get j 'color')) !(colour-ok (str (get j 'color'))))
    [(say 'its sign colour is #rrggbb') bad.a]
  =/  plaque  (get j 'plaque')
  =?  bad.a  ?&(!(none plaque) ?=(~ (flag plaque)))
    [(say 'its sign plaque is true or false') bad.a]
  a
::  A colour as #rrggbb.
++  colour-ok
  |=  t=(unit @t)
  ^-  ?
  ?~  t  |
  ?.  =(7 (met 3 u.t))  |
  ?.  =('#' (end 3 u.t))  |
  %+  levy  (trip (rsh 3 u.t))
  |=  c=@tD
  ?|  &((gte c '0') (lte c '9'))
      &((gte c 'a') (lte c 'f'))
      &((gte c 'A') (lte c 'F'))
  ==
::
::  What an item does, and what that behaviour needs.
++  an-action
  |=  [at=@t d=json here=(set @t) tab=table a=acc]
  ^-  acc
  =/  say  |=(t=@t ^-(@t (rap 3 at ': ' t ~)))
  ?.  ?=([%o *] d)  a(bad [(say 'does nothing: give it a behaviour') bad.a])
  =/  kind  (str (get d 'kind'))
  ?.  ?&(?=(^ kind) (~(has in kinds) u.kind))
    a(bad [(say 'has an unknown behaviour') bad.a])
  =/  trig  (get d 'trigger')
  =/  tr=(unit @t)  (str trig)
  =?  bad.a  ?&(!(none trig) ?|(?=(~ tr) !(~(has in triggers) u.tr)))
    [(say 'is triggered by click, walk, phrase') bad.a]
  =?  bad.a  ?&(=(`'phrase' tr) !=('portal' u.kind))
    [(say 'only a portal can be spoken') bad.a]
  ?+    u.kind  a
      %web
    ?:  (https-ok (str (get d 'url')))  a
    a(bad [(say 'needs an https address') bad.a])
  ::
      %app
    =?  bad.a  !(desk-ok (str (get d 'desk')))  [(say 'needs an app desk') bad.a]
    =/  pub  (str (get d 'publisher'))
    =?  bad.a  ?!(?|(=(`'HOST' pub) (ship-ok pub)))
      [(say 'needs the publisher of the app') bad.a]
    =/  ctx  (get d 'context')
    ?:  (none ctx)  a
    ?:  ?&  ?=([~ %o *] ctx)
            (lte ~(wyt by p.u.ctx) 8)
            %+  levy  ~(tap by p.u.ctx)
            |=  [k=@t v=json]
            ?&((key-ok k) ?=([%s *] v) (lte (met 3 p.v) 200))
        ==
      a
    a(bad [(say 'its app context is up to eight short strings') bad.a])
  ::
      %artifact
    =/  art  (str (get d 'artifact'))
    ?:  ?&  (note-ok (str (get d 'note')))
            ?=(^ art)  !=('' u.art)  (lte (met 3 u.art) 200)
        ==
      a
    a(bad [(say 'needs a note and an artifact') bad.a])
  ::
      %video
    ::  with a screen, it plays on the map for the people in an area;
    ::  without one, it is a player of your own
    =/  scr  (get d 'screen')
    =/  area  (str (get d 'area'))
    ?:  (none scr)
      ?:  (none (get d 'area'))  a
      a(bad [(say 'only a screen plays for an area') bad.a])
    =/  r  (reals (need scr) ~['x' 'y' 'w' 'h'])
    =?  bad.a
        ?|  ?=(~ r)
            !(gth:rd (snag 2 u.r) zero)
            !(gth:rd (snag 3 u.r) zero)
        ==
      [(say 'its screen needs x, y, w, h') bad.a]
    ?:  ?|((none (get d 'area')) ?&(?=(^ area) (~(has in here) u.area)))  a
    a(bad [(say 'a screen plays for an area of this map, or for everyone') bad.a])
  ::
      %portal
    =/  to  (str (get d 'to'))
    =?  bad.a  !(id-ok to)  [(say 'needs an arrival point to lead to') bad.a]
    =?  portals.a  (id-ok to)  [[at (need to)] portals.a]
    =/  one-way  (get d 'oneWay')
    =?  bad.a  ?&(!(none one-way) ?=(~ (flag one-way)))
      [(say 'oneWay is true or false') bad.a]
    ?.  =(`'phrase' tr)  a
    =?  bad.a  !(name-ok (str (get d 'phrase')) 80)
      [(say 'needs the phrase to say') bad.a]
    =/  area  (str (get d 'area'))
    ?:  ?&(?=(^ area) (~(has in here) u.area))  a
    a(bad [(say 'a phrase is said in an area of this map') bad.a])
  ::
      %travel
    ?:  (ship-ok (str (get d 'host')))  a
    a(bad [(say 'needs the host ship of the other Glurff') bad.a])
  ::
      %text
    ::  A sign people can write on may start blank.
    =/  editable  (get d 'editable')
    =?  bad.a  ?&(!(none editable) ?=(~ (flag editable)))
      [(say 'editable is true or false') bad.a]
    =.  a  (a-sign at (get d 'sign') a)
    =/  t  (str (get d 'text'))
    ?:  ?&(=(`%.y (flag editable)) ?=(^ t) (lte (lent (tuba (trip u.t))) 4.000))  a
    ?:  (name-ok t 4.000)  a
    a(bad [(say 'needs text, at most 4.000 characters') bad.a])
  ::
      %links
    =/  ls  (many (get d 'links'))
    ?:  ?&  ?=(^ ls)
            !=(~ u.ls)
            (lte (lent u.ls) 24)
            %+  levy  u.ls
            |=  l=json
            ?&((name-ok (str (get l 'title')) 64) (https-ok (str (get l 'url'))))
        ==
      a
    a(bad [(say 'needs up to 24 titled https links') bad.a])
  ::
      %npc
    ::  a character (2026-11-08): its look, where it faces, whether it
    ::  wanders its area, what it says as people come near, what it says
    ::  when tapped, and its choices -- each something an item does
    =?  bad.a  !(none trig)  [(say 'a character is tapped') bad.a]
    =/  look  (get d 'look')
    =?  bad.a  ?&(!(none look) !?=([~ %o *] look))
      [(say 'its look is a character look') bad.a]
    =/  dir  (get d 'dir')
    =?  bad.a
        ?&  !(none dir)
            ?|(?=(~ (str dir)) !(~(has in facings) (need (str dir))))
        ==
      [(say 'faces up, down, left, right') bad.a]
    =/  wander  (get d 'wander')
    =?  bad.a  ?&(!(none wander) ?=(~ (flag wander)))
      [(say 'wander is true or false') bad.a]
    ::  where it walks (2026-11-08): a box on the map
    =/  roam  (get d 'roam')
    =/  rr=(unit (list @rd))  ?:((none roam) ~ (reals (need roam) ~['x' 'y' 'w' 'h']))
    =?  bad.a
        ?&  !(none roam)
            ?|  ?=(~ rr)
                !(gth:rd (snag 2 u.rr) zero)
                !(gth:rd (snag 3 u.rr) zero)
        ==  ==
      [(say 'walks around a box of x, y, w, h') bad.a]
    =/  lines  (get d 'lines')
    =?  bad.a
        ?&  !(none lines)
            ?|  ?=(~ (many lines))
                (gth (lent (need (many lines))) 8)
                (lien (need (many lines)) |=(l=json !(name-ok (str `l) 140)))
        ==  ==
      [(say 'says up to 8 lines of up to 140 letters') bad.a]
    =/  talk  (get d 'talk')
    =?  bad.a
        ?&  !(none talk)
            ?|(?=(~ (str talk)) (gth (lent (tuba (trip (need (str talk))))) 1.000))
        ==
      [(say 'says up to 1.000 letters when tapped') bad.a]
    =/  cs  (get d 'choices')
    ?:  (none cs)  a
    =/  cl  (many cs)
    ?:  ?|(?=(~ cl) (gth (lent u.cl) 4))  a(bad [(say 'has up to 4 choices') bad.a])
    =/  l=(list json)  u.cl
    =/  i=@ud  1
    |-  ^-  acc
    ?~  l  a
    =/  w  (rap 3 at ' choice ' (scot %ud i) ~)
    =/  sw  |=(t=@t ^-(@t (rap 3 w ': ' t ~)))
    =?  bad.a  !(name-ok (str (get i.l 'label')) 40)
      [(sw 'needs a label of up to 40 letters') bad.a]
    =/  cd=json  (fall (get i.l 'do') ~)
    =/  ck  (str (get cd 'kind'))
    ?.  ?&(?=(^ ck) (~(has in npc-does) u.ck))
      $(l t.l, i +(i), bad.a [(sw 'does web, app, portal, travel, text, links') bad.a])
    =?  bad.a  !(none (get cd 'trigger'))  [(sw 'is tapped') bad.a]
    $(l t.l, i +(i), a (an-action w cd here tab a))
  ::
      %collect
    ::  a collectible (2026-11-08): what it says when found, whether it
    ::  shows only close by, and its picture or none
    =/  t  (get d 'text')
    =?  bad.a
        ?&  !(none t)
            ?|(?=(~ (str t)) (gth (lent (tuba (trip (need (str t))))) 500))
        ==
      [(say 'says up to 500 letters when found') bad.a]
    =/  near  (get d 'near')
    =?  bad.a  ?&(!(none near) ?=(~ (flag near)))
      [(say 'near is true or false') bad.a]
    ?:  (none (get d 'picture'))  a
    (an-image (cat 3 at ' picture') (get d 'picture') tab a)
  ==
--
