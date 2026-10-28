'use strict';
// WebContentsView may survive its WebContents. Late network/close events must
// not dereference a cleared native handle, or match an undefined request owner.
function liveContents(view) {
    try {const wc=view?.webContents;return wc && !wc.isDestroyed()?wc:null;}
    catch {return null;}
}
function requestBelongsToView(details,view) {
    const wc=liveContents(view);
    return !!wc && Number.isSafeInteger(details?.webContentsId) && details.webContentsId===wc.id;
}
module.exports={liveContents,requestBelongsToView};
