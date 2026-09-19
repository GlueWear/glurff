import zlib,struct
def read_png(p):
    data=open(p,'rb').read(); i=8; idat=b''; w=h=bd=ct=None; pal=None; trns=None
    while i<len(data):
        ln=struct.unpack('>I',data[i:i+4])[0]; typ=data[i+4:i+8]; chunk=data[i+8:i+8+ln]
        if typ==b'IHDR': w,h,bd,ct=struct.unpack('>IIBB',chunk[:10])
        elif typ==b'PLTE': pal=chunk
        elif typ==b'tRNS': trns=chunk
        elif typ==b'IDAT': idat+=chunk
        i+=12+ln
    raw=zlib.decompress(idat); ch={0:1,2:3,3:1,4:2,6:4}[ct]; bpp=max(1,ch*(bd//8)); stride=(w*ch*bd+7)//8
    out=bytearray(); prev=bytearray(stride); pos=0
    for y in range(h):
        f=raw[pos]; pos+=1; line=bytearray(raw[pos:pos+stride]); pos+=stride
        for x in range(stride):
            a=line[x-bpp] if x>=bpp else 0; b=prev[x]; c=prev[x-bpp] if x>=bpp else 0
            if f==1: line[x]=(line[x]+a)&255
            elif f==2: line[x]=(line[x]+b)&255
            elif f==3: line[x]=(line[x]+(a+b)//2)&255
            elif f==4:
                pa=abs(b-c); pb=abs(a-c); pc=abs(a+b-2*c)
                pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[x]=(line[x]+pr)&255
        out+=line; prev=line
    # to RGBA
    rgba=bytearray(w*h*4)
    if ct==3:
        for i2 in range(w*h):
            idx=out[i2] if bd==8 else (out[i2//(8//bd)]>>(8-bd*(i2%(8//bd)+1)))&((1<<bd)-1)
            rgba[i2*4:i2*4+3]=pal[idx*3:idx*3+3]
            rgba[i2*4+3]=trns[idx] if trns and idx<len(trns) else 255
    else:
        for i2 in range(w*h):
            px=out[i2*ch:(i2+1)*ch]
            if ch==4: rgba[i2*4:i2*4+4]=px
            elif ch==3: rgba[i2*4:i2*4+3]=px; rgba[i2*4+3]=255
            elif ch==2: rgba[i2*4:i2*4+3]=bytes([px[0]]*3); rgba[i2*4+3]=px[1]
            else: rgba[i2*4:i2*4+3]=bytes([px[0]]*3); rgba[i2*4+3]=255
    return w,h,bytes(rgba)
def write_png(path,w,h,rgba):
    raw=b''.join(b'\x00'+rgba[y*w*4:(y+1)*w*4] for y in range(h))
    def chunk(t,d):
        return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw),6))+chunk(b'IEND',b''))
def over(dst,dw,dh,src,sw,sh,dx,dy,scale=1):
    for y in range(sh):
        for x in range(sw):
            o=(y*sw+x)*4; a=src[o+3]
            if not a: continue
            for ry in range(scale):
                for rx in range(scale):
                    px,py=dx+x*scale+rx, dy+y*scale+ry
                    if 0<=px<dw and 0<=py<dh:
                        d=(py*dw+px)*4
                        if a==255: dst[d:d+4]=src[o:o+4]
                        else:
                            for c in range(3): dst[d+c]=(src[o+c]*a+dst[d+c]*(255-a))//255
                            dst[d+3]=255
def crop(w,h,rgba,x0,y0,cw,ch):
    out=bytearray(cw*ch*4)
    for y in range(ch):
        s=((y0+y)*w+x0)*4
        out[y*cw*4:(y+1)*cw*4]=rgba[s:s+cw*4]
    return bytes(out)
def scale_up(w,h,rgba,k):
    ow,oh=w*k,h*k; out=bytearray(ow*oh*4)
    for y in range(oh):
        sy=(y//k)*w
        for x in range(ow):
            s=(sy+x//k)*4; d=(y*ow+x)*4
            out[d:d+4]=rgba[s:s+4]
    return ow,oh,bytes(out)
