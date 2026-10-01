// GitHub Pages cannot emit frame-ancestors/X-Frame-Options headers. Keep the UI
// unavailable inside a cross-origin frame so logged-in actions cannot be overlaid.
if(window.top===window.self){
  document.documentElement.classList.add('top-level');
}else{
  document.documentElement.classList.add('embedded');
  try{window.top.location=window.self.location.href}catch{}
}
