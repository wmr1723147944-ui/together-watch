'use strict';
// Only the source document is retried. Never recreate the room, change its
// programme, bypass a certificate warning or retry authentication failures.
const transient=new Set([-2,-7,-100,-101,-102,-104,-105,-106,-109,-118,-130]);
class PageLoadRecovery {
    constructor(now=()=>Date.now()){this.now=now;this.current=null;}
    clear(){this.current=null;}
    begin(page){return this.current={page,final:page,phase:'loading',attempts:0,started:this.now(),code:0,retryAt:0};}
    matches(url){return !!this.current && [this.current.page,this.current.final].includes(url);}
    redirect(url){if(this.current?.phase==='loading')this.current.final=url;}
    fail(url,code){
        const s=this.current;
        if(!this.matches(url)||code===-3||['retrying','failed'].includes(s.phase))return;
        s.code=code;
        if(s.attempts<1&&(transient.has(code)||[502,503,504].includes(code))){s.phase='retrying';s.retryAt=this.now()+1200;}
        else s.phase='failed';
    }
    loaded(url,status=200){
        if(!this.matches(url))return;
        if(status>=400){this.fail(url,status);return;}
        if(status<200)return; // An error-document commit is not success.
        this.current.phase='ready';this.current.code=0;
    }
    due(){
        const s=this.current;if(!s)return '';
        if(s.phase==='loading'&&this.now()-s.started>=30000)this.fail(s.final,-118);
        if(s.phase!=='retrying'||this.now()<s.retryAt)return '';
        s.attempts++;s.phase='loading';s.started=this.now();s.final=s.page;s.blankChecked=false;
        return s.page;
    }
    get blocked(){return !!this.current && this.current.phase!=='ready';}
    get message(){
        const s=this.current;if(!s||s.phase==='ready')return '';
        if(s.phase==='failed')return '播放页加载失败（'+s.code+'）。房间仍已连接，可以重试本集；无需重新加入。';
        if(s.phase==='retrying'||s.attempts)return '播放页连接中断，正在重新加载本集（仅自动重试一次）…';
        return '正在加载房间所选播放页…';
    }
}
module.exports={PageLoadRecovery};
