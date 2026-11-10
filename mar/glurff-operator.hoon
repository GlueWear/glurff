::  glurff-operator: what makes a ship a world's host, and lets it edit.
::
::  NOUN ONLY, deliberately. Eyre turns a page's poke into a mark from JSON,
::  and this one has none, so only Dojo on the ship itself can send it:
::
::    :glurff &glurff-operator [%host 'note-~2026.11.05..02.48.38..6bac']
::    :glurff &glurff-operator [%edit &]
::
::  An install never hosts or edits a world until its operator says so.
/-  g=glurff
|_  op=operator:g
++  grab
  |%
  ++  noun  operator:g
  --
++  grow
  |%
  ++  noun  op
  --
++  grad  %noun
--
