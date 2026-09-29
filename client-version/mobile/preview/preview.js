document.querySelector('#reset').onclick=()=>{if(confirm('Clear your changes and start again?'))location.reload()};document.querySelector('#expand').onclick=()=>{document.body.classList.add('expanded');const b=document.createElement('button');b.textContent='Exit expanded view';b.style='position:fixed;right:12px;top:8px;z-index:10000;padding:6px 10px;font-size:11px';b.onclick=()=>{document.body.classList.remove('expanded');b.remove();dispatchEvent(new Event('resize'))};document.body.appendChild(b);dispatchEvent(new Event('resize'))};
// Embedded Flutter semantics fields must retain focus after the canvas tap.
document.addEventListener('click',event=>{
 const input=event.target;
 if(input instanceof HTMLInputElement && input.matches('#flutter-host input[data-semantics-role="text-field"]') && !input.disabled && !input.readOnly){
  requestAnimationFrame(()=>{if(input.isConnected)input.focus({preventScroll:true})});
 }
});
