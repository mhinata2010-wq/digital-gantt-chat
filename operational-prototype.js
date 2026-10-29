const tabs=[...document.querySelectorAll('[data-tab]')];
const panels=[...document.querySelectorAll('[data-panel]')];

function showPanel(name){
  tabs.forEach(button=>button.classList.toggle('is-active',button.dataset.tab===name));
  panels.forEach(panel=>{
    const active=panel.dataset.panel===name;
    panel.hidden=!active;
    panel.classList.toggle('is-active',active);
  });
}

tabs.forEach(button=>button.addEventListener('click',()=>showPanel(button.dataset.tab)));

document.querySelectorAll('[data-impact-toggle]').forEach(button=>{
  button.addEventListener('click',()=>{
    const target=document.getElementById(button.dataset.impactToggle);
    const expanded=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!expanded));
    target.hidden=expanded;
  });
});

document.querySelectorAll('[data-action="open-schedule"]').forEach(button=>button.addEventListener('click',()=>showPanel('schedule')));

document.querySelectorAll('[data-action="contact"]').forEach(button=>button.addEventListener('click',()=>{
  button.textContent='確認待ちとして記録';
  button.disabled=true;
}));

document.querySelectorAll('[data-action="impact"]').forEach(button=>button.addEventListener('click',()=>{
  const toggle=document.querySelector('[data-impact-toggle="impact-1"]');
  const detail=document.getElementById('impact-1');
  toggle.setAttribute('aria-expanded','true');
  detail.hidden=false;
  detail.scrollIntoView({behavior:'smooth',block:'nearest'});
}));
