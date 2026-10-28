/* First-party cookie authentication; passwords/tokens never enter browser storage. */
(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory;
    else {
        let localStorage;try{localStorage=root.localStorage;}catch{localStorage={getItem(){return null;},setItem(){throw Error('storage disabled');},removeItem(){}};}
        const api=factory(root.TogetherWatchHistory,{storage:localStorage,fetch:root.fetch.bind(root),
            notify:type=>root.dispatchEvent(new Event(type))});
        root.TogetherWatchAccount=api;root.TogetherWatchHistory.store=api.store;
        api.refresh();
        root.setInterval(()=>api.sync(),15000);
        root.addEventListener('focus',()=>api.refresh());
        root.addEventListener('online',()=>api.refresh());
        root.addEventListener('pagehide',()=>api.flush());
        root.document.addEventListener('visibilitychange',()=>{if(root.document.hidden)api.flush();else api.refresh();});
        root.addEventListener('storage',e=>{if(e.key===api.ownerKey)api.ownerChanged();else if(e.key?.startsWith(api.prefix))api.changed();});
        root.document.addEventListener('DOMContentLoaded',()=>api.bind(root.document));
    }
})(globalThis,function(H,env){
    'use strict';
    const prefix='tw_account_history_v1_',ownerKey='tw_account_owner_v1',local=H.localStore||H.createStore(env.storage);
    let user=null,token='',ready=false,epoch=0,refreshing=null,flushing=null,timer=null,status='正在检查登录状态…';
    const memory=new Map(),volatile=new Set();
    // Storage failure must not stop playback. Account cache may fall back to memory.
    const storage={getItem(k){if(volatile.has(k))return memory.get(k);try{return env.storage.getItem(k);}catch{return memory.get(k);}},
        setItem(k,v){memory.set(k,v);try{env.storage.setItem(k,v);volatile.delete(k);}catch{volatile.add(k);}},
        removeItem(k){memory.delete(k);try{env.storage.removeItem(k);volatile.delete(k);}catch{volatile.add(k);}}};
    const key=()=>prefix+user.id;
    function read(){try{return JSON.parse(storage.getItem(key()))||{};}catch{return{};}}
    function write(s){storage.setItem(key(),JSON.stringify(s));}
    function changed(){env.notify?.('tw-history-change');}
    async function ownerChanged(){
        if((user?.id||null)!==(storage.getItem(ownerKey)||null)){epoch++;ready=false;changed();}
        if(refreshing)await refreshing;
        return refresh();
    }
    function announce(message){status=message;env.notify?.('tw-account-change');}
    const accountStore=()=>H.createStore(storage,Date.now,key());
    function select(next){
        const prior=storage.getItem(ownerKey);
        if(prior && prior!==next?.id)storage.removeItem(prefix+prior);
        if(user?.id!==next?.id){if(user)storage.removeItem(prefix+user.id);epoch++;clearTimeout(timer);}
        user=next;
        if(user)storage.setItem(ownerKey,user.id);else storage.removeItem(ownerKey);
        ready=true;
    }
    function apply(snapshot, pending=[]){
        const previous=read();
        const s={enabled:snapshot.enabled!==false,rows:Array.isArray(snapshot.rows)?snapshot.rows:[],
            deleted:Array.isArray(snapshot.deleted)?snapshot.deleted:[],meta:previous.meta||{},resume:previous.resume,
            reopened:previous.reopened||[],revision:snapshot.revision,pending:[],serial:previous.serial||0};
        s.deleted=s.deleted.filter(k=>!s.reopened.includes(k));
        write(s);
        for(const op of pending)replay(op);
    }
    function replay(op){
        const s=read();
        if(op.type==='put'){
            s.rows=[op.row,...(s.rows||[]).filter(r=>H.identity(r)!==H.identity(op.row))].slice(0,100);
            s.deleted=(s.deleted||[]).filter(k=>k!==H.identity(op.row));
        } else if(op.type==='delete'){
            s.rows=(s.rows||[]).filter(r=>H.identity(r)!==op.key);s.deleted=[...new Set([...(s.deleted||[]),op.key])].slice(-100);
        } else if(op.type==='clear'){s.rows=[];s.meta={};delete s.resume;}
        else if(op.type==='enabled')s.enabled=op.value;
        s.pending=[...(s.pending||[]),op];write(s);
    }
    function enqueue(op){
        const s=read();s.serial=(s.serial||0)+1;op.seq=s.serial;
        let pending=s.pending||[];
        if(op.type==='put')pending=pending.filter(p=>p.type!=='put'||H.identity(p.row)!==H.identity(op.row));
        if(op.type==='clear')pending=pending.filter(p=>p.type==='enabled');
        s.pending=[...pending,op].slice(-200);write(s);
        announce('等待同步');clearTimeout(timer);timer=setTimeout(()=>flush(),1200);changed();
    }
    async function request(path,method='GET',body,expected=user?.id){
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
        try{
            const headers={'X-CSRF-Token':token};if(expected)headers['X-Account-ID']=expected;
            if(method!=='GET')headers['Content-Type']='application/json';
            const res=await env.fetch('/api/account/'+path,{method,headers,credentials:'same-origin',cache:'no-store',
                signal:controller.signal,keepalive:false,...(body===undefined?{}:{body:JSON.stringify(body)})});
            const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error||'操作失败，请重试'),{status:res.status,data});return data;
        }finally{clearTimeout(timeout);}
    }
    async function refresh(){
        if(refreshing)return refreshing;
        const start=epoch;
        refreshing=(async()=>{
            try{
                const info=await request('session');if(start!==epoch)return;
                token=info.csrf;select(info.user);announce(user?'正在同步账号历史…':'本地模式 · 未登录');
                if(user)await sync(false);
            }catch(e){if(start===epoch){
                // A known account must never silently write into guest history on network failure.
                if(!storage.getItem(ownerKey) && !user)ready=true;
                announce('网络暂不可用，稍后重试；现有记录会保留');
            }}finally{refreshing=null;}
        })();return refreshing;
    }
    async function sync(checkSession=true){
        if(checkSession)return refresh();
        if(!user||!ready)return;
        if((read().pending||[]).length && Number.isInteger(read().revision))return flush();
        const current=epoch,uid=user.id,serial=Number.isInteger(read().revision)?read().serial||0:0;
        try{const data=await request('history','GET',undefined,uid);if(current!==epoch||uid!==user?.id)return;
            // Samples arriving during a GET remain in the local queue.
            const pending=(read().pending||[]).filter(p=>p.seq>serial);apply(data,pending);announce(pending.length?'等待同步':'已同步');changed();
        }catch(e){if(current===epoch)await failure(e);}
    }
    async function failure(e){
        if(e.status===401||e.data?.code==='account_changed'){
            select(null);ready=false;announce('登录已失效或已切换，请重新登录');changed();
        }else announce(e.name==='AbortError'?'同步超时，记录暂存本机，联网后重试':e.message||'同步失败，记录暂存本机');
    }
    async function flush(){
        clearTimeout(timer);
        if(flushing)return flushing;
        if(!user||!ready)return;
        const initial=read(),ops=initial.pending||[];
        if(!ops.length)return;
        if(!Number.isInteger(initial.revision)){announce('请联网读取账号历史后再同步');return;}
        const current=epoch,uid=user.id,seq=initial.serial;
        const puts=new Map(),deletes=new Set();let clear=false,enabled;
        for(const op of ops){
            if(op.type==='put'){puts.set(H.identity(op.row),op.row);deletes.delete(H.identity(op.row));}
            else if(op.type==='delete'){deletes.add(op.key);puts.delete(op.key);}
            else if(op.type==='clear'){clear=true;puts.clear();deletes.clear();}
            else if(op.type==='enabled')enabled=op.value;
        }
        flushing=(async()=>{
            try{
                const data=await request('history','POST',{revision:initial.revision,upserts:[...puts.values()].slice(-100),deletes:[...deletes].slice(-100),clear,...(enabled===undefined?{}:{enabled})},uid);
                if(current!==epoch||uid!==user?.id)return;
                const latest=read();latest.reopened=(latest.reopened||[]).filter(k=>!puts.has(k));write(latest);
                const pending=(latest.pending||[]).filter(p=>p.seq>seq);apply(data,pending);announce(pending.length?'等待同步':'已同步');changed();
            }catch(e){if(current!==epoch)return;
                if(e.data?.code==='history_conflict'){
                    const s=read();s.reopened=[];write(s);apply(e.data.history);announce('已采用其他设备更新后的记录，避免旧记录覆盖');changed();
                }else await failure(e);
            }finally{flushing=null;}
        })();return flushing;
    }
    const store={};
    for(const method of ['enabled','list','metadata','remember','record','remove','clear','prepare','takeResume','setEnabled'])store[method]=(...args)=>{
        if(!ready)return method==='list'?[]:method==='enabled'?false:method==='takeResume'?null:undefined;
        const active=user?accountStore():local;
        const result=active[method](...args);
        if(user){
            if(method==='remember' && H.identity(args[0])){const s=read();s.reopened=[...new Set([...(s.reopened||[]),H.identity(args[0])])].slice(-100);write(s);}
            if(method==='record'&&result){const row=active.list().find(r=>H.identity(r)===H.identity(args[0]));if(row)enqueue({type:'put',row});}
            else if(method==='remove'){const s=read();s.reopened=(s.reopened||[]).filter(k=>k!==H.identity(args[0]));write(s);enqueue({type:'delete',key:H.identity(args[0])});}
            else if(method==='clear'){const s=read();s.reopened=[];write(s);enqueue({type:'clear'});}
            else if(method==='setEnabled')enqueue({type:'enabled',value:!!args[0]});
        }
        return result;
    };
    async function authenticate(kind,fields){
        if(refreshing)await refreshing;
        if(!token)await refresh();
        const data=await request(kind,'POST',fields);epoch++;token=data.csrf;select(data.user);
        await sync(false);env.notify?.('tw-account-change');return data;
    }
    async function logout(){
        await flush();
        if(user && (read().pending||[]).length)throw Error('还有未同步记录，请联网同步后再退出，以免丢失进度');
        const data=await request('logout','POST',{});epoch++;select(null);token=data.csrf;announce('已退出 · 本地历史保持不变');changed();
    }
    async function importLocal(){
        if(!user)throw Error('请先登录');await sync(false);
        if(!user||!Number.isInteger(read().revision))throw Error('请联网后再导入');
        if(!store.enabled())throw Error('请先开启账号的历史记录功能');
        const current=new Map(store.list().map(r=>[H.identity(r),r]));
        let count=0;
        for(const row of local.list())if(!current.has(H.identity(row))||row.updated>current.get(H.identity(row)).updated){
            const s=read();s.rows=[row,...(s.rows||[]).filter(r=>H.identity(r)!==H.identity(row))].slice(0,100);write(s);enqueue({type:'put',row});count++;
        }
        await flush();return count;
    }
    function bind(doc){
        const $=id=>doc.getElementById(id),dialog=$('accountDialog');if(!dialog)return;
        let mode='login';
        const showMessage=text=>{$('accountMessage').textContent=text;};
        function render(){
            for(const label of doc.querySelectorAll('[data-account-label]'))label.textContent=user?'我的账号':'登录';
            $('accountGuest').hidden=!!user;$('accountMember').hidden=!user;
            $('accountName').textContent=user?.display_name||'';$('accountUsername').textContent=user?'@'+user.username:'';
            $('accountSyncState').textContent=status;$('accountLocalCount').textContent=local.list().length;
            $('accountConnection').textContent=status;
        }
        async function action(button,fn){button.disabled=true;showMessage('正在处理…');try{await fn();}catch(e){showMessage(e.message||'操作失败，请重试');}finally{button.disabled=false;render();}}
        for(const button of doc.querySelectorAll('[data-account-open]'))button.onclick=()=>{render();dialog.showModal();refresh();};
        $('accountClose').onclick=()=>dialog.close();
        $('accountSwitch').onclick=()=>{mode=mode==='login'?'register':'login';$('accountSubmit').textContent=mode==='login'?'登录':'注册并登录';
            $('accountSwitch').textContent=mode==='login'?'没有账号？去注册':'已有账号？去登录';$('accountRegistration').hidden=mode!=='register';
            $('accountPassword').autocomplete=mode==='login'?'current-password':'new-password';showMessage('');};
        $('accountForm').onsubmit=e=>{e.preventDefault();action($('accountSubmit'),async()=>{
            if(mode==='register'&&!$('accountConsent').checked)throw Error('请阅读并同意用户协议和隐私政策');
            await authenticate(mode,{username:$('accountLoginName').value,password:$('accountPassword').value,
                display_name:$('accountDisplayName').value,consent:$('accountConsent').checked});$('accountPassword').value='';showMessage('已登录。原有本地历史未自动上传，可按需导入。');
        });};
        $('accountLogout').onclick=()=>action($('accountLogout'),async()=>{await logout();showMessage('已退出账号，恢复本地记录模式。');});
        $('accountRefresh').onclick=()=>action($('accountRefresh'),async()=>{await refresh();showMessage(status);});
        $('accountImport').onclick=()=>action($('accountImport'),async()=>{const count=await importLocal();showMessage(`已处理 ${count} 条本机记录。${status}；本地原记录保留。`);});
        $('accountPasswordForm').onsubmit=e=>{e.preventDefault();action($('accountPasswordSubmit'),async()=>{
            const data=await request('password','POST',{current_password:$('accountOldPassword').value,password:$('accountNewPassword').value});
            token=data.csrf;$('accountPasswordForm').reset();showMessage('密码已修改，其他设备需要重新登录。');
        });};
        $('accountDeleteForm').onsubmit=e=>{e.preventDefault();action($('accountDeleteSubmit'),async()=>{
            if(!$('accountDeleteConfirm').checked)throw Error('请先确认注销不可恢复');
            const data=await request('delete','POST',{confirm:'DELETE',password:$('accountDeletePassword').value});epoch++;select(null);token=data.csrf;
            $('accountDeleteForm').reset();announce('账号及云端历史已删除');changed();showMessage('账号及云端历史已删除，本地访客记录未删除。');
        });};
        doc.defaultView?.addEventListener('tw-account-change',render);
        dialog.addEventListener('close',()=>{for(const input of dialog.querySelectorAll('input[type=password]'))input.value='';showMessage('');});
        render();
    }
    return {store,refresh,sync,flush,authenticate,logout,importLocal,bind,changed,ownerChanged,prefix,ownerKey,
        get user(){return user;},get status(){return status;},get ready(){return ready;}};
});
