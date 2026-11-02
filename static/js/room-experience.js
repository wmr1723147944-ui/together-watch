/* Shared Windows/Android room UI. Playback commands remain owned by NativeSync. */
(function(root){
    'use strict';
    root.createRoomExperience=function({socket,room,addMessage,seek}){
        const doc=root.document,$=id=>doc.getElementById(id),store=root.TogetherWatchHistory.store;
        const timeline=new root.TogetherWatchDanmaku.Timeline();
        let selection=null,revision=0,sample=null,owner=false,count=0,publicRows=[],roomRows=[],epoch=0,lastSaved=0,contextReady=false,resumeChecked=false;
        let available=false,controller=null,lastHistoryRequest=0,recordable=null;
        let historyKey='',resumePending=null,recordScope=null,lastMedia=null,confirmedMedia=null;
        const scope=()=>root.TogetherWatchAccount?.user?.id || 'guest';
        function saveHistory(){
            if(recordable && recordScope===scope() && root.TogetherWatchAccount?.ready!==false)
                store.record(recordable.program,recordable.sample);
        }
        root.addEventListener('tw-history-save',saveHistory);
        const options={public:false,room:true,offset:0};
        function rebuild(){timeline.set(publicRows,roomRows,options);}
        function notice(text){$('publicDanmakuStatus').textContent=text;}
        function key(){return root.TogetherWatchHistory.identity(selection);}
        function mappings(){try{const data=JSON.parse(localStorage.getItem('tw_danmaku_matches_v1'));return data && typeof data==='object' && !Array.isArray(data)?data:{};}catch{return{};}}
        async function loadComments(id,label,save=false){
            const current=epoch;controller?.abort();const active=new AbortController();controller=active;
            notice('正在加载公共弹幕…');publicRows=[];rebuild();
            try{
                const response=await fetch('/api/danmaku/comments/'+encodeURIComponent(id),{signal:controller.signal});const data=await response.json();
                if(current!==epoch||controller!==active)return;if(!response.ok)throw Error(data.error||'公共弹幕加载失败');
                publicRows=Array.isArray(data.comments)?data.comments.slice(0,10000):[];
                options.public=true;$('publicDanmakuEnabled').checked=true;rebuild();
                notice(`${label} · ${publicRows.length} 条弹幕 · 来源：弹弹play开放弹幕网络`);
                if(save && key()){const all=mappings();delete all[key()];all[key()]={id,label:String(label).slice(0,200)};for(const old of Object.keys(all).slice(0,-100))delete all[old];try{localStorage.setItem('tw_danmaku_matches_v1',JSON.stringify(all));}catch{}}
            }catch(e){if(current===epoch && controller===active && e.name!=='AbortError')notice(e.message||'弹幕加载失败，视频仍可播放');}
        }
        function loadSaved(){const match=mappings()[key()];if(available && match && /^[1-9][0-9]{0,18}$/.test(match.id))loadComments(match.id,match.label);}
        function requestRoom(){
            if(!socket.connected || !selection)return;
            const current=epoch;lastHistoryRequest=Date.now();
            socket.emit('request_danmaku',{room,program_revision:revision},reply=>{if(current!==epoch||!reply?.ok)return;
                const ids=new Set(roomRows.map(r=>r.id));roomRows=[...(reply.items||[]).filter(r=>!ids.has(r.id)),...roomRows].slice(-300);rebuild();});
        }
        socket.on('connect',requestRoom);
        socket.on('presence',data=>{count=Number(data.count)||0;});
        socket.on('danmaku_message',item=>{
            if(item.program_revision!==revision || roomRows.some(r=>r.id===item.id))return;
            roomRows.push(item);roomRows=roomRows.slice(-300);rebuild();addMessage('〔弹幕〕'+item.text,item.username);
        });
        $('roomDanmakuEnabled').onchange=e=>{options.room=e.target.checked;rebuild();};
        $('publicDanmakuEnabled').onchange=e=>{options.public=e.target.checked;rebuild();};
        $('danmakuOffset').onchange=e=>{options.offset=Math.max(-600,Math.min(600,Number(e.target.value)||0));e.target.value=options.offset;rebuild();};
        $('danmakuSearch').onclick=async()=>{
            const query=$('danmakuQuery').value.trim();if(query.length<2){notice('请输入至少两个字的片名');return;}
            const current=epoch;controller?.abort();const active=new AbortController();controller=active;notice('正在查找作品和集数…');
            const select=$('danmakuEpisode');select.replaceChildren();$('danmakuUse').disabled=true;
            try{const response=await fetch('/api/danmaku/search?q='+encodeURIComponent(query.slice(0,80)),{signal:controller.signal});const data=await response.json();
                if(current!==epoch||controller!==active)return;if(!response.ok)throw Error(data.error||'弹幕搜索失败');
                for(const row of (data.results||[]).slice(0,500)){if(!/^[1-9][0-9]{0,18}$/.test(row.id))continue;const option=doc.createElement('option');option.value=row.id;option.textContent=row.title+' · '+row.episode;select.append(option);}
                $('danmakuUse').disabled=!select.options.length;notice(select.options.length?'请核对季度和集数，再加载；不同剪辑版本可调整时间偏移。':'没有匹配结果，可换片名；好友弹幕仍可使用。');
            }catch(e){if(current===epoch&&controller===active&&e.name!=='AbortError')notice(e.message||'弹幕搜索失败');}
        };
        $('danmakuUse').onclick=()=>{const s=$('danmakuEpisode');if(s.value)loadComments(s.value,s.selectedOptions[0].textContent,true);};
        fetch('/api/danmaku/status').then(r=>r.json()).then(data=>{available=data.available===true;$('danmakuSearch').disabled=!available;
            notice(available?'输入片名，选择正确集数即可加载公共弹幕。':'公共弹幕服务尚未配置；房间好友弹幕可正常使用。');loadSaved();}).catch(()=>notice('无法检查公共弹幕服务，请稍后重进房间。'));
        return{
            program(value){if(!value || value.revision===revision)return;saveHistory();recordable=null;historyKey='';resumePending=null;lastSaved=0;epoch++;controller?.abort();selection=value.program;revision=value.revision;
                sample=null;publicRows=[];roomRows=[];resumeChecked=false;options.offset=0;$('danmakuOffset').value='0';$('danmakuEpisode').replaceChildren();$('danmakuUse').disabled=true;
                options.public=false;$('publicDanmakuEnabled').checked=false;rebuild();
                const meta=store.metadata(selection);$('danmakuQuery').value=meta?.title||'';requestRoom();notice(available?'为这一集选择公共弹幕；不会沿用上一集内容。':'公共弹幕服务尚未配置；好友弹幕可用。');loadSaved();},
            context(data){owner=data?.owner===true;contextReady=true;},
            receive(data,initialized){
                sample=data;
                if(!data?.active){saveHistory();recordable=null;return;}
                if(!data.ready || data.seeking || !selection || !initialized || root.TogetherWatchAccount?.ready===false)return;
                // New clients report the episode actually selected by the page,
                // including original-site next-episode actions. Do not assume the
                // room's first selection still describes the video being watched.
                const context=Object.hasOwn(data,'history_context')
                    ? data.history_context || (data.session!=null && confirmedMedia?.session===data.session ? confirmedMedia.context : null)
                    : {program:selection};
                const program=context?.program, nextKey=root.TogetherWatchHistory.identity(program);
                if(!nextKey){saveHistory();recordable=null;return;}
                // Sites often select the next button before replacing the old
                // video. Wait for its media session/loadedmetadata boundary.
                if(lastMedia && nextKey!==lastMedia.key && data.session!=null && data.session===lastMedia.session){
                    saveHistory();recordable=null;confirmedMedia=null;return;
                }
                lastMedia={key:nextKey,session:data.session};
                confirmedMedia={context,session:data.session};
                if(historyKey!==nextKey || recordScope!==scope()){
                    saveHistory();recordable=null;historyKey=nextKey;recordScope=scope();resumeChecked=false;resumePending=null;lastSaved=0;
                    if(context.title || context.label)store.remember(program,{title:context.title,label:context.label});
                }
                if(Date.now()-lastHistoryRequest>15000)requestRoom();
                // Wait for ownership/presence before recording the startup frame.
                // A resume seek is asynchronous; never save its pre-seek sample.
                if(!resumeChecked){
                    if(!contextReady || count<1)return;
                    resumeChecked=true;
                    const time=store.takeResume(program,owner && nextKey===key(),count===1);
                    if(time!==null && (!data.duration || time<data.duration-5))resumePending={time,tries:0,at:0};
                }
                if(resumePending){
                    if(Math.abs(data.time-resumePending.time)<=3 || (data.events||[]).some(e=>e.type==='seek'))resumePending=null;
                    else {
                        if(resumePending.tries<3 && (!resumePending.at || Date.now()-resumePending.at>4000)){
                            resumePending.at=Date.now();resumePending.tries++;seek(resumePending.time);
                            if(resumePending.tries===3)addMessage('续播进度尚未确认，已保留原观看记录；可手动拖到要看的位置。');
                        }
                        return;
                    }
                }
                const wasPlaying=recordable?.sample.playing;
                const observedAt=recordable && recordable.sample.time===data.time && wasPlaying===data.playing
                    ? recordable.sample.observedAt : Date.now();
                recordable={program:{...program},sample:{...data,observedAt}};
                if(Date.now()-lastSaved>5000 || wasPlaying===true && !data.playing || (data.events||[]).some(e=>e.type==='seek')){
                    lastSaved=Date.now();saveHistory();
                }
            },
            overlay(session){return {session,enabled:options.room||options.public,opacity:.85,size:22,items:sample?.active && (!historyKey || historyKey===key())?timeline.at(sample.time):[]};},
            send(text){
                if(!sample?.active||!sample.ready){addMessage('播放器还未就绪，请稍后发弹幕');return false;}
                if(text.length>80){addMessage('弹幕最多 80 个字');return false;}
                socket.timeout(8000).emit('danmaku_message',{room,message:text,time:sample.time,program_revision:revision},(err,reply)=>{if(err||!reply?.ok)addMessage(reply?.error||'弹幕未发送成功，请重试');});return true;
            },
            save:saveHistory,
            destroy(){saveHistory();recordable=null;epoch++;controller?.abort();root.removeEventListener('tw-history-save',saveHistory);},
        };
    };
})(globalThis);
