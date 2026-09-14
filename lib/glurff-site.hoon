::  Same-origin, owner-authenticated static frontend. The generated manifest is
::  the only path authority; arbitrary URL segments never become Clay paths.
/+  server, glurff-assets
|%
++  bind
  |.  ^-  card:agent:gall
  [%pass /eyre-bind %arvo %e %connect [~ /apps/glurff] %glurff]
++  serve
  |=  [=bowl:gall eyre-id=@ta req=inbound-request:eyre]
  ^-  (list card:agent:gall)
  %+  give-simple-payload:app:server  eyre-id
  ^-  simple-payload:http
  ?.  ?&(authenticated.req =(src.bowl our.bowl))
    (login-redirect:gen:server request.req)
  ?.  ?|(=('GET' method.request.req) =('HEAD' method.request.req))
    [[405 ~[['allow' 'GET, HEAD']]] ~]
  =/  chars  (trip url.request.req)
  =/  query  (find "?" chars)
  =/  url=@t  (crip ?~(query chars (scag u.query chars)))
  ?:  =('/apps/glurff' url)
    (redirect:gen:server '/apps/glurff/')
  =/  payload=simple-payload:http
    ?:  =('/apps/glurff/desk.js' url)
      =/  code=@t  'window.desk="glurff";'
      [[200 ~[['content-type' 'application/javascript; charset=utf-8'] ['cache-control' 'no-store']]] `(as-octs:mimes:html code)]
    =/  asset  (~(get by files:glurff-assets) url)
    ?~  asset  not-found:gen:server
    =/  fpath=path
      [(scot %p our.bowl) q.byk.bowl (scot %da now.bowl) spur.u.asset]
    =/  bytes=@  .^(@ %cx fpath)
    ::  Content-hashed bundles, and files the client asks for with a build
    ::  version (?v=), never change under the same URL, so the browser may keep
    ::  them. Everything else -- the entry page above all -- is revalidated, so a
    ::  deploy is picked up on the next load.
    =/  long=?
      ?|  =('/apps/glurff/assets/' (end [3 20] url))
          ?&(?=(^ query) !=(~ (find "v=" (slag u.query chars))))
      ==
    :_  `[size.u.asset bytes]
    :-  200
    :~  ['content-type' mime.u.asset]
        ['cache-control' ?:(long 'private, max-age=31536000, immutable' 'no-cache')]
        ['x-content-type-options' 'nosniff']
    ==
  ?:  =('HEAD' method.request.req)
    payload(data ~)
  payload
--
