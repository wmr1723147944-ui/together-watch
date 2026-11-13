package cloud.watchtogethernow.mobile;

import org.json.JSONObject;

final class RoomPageScripts {
    private static String q(String value){return JSONObject.quote(value);}
    static String document(String token){
        if(!token.matches("[a-f0-9-]+"))throw new IllegalArgumentException("bootstrap token");
        return "<!doctype html><meta charset=utf-8><meta http-equiv=Content-Security-Policy content=\"default-src 'none'\"><body data-room-bootstrap=\""+token+"\"></body>";
    }
    static String initialize(String url,String token,String room,String nickname,String legal){
        return "(()=>{if(location.href!=="+q(url)+"||document.body?.dataset.roomBootstrap!=="+q(token)+")return 'waiting';try{"
            +"localStorage.setItem('tw_legal_notice_version',"+q(legal)+");"
            +"localStorage.setItem('tw_username',"+q(nickname)+");"
            +"localStorage.setItem('tw_last_room',"+q(room)+");return 'initialized';}catch(e){return 'storage-error';}})()";
    }
    static String probe(String url,String room){
        return "(()=>{if(location.href!=="+q(url)+"||document.readyState==='loading')return 'waiting';"
            +"if(window.TW_LEGAL_GATE_BLOCKED)return 'legal';"
            +"const b=window.TogetherWatchMobile;return document.getElementById('roomData')?.value==="+q(room)
            +"&&typeof b?.program==='function'&&typeof b?.receive==='function'&&typeof b?.drain==='function'?'ready':'waiting';})()";
    }
}
