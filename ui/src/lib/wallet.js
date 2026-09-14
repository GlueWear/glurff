/* Reuse Noltbook's own wallet UI. Opening the modal does not send funds. */
export function openWalletSend(ship) {
  const child=window.open('/apps/noltbook/','glurff-wallet-'+Date.now());
  if(!child)return Promise.reject(new Error('Allow the Noltbook wallet window to open.'));
  return new Promise((resolve,reject)=>{
    const began=Date.now();
    const timer=setInterval(()=>{
      if(child.closed || Date.now()-began>30000){clearInterval(timer);reject(new Error('Open Send in Noltbook and select '+ship+'.'));return;}
      try {
        if(child.document.readyState==='complete' && typeof child.viewProfileSend==='function'){
          child.viewProfileSend(ship);child.focus();clearInterval(timer);resolve();
        }
      }catch {} // Wait for the authenticated same-origin page.
    },200);
  });
}
