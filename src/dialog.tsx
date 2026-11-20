import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const FOCUSABLE='a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
const focusables=(root:HTMLElement)=>[...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el=>el.getClientRects().length>0);

// Shared modal behavior: Escape closes, Tab stays inside, and focus returns to
// whatever opened the dialog. Wrap the existing role="dialog" element with it.
export function Modal({onClose,backdropClose=false,children}:{onClose:()=>void;backdropClose?:boolean;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  // Captured during the first render, before autoFocus moves focus into the dialog.
  const opener=useRef(document.activeElement as HTMLElement|null);
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const node=ref.current;if(!node)return;
    if(!node.contains(document.activeElement))(focusables(node)[0]??node).focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();return;}
      if(event.key!=='Tab')return;
      const items=focusables(node);if(!items.length){event.preventDefault();return;}
      const first=items[0],last=items[items.length-1],active=document.activeElement;
      if(!node.contains(active)){event.preventDefault();first.focus();}
      else if(event.shiftKey&&active===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',key,true);
    const returnTo=opener.current;
    return()=>{document.removeEventListener('keydown',key,true);if(returnTo?.isConnected)returnTo.focus();};
  },[]);
  return <div className="modal-backdrop" ref={ref} tabIndex={-1} onClick={backdropClose?event=>{if(event.target===event.currentTarget)close.current();}:undefined}>{children}</div>;
}
