/* Canvas overlay only: text never becomes markup; no network or native bridge. */
(() => {
    if (window.__twDanmakuOverlay) return;
    let video=null,canvas=null,frame=0,packet=null;
    function hide() { if(canvas)canvas.remove();canvas=null;cancelAnimationFrame(frame);frame=0; }
    function draw() {
        frame=0;
        if(!video?.isConnected || !packet?.enabled || !packet.items.length){hide();return;}
        const full=document.fullscreenElement;
        // Browsers do not allow children over native video-only fullscreen.
        const parent=full && full!==video ? full : document.body;
        if(!canvas){canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');canvas.style.cssText='position:fixed!important;pointer-events:none!important;z-index:2147483647!important;';}
        if(canvas.parentNode!==parent)parent.appendChild(canvas);
        const rect=video.getBoundingClientRect();
        let width=rect.width,height=rect.height,left=rect.left,top=rect.top;
        if(video.videoWidth && video.videoHeight && getComputedStyle(video).objectFit!=='cover'){
            const scale=Math.min(width/video.videoWidth,height/video.videoHeight);
            const w=video.videoWidth*scale,h=video.videoHeight*scale;
            left+=(width-w)/2;top+=(height-h)/2;width=w;height=h;
        }
        const ratio=Math.min(2,window.devicePixelRatio||1);
        canvas.style.left=left+'px';canvas.style.top=top+'px';canvas.style.width=width+'px';canvas.style.height=height+'px';
        if(canvas.width!==Math.round(width*ratio))canvas.width=Math.round(width*ratio);
        if(canvas.height!==Math.round(height*ratio))canvas.height=Math.round(height*ratio);
        const ctx=canvas.getContext('2d');if(!ctx)return;
        ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
        const size=Math.max(13,Math.min(packet.size||22,height/14));
        ctx.font=`600 ${size}px system-ui,sans-serif`;ctx.textBaseline='top';ctx.globalAlpha=packet.opacity;
        ctx.lineWidth=3;ctx.strokeStyle='#000b';ctx.lineJoin='round';
        for(const item of packet.items){const age=video.currentTime-item.time;if(age<0||age>=8)continue;
            const text=item.text,tw=ctx.measureText(text).width,x=width-(width+tw)*age/8,y=8+item.lane*(size+8);
            ctx.fillStyle=item.kind==='room'?'#9feaff':'#fff';ctx.strokeText(text,x,y);ctx.fillText(text,x,y);}
        frame=requestAnimationFrame(draw);
    }
    window.__twDanmakuOverlay={set(target,data){video=target;packet=data;if(!data?.enabled){hide();return;}if(!frame)draw();},clear(){packet=null;hide();}};
})();
