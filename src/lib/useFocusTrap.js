import {useEffect} from 'react';

export function useFocusTrap(active,selector){
  useEffect(()=>{
    if(!active) return;
    const element=document.querySelector(selector);
    if(!element) return;
    const previous=document.activeElement;
    const targets=()=>[...element.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(node=>node.getClientRects().length>0);
    targets()[0]?.focus();
    const handle=event=>{
      if(event.key!=='Tab') return;
      const nodes=targets();
      if(!nodes.length){event.preventDefault();return;}
      const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey&&(document.activeElement===first||!element.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!element.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',handle);
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',handle);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
  },[active,selector]);
}
